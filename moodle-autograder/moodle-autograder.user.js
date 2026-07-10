// ==UserScript==
// @name         Moodle AutoGrader
// @namespace    moodle-autograder
// @version      1.1.0
// @description  AI-powered grading assistant — reads rubric, reviews submissions, grades and posts feedback.
// @author       Bunmi Oke
// @match        *://students.willisonline.ca/mod/assign/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      generativelanguage.googleapis.com
// @connect      api.anthropic.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// ==/UserScript==

(function () {
  'use strict';

  // ── API endpoints ────────────────────────────────────────────────────────
  const GEMINI_ENDPOINT = key =>
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${key}`;
  const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
  const CLAUDE_MODEL    = 'claude-haiku-4-5-20251001';

  // ── Settings ─────────────────────────────────────────────────────────────
  const get = (k, d = '') => { const v = GM_getValue('mag_' + k); return v !== undefined ? v : d; };
  const set = (k, v)      => GM_setValue('mag_' + k, v);

  const CFG = {
    get geminiKey()           { return get('gemini_key'); },
    get claudeKey()           { return get('claude_key'); },
    get useClaudeForFeedback(){ return get('claude_feedback', 'true') === 'true'; },
    get instructorName()      { return get('instructor_name', 'Instructor'); },
    get instructorStyle()     { return get('instructor_style', 'direct and constructive'); },
    get autoPost()            { return get('auto_post', 'false') === 'true'; },
  };

  // ── Page detection ───────────────────────────────────────────────────────
  const assignId = new URL(location.href).searchParams.get('id') || '';
  if (!assignId) return; // show toolbar on any assign page that has an id= param

  // ── Helpers ──────────────────────────────────────────────────────────────
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function xhr(method, url, opts = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url,
        headers:      opts.headers      || {},
        data:         opts.body         || undefined,
        responseType: opts.responseType || 'text',
        onload:  r => resolve(r),
        onerror: e => reject(e),
      });
    });
  }

  // base64 encode an ArrayBuffer
  function toBase64(buffer) {
    let bin = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  // ── File parsers ─────────────────────────────────────────────────────────
  async function fetchFile(url) {
    const r = await xhr('GET', url, { responseType: 'arraybuffer' });
    return { buffer: r.response, mime: (r.responseHeaders.match(/content-type:\s*([^\r\n;]+)/i) || [])[1] || '' };
  }

  function bufferToText(buffer) {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }

  function parseIPYNB(text) {
    try {
      const nb = JSON.parse(text);
      return (nb.cells || []).map(cell => {
        const src  = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
        const outs = (cell.outputs || []).map(o => {
          if (o.text)    return Array.isArray(o.text) ? o.text.join('') : o.text;
          if (o.data?.['text/plain']) return Array.isArray(o.data['text/plain']) ? o.data['text/plain'].join('') : o.data['text/plain'];
          return '';
        }).filter(Boolean).join('\n');
        const header = cell.cell_type === 'code' ? '[CODE]' : '[MARKDOWN]';
        return outs ? `${header}\n${src}\n[OUTPUT]\n${outs}` : `${header}\n${src}`;
      }).join('\n\n---\n\n');
    } catch {
      return text;
    }
  }

  function parseXLSX(buffer) {
    try {
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      return wb.SheetNames.map(name => {
        const ws  = wb.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
        return `=== Sheet: ${name} ===\n${csv}`;
      }).join('\n\n');
    } catch (e) {
      return `[XLSX parse error: ${e.message}]`;
    }
  }

  // Returns { text, inlineData } — inlineData used for PDFs sent directly to Gemini
  async function extractSubmission(fileUrl, filename) {
    const ext  = (filename.split('.').pop() || '').toLowerCase();
    const { buffer, mime } = await fetchFile(fileUrl);

    if (ext === 'pdf' || mime.includes('pdf')) {
      // PDFs go straight to the AI as base64; Gemini understands them natively
      return { text: null, inlineData: { mimeType: 'application/pdf', data: toBase64(buffer) } };
    }
    if (ext === 'xlsx' || ext === 'xls' || mime.includes('spreadsheetml') || mime.includes('excel')) {
      return { text: parseXLSX(buffer), inlineData: null };
    }
    if (ext === 'ipynb') {
      return { text: parseIPYNB(bufferToText(buffer)), inlineData: null };
    }
    // .py / .csv / .txt / anything else — raw text
    return { text: bufferToText(buffer), inlineData: null };
  }

  // ── Moodle DOM parsers ───────────────────────────────────────────────────
  function parseAssignmentTitle() {
    return ($('h1') || $('h2') || { textContent: 'Assignment' }).textContent.trim();
  }

  function parseAssignmentInstructions() {
    // Moodle wraps instructions in .activity-description or .assign-intro
    const el = $('.activity-description') || $('.assign-intro') || $('[data-region="assign-intro"]');
    return el ? el.innerText.trim() : '(No instructions found on page)';
  }

  // Parse Moodle Advanced Grading Rubric from the DOM of a grade page
  function parseRubric(doc = document) {
    const criteria = [];
    // Moodle rubric selector varies by version; try several
    const rows = [...(doc.querySelectorAll('.gradingform_rubric .criterion') ||
                      doc.querySelectorAll('tr.criterion') ||
                      doc.querySelectorAll('.criterion') ||
                      [])];

    for (const row of rows) {
      const nameEl = row.querySelector('.description .name, .criterionname, [data-criterion-name]');
      const descEl = row.querySelector('.description .descriptionmarker, .criteriondescription');
      const name   = nameEl ? nameEl.textContent.trim() : 'Criterion';
      const desc   = descEl ? descEl.textContent.trim() : '';

      const levels = [];
      const levelEls = row.querySelectorAll('.level, .rubric-level');
      for (const lvl of levelEls) {
        const scoreEl = lvl.querySelector('.score, .levelpoints, [data-score]');
        const defEl   = lvl.querySelector('.definition, .leveldesc, [data-definition]');
        // Also look for the input id/value to identify this level when posting
        const inp     = lvl.querySelector('input[type=radio], input[type=checkbox]');
        const points  = parseFloat(scoreEl?.textContent || lvl.dataset.score || '0') || 0;
        levels.push({
          id:          inp ? inp.value : null,
          inputName:   inp ? inp.name  : null,
          points,
          description: defEl ? defEl.textContent.trim() : '',
        });
      }
      // Sort levels ascending by points so the AI can reason about them easily
      levels.sort((a, b) => a.points - b.points);

      // Extract the criterion id from any input inside this criterion
      const anyInp = row.querySelector('input[name*="criteria"]');
      const criterionId = anyInp ? (anyInp.name.match(/criteria\]\[(\d+)\]/) || [])[1] || null : null;

      criteria.push({ criterionId, name, description: desc, levels });
    }
    return criteria;
  }

  // Scans the page for student grade links — works on any Moodle theme/version
  function parseStudentList(doc = document) {
    const students = [];
    const seen = new Set();

    // Any link containing userid= on an assign page is a student link
    const allLinks = /** @type {HTMLAnchorElement[]} */([...doc.querySelectorAll('a[href*="userid="]')])
      .filter(a => { try { return a.href.includes('mod/assign'); } catch { return false; } });

    for (const link of allLinks) {
      let uid;
      try { uid = new URL(link.href).searchParams.get('userid'); } catch { continue; }
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);

      // Canonical grade URL using the current page's assignment id
      const gradeUrl = `${location.origin}/mod/assign/view.php?id=${assignId}&userid=${uid}&action=grade`;

      // Resolve student name from context
      let name = '';
      const row = link.closest('tr');
      if (row) {
        const profileLink = row.querySelector('a[href*="user/view.php"]');
        if (profileLink) name = profileLink.textContent.trim();
      }
      if (!name) {
        const t = link.textContent.trim();
        if (t && t.length > 2 && t.length < 80 &&
            !['grade', 'view', 'edit', 'update', 'submit'].some(v => t.toLowerCase() === v)) {
          name = t;
        }
      }
      if (!name && row) {
        for (const td of row.querySelectorAll('td')) {
          const t = td.textContent.trim().split('\n')[0].trim();
          if (t && t.length > 2 && t.length < 80) { name = t; break; }
        }
      }
      if (!name) name = `Student ${uid}`;

      // Collect any file links already visible in the row (often absent on list pages)
      /** @type {{url: string, filename: string}[]} */
      const fileLinks = [];
      if (row) {
        /** @type {NodeListOf<HTMLAnchorElement>} */(row.querySelectorAll('a[href*="pluginfile.php"]')).forEach(a => {
          fileLinks.push({ url: a.href, filename: decodeURIComponent((a.href.split('/').pop() || '').split('?')[0]) });
        });
      }

      students.push({ uid, name, gradeLink: gradeUrl, fileLinks, onlineText: null });
    }
    return students;
  }

  // Fetch a student's grading page and parse the rubric from it (once, for all students)
  async function fetchRubricFromGradePage(student) {
    const r = await xhr('GET', student.gradeLink);
    const parser  = new DOMParser();
    const gradeDoc = parser.parseFromString(r.responseText, 'text/html');
    return parseRubric(gradeDoc);
  }

  // Fetch a student's grade page and return their submission file links + any inline text.
  // Called per-student when files aren't visible on the list page.
  /** @param {{ gradeLink: string }} student */
  async function fetchStudentFiles(student) {
    const r   = await xhr('GET', student.gradeLink);
    const doc = new DOMParser().parseFromString(r.responseText, 'text/html');
    const fileLinks = /** @type {HTMLAnchorElement[]} */([...doc.querySelectorAll('a[href*="pluginfile.php"]')])
      .map(a => ({ url: a.href, filename: decodeURIComponent((a.href.split('/').pop() || '').split('?')[0]) }));
    let onlineText = null;
    if (!fileLinks.length) {
      const textEl = doc.querySelector('.submissiontext, [data-region="assign-submission-text"], .onlinetext');
      if (textEl) onlineText = /** @type {HTMLElement} */(textEl).innerText?.trim() || null;
    }
    return { fileLinks, onlineText };
  }

  // ── AI prompts ───────────────────────────────────────────────────────────
  function rubricToText(rubric) {
    return rubric.map((c, i) =>
      `CRITERION ${i + 1}: ${c.name}\n` +
      (c.description ? `Description: ${c.description}\n` : '') +
      'Levels (points → description):\n' +
      c.levels.map(l => `  ${l.points} pts: ${l.description}`).join('\n')
    ).join('\n\n');
  }

  function buildGradingPrompt(title, instructions, rubric, submissionText) {
    const rubricText   = rubricToText(rubric);
    const maxPoints    = rubric.reduce((s, c) => s + Math.max(...c.levels.map(l => l.points)), 0);
    return `You are an expert grader. Grade the following student submission against the provided rubric.
Be precise, objective, and base every decision solely on the rubric criteria.

ASSIGNMENT: ${title}

INSTRUCTIONS:
${instructions}

RUBRIC (total possible: ${maxPoints} points):
${rubricText}

STUDENT SUBMISSION:
${submissionText || '[No text submission — file submitted for analysis]'}

Respond ONLY with valid JSON in this exact shape (no markdown, no explanation outside the JSON):
{
  "scores": [
    { "criterionIndex": 0, "pointsAwarded": <number>, "justification": "<one sentence why>" }
  ],
  "totalPoints": <number>,
  "overallComment": "<2-3 sentence overall assessment>"
}

Rules:
- pointsAwarded must exactly match one of the point values listed in that criterion's levels.
- criterionIndex is 0-based, matching the rubric order above.
- Be specific in justifications — reference actual content from the submission.`;
  }

  function buildFeedbackPrompt(title, instructions, rubric, submissionText, scores, instructorName, style) {
    const rubricText = rubricToText(rubric);
    const scoreLines = scores.map((s, i) =>
      `${rubric[i]?.name || 'Criterion ' + i}: ${s.pointsAwarded} pts — ${s.justification}`
    ).join('\n');
    return `You are writing instructor feedback for a student submission. Write in the voice of ${instructorName}.
Tone/style: ${style}.

ASSIGNMENT: ${title}
INSTRUCTIONS: ${instructions}

RUBRIC:
${rubricText}

SCORES ASSIGNED:
${scoreLines}

STUDENT SUBMISSION:
${submissionText || '[File submission — use rubric scores to infer content quality]'}

Write 3-5 sentences of feedback for the student. Requirements:
- Reference SPECIFIC details from the submission (e.g. actual code, specific Excel columns, chart type used, specific section of a report).
- Tell the student EXACTLY what was done well and EXACTLY what to improve, with enough detail they can act on it.
- Do NOT use generic phrases like "Great work!", "Well done!", "Overall a good submission".
- Do NOT mention that this feedback was AI-generated.
- Do NOT start with the student's name.
- Write as plain text only — no markdown, no bullet points, no headers.
- Sound like a human instructor who actually read the work.`;
  }

  // ── AI callers ───────────────────────────────────────────────────────────
  async function callGemini(promptText, inlineData = null) {
    const key = CFG.geminiKey;
    if (!key) throw new Error('Gemini API key not configured.');

    const parts = [{ text: promptText }];
    if (inlineData) parts.push({ inlineData });

    const body = JSON.stringify({ contents: [{ parts }] });
    const r = await xhr('POST', GEMINI_ENDPOINT(key), {
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = JSON.parse(r.responseText);
    if (data.error) throw new Error(`Gemini error: ${data.error.message}`);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  async function callClaude(promptText) {
    const key = CFG.claudeKey;
    if (!key) throw new Error('Claude API key not configured.');
    const body = JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: promptText }],
    });
    const r = await xhr('POST', CLAUDE_ENDPOINT, {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body,
    });
    const data = JSON.parse(r.responseText);
    if (data.error) throw new Error(`Claude error: ${data.error.message}`);
    return data.content?.[0]?.text || '';
  }

  function parseGradingJSON(raw) {
    // Strip markdown code fences if present
    const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    return JSON.parse(clean);
  }

  async function gradeSubmission(title, instructions, rubric, submissionText, inlineData) {
    const gradingPrompt = buildGradingPrompt(title, instructions, rubric, submissionText);
    const gradingRaw    = await callGemini(gradingPrompt, inlineData);
    const grading       = parseGradingJSON(gradingRaw);

    const useClaude   = CFG.useClaudeForFeedback && CFG.claudeKey;
    const feedPrompt  = buildFeedbackPrompt(
      title, instructions, rubric, submissionText,
      grading.scores, CFG.instructorName, CFG.instructorStyle
    );
    const feedback = useClaude ? await callClaude(feedPrompt) : await callGemini(feedPrompt);

    return { scores: grading.scores, totalPoints: grading.totalPoints, overallComment: grading.overallComment, feedback: feedback.trim() };
  }

  // ── Grade posting ────────────────────────────────────────────────────────
  // Fetch the student's grading page, fill scores + feedback, submit via XHR POST
  async function postGrade(student, rubric, result, assignmentId) {
    // Fetch the form to get CSRF token and all field names
    const r     = await xhr('GET', student.gradeLink);
    const doc   = new DOMParser().parseFromString(r.responseText, 'text/html');
    const form  = doc.querySelector('form#mform1, form[action*="assign"]');
    if (!form) throw new Error(`Grade form not found for ${student.name}`);

    const fd = new FormData();
    // Copy all existing hidden fields (including sesskey/CSRF token)
    for (const inp of form.querySelectorAll('input[type=hidden], input[type=submit][name]')) {
      if (inp.name) fd.append(inp.name, inp.value);
    }
    // Override sesskey from page if available
    const sesskey = doc.querySelector('input[name=sesskey]')?.value;
    if (sesskey) fd.set('sesskey', sesskey);

    // Apply rubric scores
    for (const score of result.scores) {
      const criterion = rubric[score.criterionIndex];
      if (!criterion) continue;
      const matchedLevel = criterion.levels.find(l => l.points === score.pointsAwarded)
                        || criterion.levels.reduce((a, b) =>
                            Math.abs(b.points - score.pointsAwarded) < Math.abs(a.points - score.pointsAwarded) ? b : a
                          );
      if (matchedLevel?.inputName && matchedLevel?.id) {
        fd.set(matchedLevel.inputName, matchedLevel.id);
      }
    }

    // Write feedback text
    // Moodle feedback field names vary: 'assignfeedbackcomments_editor[text]' is common
    const feedbackFieldNames = [
      'assignfeedbackcomments_editor[text]',
      'feedbacktext',
      'feedback',
      'feedbackcomments[text]',
    ];
    for (const n of feedbackFieldNames) {
      fd.set(n, result.feedback);
      fd.set(n.replace('[text]', '[format]'), '1'); // 1 = HTML, 0 = plain
    }

    // Ensure we're saving (not just previewing)
    fd.set('savegrade', '1');
    fd.set('action', 'submitgrade');

    const formAction = new URL(form.action, location.origin).href;
    const postR = await xhr('POST', formAction, {
      body:    new URLSearchParams(fd).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (postR.status >= 400) throw new Error(`HTTP ${postR.status} saving grade for ${student.name}`);
    return true;
  }

  // ── CSS ──────────────────────────────────────────────────────────────────
  GM_addStyle(`
    #mag-bar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      background: linear-gradient(135deg, #2d0057, #5a0096);
      color: #fff; font-family: sans-serif; font-size: 13px;
      display: flex; align-items: center; gap: 10px;
      padding: 7px 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.35);
    }
    #mag-bar .mag-title { font-weight: bold; letter-spacing: 0.04em; margin-right: 6px; }
    #mag-bar .mag-sep   { opacity: 0.4; }
    .mag-btn {
      background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.30);
      color: #fff; border-radius: 5px; padding: 4px 12px;
      font-size: 12px; cursor: pointer; font-family: sans-serif;
      transition: background 0.15s;
    }
    .mag-btn:hover  { background: rgba(255,255,255,0.28); }
    .mag-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .mag-btn.primary { background: #7b2fff; border-color: #a060ff; }
    .mag-btn.primary:hover { background: #9040ff; }
    #mag-status { margin-left: auto; font-size: 11px; opacity: 0.82; white-space: nowrap; }

    /* Settings overlay */
    #mag-settings-overlay {
      display: none; position: fixed; inset: 0; z-index: 1000000;
      background: rgba(0,0,0,0.55); align-items: center; justify-content: center;
    }
    #mag-settings-overlay.open { display: flex; }
    #mag-settings-box {
      background: #1a0030; border: 1px solid #7b2fff; border-radius: 14px;
      padding: 28px 32px; min-width: 440px; max-width: 560px; color: #f0e8ff;
      font-family: sans-serif; box-shadow: 0 20px 60px rgba(0,0,0,0.7);
    }
    #mag-settings-box h2 { margin: 0 0 20px; font-size: 16px; color: #c9a0ff; }
    .mag-field { margin-bottom: 14px; }
    .mag-field label { display: block; font-size: 12px; color: #b090d0; margin-bottom: 4px; }
    .mag-field input, .mag-field textarea, .mag-field select {
      width: 100%; box-sizing: border-box; background: #2a0050;
      border: 1px solid #5a30a0; border-radius: 6px; color: #f0e8ff;
      padding: 7px 10px; font-size: 13px; font-family: sans-serif;
    }
    .mag-field textarea { height: 70px; resize: vertical; }
    .mag-field input[type=checkbox] { width: auto; margin-right: 6px; }
    .mag-field .mag-hint { font-size: 11px; color: #8060a0; margin-top: 3px; }
    .mag-settings-actions { display: flex; gap: 10px; margin-top: 20px; justify-content: flex-end; }

    /* Review panel */
    #mag-review-overlay {
      display: none; position: fixed; inset: 0; z-index: 1000000;
      background: rgba(0,0,0,0.60); align-items: flex-start; justify-content: center;
      padding-top: 48px; overflow-y: auto;
    }
    #mag-review-overlay.open { display: flex; }
    #mag-review-box {
      background: #0e0020; border: 1px solid #7b2fff; border-radius: 14px;
      width: 820px; max-width: 96vw; color: #f0e8ff;
      font-family: sans-serif; box-shadow: 0 20px 60px rgba(0,0,0,0.8);
      margin-bottom: 40px;
    }
    .mag-review-header {
      background: linear-gradient(135deg, #2d0057, #5a0096);
      padding: 16px 22px; border-radius: 14px 14px 0 0;
      display: flex; align-items: center; gap: 12px;
    }
    .mag-review-header h3 { margin: 0; font-size: 15px; flex: 1; }
    .mag-review-body { padding: 20px 22px; }
    .mag-student-card {
      border: 1px solid #3a1060; border-radius: 10px;
      margin-bottom: 18px; overflow: hidden;
    }
    .mag-card-header {
      background: #1e0040; padding: 10px 16px;
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    }
    .mag-card-name { font-weight: bold; font-size: 14px; flex: 1; }
    .mag-card-total {
      font-size: 18px; font-weight: 900; color: #c9a0ff;
      background: rgba(123,47,255,0.20); border-radius: 6px;
      padding: 2px 10px;
    }
    .mag-card-status { font-size: 11px; padding: 2px 8px; border-radius: 20px; }
    .mag-card-status.pending   { background: #333; color: #aaa; }
    .mag-card-status.grading   { background: #3a2060; color: #c9a0ff; }
    .mag-card-status.done      { background: #0a3020; color: #60d080; }
    .mag-card-status.error     { background: #400010; color: #ff6060; }
    .mag-card-body { padding: 14px 16px; }
    .mag-scores-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px; }
    .mag-scores-table th { text-align: left; color: #9070c0; padding: 4px 8px; border-bottom: 1px solid #2a1040; }
    .mag-scores-table td { padding: 4px 8px; border-bottom: 1px solid #1a0030; vertical-align: top; }
    .mag-scores-table select { background: #2a0050; border: 1px solid #5a30a0; color: #f0e8ff; border-radius: 4px; padding: 2px 6px; font-size: 12px; }
    .mag-feedback-area {
      width: 100%; box-sizing: border-box; background: #1a0030;
      border: 1px solid #4a2080; border-radius: 6px; color: #f0e8ff;
      padding: 8px 10px; font-size: 12px; font-family: sans-serif;
      resize: vertical; height: 90px; margin-top: 4px;
    }
    .mag-feedback-label { font-size: 11px; color: #9070c0; margin-bottom: 4px; }
    .mag-card-actions { display: flex; gap: 8px; margin-top: 10px; }
    .mag-post-btn { background: #7b2fff; border: none; color: #fff; border-radius: 5px; padding: 5px 14px; cursor: pointer; font-size: 12px; }
    .mag-post-btn:hover { background: #9040ff; }
    .mag-post-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .mag-skip-btn { background: #2a1040; border: 1px solid #5a30a0; color: #c0a0e0; border-radius: 5px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
    .mag-skip-btn:hover { background: #3a1860; }
    .mag-overall-comment { font-size: 11px; color: #9070c0; margin-top: 6px; font-style: italic; }
    .mag-review-footer {
      padding: 14px 22px; border-top: 1px solid #2a1040;
      display: flex; gap: 10px; align-items: center; justify-content: flex-end;
    }
    .mag-progress-text { flex: 1; font-size: 12px; color: #9070c0; }
  `);

  // ── Toolbar ──────────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.id = 'mag-bar';
  bar.innerHTML = `
    <span class="mag-title">✦ Moodle AutoGrader</span>
    <span class="mag-sep">|</span>
    <button class="mag-btn primary" id="mag-grade-one">Grade One ▸</button>
    <button class="mag-btn primary" id="mag-grade-all">Grade All ▸▸</button>
    <span class="mag-sep">|</span>
    <button class="mag-btn" id="mag-settings-btn">⚙ Settings</button>
    <span id="mag-status"></span>
  `;
  document.body.prepend(bar);
  document.body.style.paddingTop = (document.body.style.paddingTop ? parseInt(document.body.style.paddingTop) + 40 : 40) + 'px';

  const statusEl = document.getElementById('mag-status');
  function setStatus(msg, color = '#b090d0') {
    statusEl.textContent = msg;
    statusEl.style.color = color;
  }

  // ── Settings panel ───────────────────────────────────────────────────────
  const settingsOverlay = document.createElement('div');
  settingsOverlay.id = 'mag-settings-overlay';
  settingsOverlay.innerHTML = `
    <div id="mag-settings-box">
      <h2>⚙ Moodle AutoGrader Settings</h2>
      <div class="mag-field">
        <label>Gemini API Key (free — for rubric scoring)</label>
        <input type="password" id="mag-s-gemini" placeholder="AIza...">
        <div class="mag-hint">Get free key at <strong>aistudio.google.com</strong> → Get API key</div>
      </div>
      <div class="mag-field">
        <label>Claude API Key (optional — for higher-quality feedback)</label>
        <input type="password" id="mag-s-claude" placeholder="sk-ant-...">
        <div class="mag-hint">Leave blank to use Gemini for both grading and feedback.</div>
      </div>
      <div class="mag-field">
        <label><input type="checkbox" id="mag-s-use-claude"> Use Claude for feedback comments (if key provided)</label>
      </div>
      <div class="mag-field">
        <label>Your name (used in feedback voice)</label>
        <input type="text" id="mag-s-name" placeholder="e.g. Prof. Oke">
      </div>
      <div class="mag-field">
        <label>Feedback style / tone notes</label>
        <textarea id="mag-s-style" placeholder="e.g. direct, encouraging, references specific code details, uses short sentences"></textarea>
      </div>
      <div class="mag-field">
        <label><input type="checkbox" id="mag-s-auto"> Auto-post grades without review (⚠ not recommended)</label>
      </div>
      <div class="mag-settings-actions">
        <button class="mag-btn" id="mag-s-cancel">Cancel</button>
        <button class="mag-btn primary" id="mag-s-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(settingsOverlay);

  function openSettings() {
    document.getElementById('mag-s-gemini').value   = CFG.geminiKey;
    document.getElementById('mag-s-claude').value   = CFG.claudeKey;
    document.getElementById('mag-s-use-claude').checked = CFG.useClaudeForFeedback;
    document.getElementById('mag-s-name').value     = CFG.instructorName;
    document.getElementById('mag-s-style').value    = CFG.instructorStyle;
    document.getElementById('mag-s-auto').checked   = CFG.autoPost;
    settingsOverlay.classList.add('open');
  }
  function closeSettings() { settingsOverlay.classList.remove('open'); }

  document.getElementById('mag-settings-btn').onclick = openSettings;
  document.getElementById('mag-s-cancel').onclick     = closeSettings;
  document.getElementById('mag-s-save').onclick = () => {
    set('gemini_key',      document.getElementById('mag-s-gemini').value.trim());
    set('claude_key',      document.getElementById('mag-s-claude').value.trim());
    set('claude_feedback', document.getElementById('mag-s-use-claude').checked ? 'true' : 'false');
    set('instructor_name', document.getElementById('mag-s-name').value.trim() || 'Instructor');
    set('instructor_style',document.getElementById('mag-s-style').value.trim() || 'direct and constructive');
    set('auto_post',       document.getElementById('mag-s-auto').checked ? 'true' : 'false');
    closeSettings();
    setStatus('Settings saved.', '#80d0a0');
  };
  settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) closeSettings(); });

  // ── Review panel ─────────────────────────────────────────────────────────
  const reviewOverlay = document.createElement('div');
  reviewOverlay.id = 'mag-review-overlay';
  document.body.appendChild(reviewOverlay);
  reviewOverlay.addEventListener('click', e => { if (e.target === reviewOverlay) reviewOverlay.classList.remove('open'); });

  function buildStudentCard(student, rubric, result, idx) {
    const card = document.createElement('div');
    card.className = 'mag-student-card';
    card.id = `mag-card-${student.uid}`;

    const statusClass = result ? (result.error ? 'error' : 'done') : 'pending';
    const statusText  = result ? (result.error ? '✗ Error' : '✓ Graded') : '○ Pending';

    const scoresTable = result && !result.error ? `
      <table class="mag-scores-table">
        <thead><tr><th>Criterion</th><th>Score</th><th>Justification</th></tr></thead>
        <tbody>
          ${result.scores.map((s, i) => {
            const crit = rubric[s.criterionIndex] || rubric[i] || {};
            const opts = (crit.levels || []).map(l =>
              `<option value="${l.points}" ${l.points === s.pointsAwarded ? 'selected' : ''}>${l.points} pts — ${l.description.slice(0, 40)}…</option>`
            ).join('');
            return `<tr>
              <td>${crit.name || 'Criterion ' + i}</td>
              <td><select data-uid="${student.uid}" data-crit="${i}">${opts}</select></td>
              <td>${s.justification || ''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div class="mag-overall-comment">${result.overallComment || ''}</div>
    ` : (result?.error ? `<div style="color:#ff7070;font-size:12px">⚠ ${result.error}</div>` : '<div style="color:#9070c0;font-size:12px">Waiting to be graded…</div>');

    const feedbackArea = result && !result.error
      ? `<div class="mag-feedback-label">Instructor feedback (editable before posting):</div>
         <textarea class="mag-feedback-area" id="mag-fb-${student.uid}">${result.feedback || ''}</textarea>`
      : '';

    card.innerHTML = `
      <div class="mag-card-header">
        <span class="mag-card-name">${student.name}</span>
        ${result && !result.error ? `<span class="mag-card-total">${result.totalPoints} pts</span>` : ''}
        <span class="mag-card-status ${statusClass}" id="mag-status-${student.uid}">${statusText}</span>
      </div>
      <div class="mag-card-body" id="mag-body-${student.uid}">
        ${scoresTable}
        ${feedbackArea}
        ${result && !result.error ? `
          <div class="mag-card-actions">
            <button class="mag-post-btn" id="mag-post-${student.uid}">Post Grade & Feedback</button>
            <button class="mag-skip-btn" id="mag-skip-${student.uid}">Skip</button>
          </div>` : ''}
      </div>
    `;
    return card;
  }

  function wireCardButtons(student, rubric, result, assignmentId) {
    const postBtn = document.getElementById(`mag-post-${student.uid}`);
    const skipBtn = document.getElementById(`mag-skip-${student.uid}`);
    if (!postBtn) return;

    postBtn.onclick = async () => {
      postBtn.disabled = true;
      postBtn.textContent = 'Posting…';
      try {
        // Collect edited scores from selects
        const scoreSelects = document.querySelectorAll(`select[data-uid="${student.uid}"]`);
        const editedScores = result.scores.map((s, i) => {
          const sel = scoreSelects[i];
          return { ...s, pointsAwarded: sel ? parseFloat(sel.value) : s.pointsAwarded };
        });
        const editedFeedback = document.getElementById(`mag-fb-${student.uid}`)?.value || result.feedback;
        const editedResult   = { ...result, scores: editedScores, feedback: editedFeedback };

        await postGrade(student, rubric, editedResult, assignmentId);
        document.getElementById(`mag-status-${student.uid}`).textContent = '✓ Posted';
        document.getElementById(`mag-status-${student.uid}`).className   = 'mag-card-status done';
        postBtn.textContent = '✓ Done';
        document.getElementById(`mag-card-${student.uid}`).style.opacity = '0.6';
      } catch (err) {
        postBtn.disabled = false;
        postBtn.textContent = 'Retry Post';
        document.getElementById(`mag-status-${student.uid}`).textContent = `✗ ${err.message}`;
        document.getElementById(`mag-status-${student.uid}`).className   = 'mag-card-status error';
      }
    };

    skipBtn.onclick = () => {
      document.getElementById(`mag-status-${student.uid}`).textContent = '— Skipped';
      document.getElementById(`mag-card-${student.uid}`).style.opacity = '0.45';
      skipBtn.disabled = true; postBtn.disabled = true;
    };
  }

  function openReviewPanel(title, students, rubric, results = {}) {
    reviewOverlay.innerHTML = '';
    const box = document.createElement('div');
    box.id = 'mag-review-box';

    const doneCount    = Object.values(results).filter(r => r && !r.error).length;
    const postedCount  = 0;

    box.innerHTML = `
      <div class="mag-review-header">
        <h3>✦ AutoGrader Review — ${title}</h3>
        <button class="mag-btn" id="mag-review-close" style="padding:3px 10px">✕</button>
      </div>
      <div class="mag-review-body" id="mag-review-cards"></div>
      <div class="mag-review-footer">
        <span class="mag-progress-text" id="mag-review-progress">
          ${doneCount} / ${students.length} graded
        </span>
        <button class="mag-btn primary" id="mag-post-all-btn">Post All Approved</button>
        <button class="mag-btn" id="mag-review-close2">Close</button>
      </div>
    `;
    reviewOverlay.appendChild(box);
    reviewOverlay.classList.add('open');

    const cardsEl = document.getElementById('mag-review-cards');
    for (const student of students) {
      const card = buildStudentCard(student, rubric, results[student.uid] || null, students.indexOf(student));
      cardsEl.appendChild(card);
      wireCardButtons(student, rubric, results[student.uid] || null, assignId);
    }

    document.getElementById('mag-review-close').onclick  = () => reviewOverlay.classList.remove('open');
    document.getElementById('mag-review-close2').onclick = () => reviewOverlay.classList.remove('open');

    document.getElementById('mag-post-all-btn').onclick = async () => {
      const allBtns = document.querySelectorAll('.mag-post-btn:not(:disabled)');
      for (const btn of allBtns) { btn.click(); await sleep(800); }
    };

    return {
      updateCard(student, result) {
        const old = document.getElementById(`mag-card-${student.uid}`);
        const newCard = buildStudentCard(student, rubric, result, students.indexOf(student));
        if (old) old.replaceWith(newCard);
        wireCardButtons(student, rubric, result, assignId);
        const done = [...document.querySelectorAll('.mag-card-status.done, .mag-card-status.error')].length;
        const prog = document.getElementById('mag-review-progress');
        if (prog) prog.textContent = `${done} / ${students.length} graded`;
      },
    };
  }

  // ── Guard: check API keys ─────────────────────────────────────────────────
  function assertKeys() {
    if (!CFG.geminiKey) {
      openSettings();
      throw new Error('Please configure your Gemini API key in Settings first.');
    }
  }

  // ── Orchestrators ─────────────────────────────────────────────────────────
  async function runGradeAll() {
    try {
      assertKeys();
    } catch (e) { setStatus('⚠ ' + e.message, '#ff9060'); return; }

    setStatus('Reading assignment…', '#c9a0ff');
    const title        = parseAssignmentTitle();
    const instructions = parseAssignmentInstructions();
    const students     = parseStudentList();

    if (!students.length) {
      setStatus('No student links found — navigate to the Submissions tab.', '#ff9060');
      return;
    }

    // Parse rubric from first student's grading page
    setStatus('Loading rubric…', '#c9a0ff');
    let rubric = [];
    try {
      rubric = await fetchRubricFromGradePage(students[0]);
    } catch (e) {
      setStatus('Could not load rubric: ' + e.message, '#ff9060');
    }

    // Open review panel with all students (pending)
    const panel  = openReviewPanel(title, students, rubric, {});
    const results = {};

    setStatus(`Grading ${students.length} students…`, '#c9a0ff');

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      setStatus(`Grading ${i + 1}/${students.length}: ${student.name}…`, '#c9a0ff');

      // Mark as grading
      const statusEl2 = document.getElementById(`mag-status-${student.uid}`);
      if (statusEl2) { statusEl2.textContent = '⟳ Grading…'; statusEl2.className = 'mag-card-status grading'; }

      try {
        let submissionText = student.onlineText || '';
        let inlineData     = null;

        let fileLinks = student.fileLinks;
        if (!fileLinks.length) {
          const fetched = await fetchStudentFiles(student);
          fileLinks = fetched.fileLinks;
          if (!submissionText && fetched.onlineText) submissionText = fetched.onlineText;
        }
        if (fileLinks.length) {
          const file = fileLinks[0];
          const extracted = await extractSubmission(file.url, file.filename);
          submissionText = extracted.text || '';
          inlineData     = extracted.inlineData;
        }

        const result = await gradeSubmission(title, instructions, rubric, submissionText, inlineData);
        results[student.uid] = result;
        panel.updateCard(student, result);

        if (CFG.autoPost) {
          await postGrade(student, rubric, result, assignId);
        }
      } catch (err) {
        results[student.uid] = { error: err.message };
        panel.updateCard(student, { error: err.message });
      }

      await sleep(400); // be gentle on API rate limits
    }

    setStatus(`All ${students.length} students graded. Review & post from the panel.`, '#80d0a0');
  }

  async function runGradeOne() {
    try {
      assertKeys();
    } catch (e) { setStatus('⚠ ' + e.message, '#ff9060'); return; }

    setStatus('Reading assignment…', '#c9a0ff');
    const title        = parseAssignmentTitle();
    const instructions = parseAssignmentInstructions();
    const students     = parseStudentList();

    if (!students.length) {
      setStatus('No student links found — navigate to the Submissions tab.', '#ff9060');
      return;
    }

    setStatus('Loading rubric…', '#c9a0ff');
    let rubric = [];
    try {
      rubric = await fetchRubricFromGradePage(students[0]);
    } catch (e) { setStatus('Could not load rubric: ' + e.message, '#ff9060'); }

    // Open panel showing one student at a time
    let currentIdx = 0;
    const results  = {};
    const panel    = openReviewPanel(title, [students[0]], rubric, {});

    const gradeCurrentStudent = async () => {
      if (currentIdx >= students.length) {
        setStatus('All students reviewed.', '#80d0a0');
        return;
      }
      const student = students[currentIdx];
      setStatus(`Grading ${currentIdx + 1}/${students.length}: ${student.name}…`, '#c9a0ff');

      const statusEl2 = document.getElementById(`mag-status-${student.uid}`);
      if (statusEl2) { statusEl2.textContent = '⟳ Grading…'; statusEl2.className = 'mag-card-status grading'; }

      try {
        let submissionText = student.onlineText || '';
        let inlineData     = null;
        let fileLinks = student.fileLinks;
        if (!fileLinks.length) {
          const fetched = await fetchStudentFiles(student);
          fileLinks = fetched.fileLinks;
          if (!submissionText && fetched.onlineText) submissionText = fetched.onlineText;
        }
        if (fileLinks.length) {
          const file = fileLinks[0];
          const extracted = await extractSubmission(file.url, file.filename);
          submissionText = extracted.text || '';
          inlineData     = extracted.inlineData;
        }
        const result = await gradeSubmission(title, instructions, rubric, submissionText, inlineData);
        results[student.uid] = result;
        panel.updateCard(student, result);
        setStatus(`${student.name} graded. Review and post, then click Next.`, '#c9a0ff');
      } catch (err) {
        results[student.uid] = { error: err.message };
        panel.updateCard(student, { error: err.message });
        setStatus(`Error grading ${student.name}: ${err.message}`, '#ff9060');
      }
    };

    // Add Next button to footer
    await sleep(100);
    const footer = document.querySelector('.mag-review-footer');
    if (footer) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'mag-btn';
      nextBtn.textContent = 'Next Student ▸';
      nextBtn.onclick = async () => {
        currentIdx++;
        if (currentIdx >= students.length) {
          nextBtn.disabled = true;
          nextBtn.textContent = 'All done ✓';
          setStatus('All students graded.', '#80d0a0');
          return;
        }
        const next = students[currentIdx];
        const cardsEl = document.getElementById('mag-review-cards');
        const newCard = buildStudentCard(next, rubric, null, currentIdx);
        cardsEl.appendChild(newCard);
        newCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        await gradeCurrentStudent();
      };
      footer.insertBefore(nextBtn, footer.querySelector('#mag-post-all-btn'));
    }

    await gradeCurrentStudent();
  }

  // ── Button wiring ─────────────────────────────────────────────────────────
  document.getElementById('mag-grade-one').onclick = () => runGradeOne().catch(e => setStatus('⚠ ' + e.message, '#ff9060'));
  document.getElementById('mag-grade-all').onclick = () => runGradeAll().catch(e => setStatus('⚠ ' + e.message, '#ff9060'));

  // Show first-run prompt if no keys configured
  if (!CFG.geminiKey) {
    setStatus('First run — configure API keys in ⚙ Settings.', '#ffb060');
  } else {
    setStatus('Ready.', '#80d0a0');
  }

})();
