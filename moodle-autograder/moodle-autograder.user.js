// ==UserScript==
// @name         Moodle AutoGrader
// @namespace    moodle-autograder
// @version      2.5.35
// @description  AI-powered grading assistant — reads rubric, reviews submissions, grades and posts feedback.
// @author       Bunmi Oke
// @updateURL    https://raw.githubusercontent.com/itisbunmioke/moodle-nova-sync/master/moodle-autograder/moodle-autograder.user.js
// @downloadURL  https://raw.githubusercontent.com/itisbunmioke/moodle-nova-sync/master/moodle-autograder/moodle-autograder.user.js
// @match        *://students.willisonline.ca/mod/assign/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      *
// @connect      generativelanguage.googleapis.com
// @connect      api.anthropic.com
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @require      https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js
// @require      https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// ==/UserScript==

(function () {
  'use strict';

  // ── API endpoints ────────────────────────────────────────────────────────
  const GEMINI_ENDPOINT      = /** @param {string} k @param {string} m */ (k, m) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${k}`;
  const OPENROUTER_ENDPOINT  = 'https://openrouter.ai/api/v1/chat/completions';
  const HF_ENDPOINT          = 'https://api-inference.huggingface.co/v1/chat/completions';

  const OLLAMA_ENDPOINT      = 'http://localhost:11434/v1/chat/completions';
  const CLAUDE_ENDPOINT      = 'https://api.anthropic.com/v1/messages';
  const CLAUDE_MODEL         = 'claude-haiku-4-5-20251001';
  const GROQ_ENDPOINT        = 'https://api.groq.com/openai/v1/chat/completions';
  const GROQ_DEFAULT         = 'llama-3.3-70b-versatile';
  const MISTRAL_ENDPOINT     = 'https://api.mistral.ai/v1/chat/completions';
  const MISTRAL_DEFAULT      = 'mistral-small-latest';
  const OPENROUTER_DEFAULT   = 'deepseek/deepseek-chat-v3-0324:free';
  const HF_DEFAULT           = 'meta-llama/Llama-3.1-8B-Instruct';
  const OLLAMA_DEFAULT       = 'phi3';
  const GEMINI_DEFAULT       = 'gemini-3.6-flash';

  // ── Settings ─────────────────────────────────────────────────────────────
  const get = (k, d = '') => { const v = GM_getValue('mag_' + k); return v !== undefined ? v : d; };
  const set = (k, v)      => GM_setValue('mag_' + k, v);

  const CFG = {
    get geminiKeys()          { return get('gemini_key').split(',').map(k => k.trim()).filter(Boolean); },
    get geminiKey()           { return CFG.geminiKeys.find(k => !exhaustedGeminiKeys.has(k)) || ''; },
    get geminiModel()         { return get('gemini_model', GEMINI_DEFAULT); },
    get groqKey()             { return get('groq_key'); },
    get groqModel()           { return get('groq_model', GROQ_DEFAULT); },
    get mistralKey()          { return get('mistral_key'); },
    get mistralModel()        { return get('mistral_model', MISTRAL_DEFAULT); },
    get openrouterKey()       { return get('openrouter_key'); },
    get openrouterModel()     { return get('openrouter_model', OPENROUTER_DEFAULT); },
    get hfKey()               { return get('hf_key'); },
    get hfModel()             { return get('hf_model', HF_DEFAULT); },

    get ollamaEnabled()       { return get('ollama_enabled', 'false') === 'true'; },
    get ollamaModel()         { return get('ollama_model', OLLAMA_DEFAULT); },
    get aiKey()               { return CFG.geminiKey || CFG.hfKey || CFG.ollamaEnabled || CFG.openrouterKey; },
    get claudeKey()           { return get('claude_key'); },
    get useClaudeForFeedback(){ return get('claude_feedback', 'true') === 'true'; },
    get instructorName()      { return get('instructor_name', 'Instructor'); },
    get instructorStyle()     { return get('instructor_style', 'direct and constructive'); },
    get autoPost()            { return get('auto_post',      'false') === 'true'; },
    get postRemarks()              { return get('post_remarks',            'false') === 'true'; },
    get postRemarksDeductedOnly()  { return get('post_remarks_deducted_only', 'false') === 'true'; },
  };

  // ── Page detection ───────────────────────────────────────────────────────
  const assignId   = new URL(location.href).searchParams.get('id') || '';
  const pageAction = new URL(location.href).searchParams.get('action') || '';
  // Only inject on grading pages; skip the home Assignment page (no action / action=view)
  if (!assignId || !pageAction || pageAction === 'view') return;

  // ── Moodle AJAX helpers ──────────────────────────────────────────────────
  function getSesskey() {
    return /** @type {any} */(window).M?.cfg?.sesskey
        || document.querySelector('input[name=sesskey]')?.value || '';
  }

  // Returns the assignment DB ID from data-assignmentid attributes.
  // Different from the course-module ID in the URL (?id=602901).
  // Moodle web service calls need the DB ID (e.g. 93694), not the cmid.
  function getAssignmentDbId() {
    return document.querySelector('[data-assignmentid]')?.getAttribute('data-assignmentid') || null;
  }

  // After saving a grade via form POST the AMD grader still shows the old (unselected) rubric
  // because the SPA cached its state before we posted. We fix this by directly updating the
  // live DOM: find each rubric level cell by its ID suffix, clear siblings, mark it checked,
  // and fire a click so Moodle's own cell-click handler (if present) can also run.
  // Also update the Atto feedback editor div and its backing textarea.
  function applyResultToLiveDom(/** @type {any[]} */ rubric, /** @type {any} */ result) {
    // ── Phase 1: mark ALL rubric level cells first ────────────────────────────
    // Build a map of criterionIndex → {row, cid} for use in Phase 2.
    // We click ALL cells before Phase 2 runs, because some Moodle AMD themes
    // only render the remark <textarea> after a level cell is selected.
    /** @type {Map<number, {row: HTMLElement|null, cid: string|null}>} */
    const rowMap = new Map();
    for (const score of result.scores || []) {
      const criterion = rubric[score.criterionIndex];
      if (!criterion) continue;
      const matchedLevel = criterion.levels.find((/** @type {any} */ l) => l.points === score.pointsAwarded)
                        || criterion.levels.reduce((/** @type {any} */ a, /** @type {any} */ b) =>
                            Math.abs(b.points - score.pointsAwarded) < Math.abs(a.points - score.pointsAwarded) ? b : a);
      if (!matchedLevel?.id) { rowMap.set(score.criterionIndex, { row: null, cid: criterion?.criterionId || null }); continue; }

      const cell = /** @type {HTMLElement|null} */(
        document.querySelector(`[id$="-levels-${matchedLevel.id}"]`)
        || document.querySelector(`[data-levelid="${matchedLevel.id}"]`)
      );
      if (!cell) { console.warn('[MAG] No DOM cell for levelId', matchedLevel.id); rowMap.set(score.criterionIndex, { row: null, cid: criterion?.criterionId || null }); continue; }

      const row = /** @type {HTMLElement|null} */(cell.closest('tr.criterion, tr, [class*="criterion"]'));
      if (row) {
        for (const sib of /** @type {NodeListOf<HTMLElement>} */(row.querySelectorAll('td.level, [data-levelid]'))) {
          sib.classList.remove('checked', 'selected', 'currentlevel');
          sib.removeAttribute('aria-checked');
        }
      }
      cell.classList.add('checked');
      cell.setAttribute('aria-checked', 'true');
      try { cell.click(); } catch {}

      const cid = criterion?.criterionId
               || (cell.id.match(/^rubric-criteria-(\d+)-levels-/) || [])[1]
               || /** @type {any} */(cell).dataset?.criterionid
               || null;
      if (cid) {
        const inp = /** @type {HTMLInputElement|null} */(
          document.querySelector(`input[name="advancedgrading[criteria][${cid}][levelid]"]`)
        );
        if (inp) inp.value = String(matchedLevel.id);
      }
      console.log('[MAG] Applied level', matchedLevel.id, '→', cell.id || /** @type {any} */(cell).dataset?.levelid);
      rowMap.set(score.criterionIndex, { row, cid });
    }

    // ── Phase 2: write justifications to remark textareas ────────────────────
    // Runs immediately AND again after 700 ms (in case AMD reveals textareas
    // asynchronously after the cell clicks above).
    // Four strategies per criterion, falling back to positional DOM order.
    const writeRemarks = () => {
      if (!CFG.postRemarks) return;
      // Positional fallback: all remark-like textareas in DOM order.
      const allRemarkTAs = /** @type {HTMLTextAreaElement[]} */([
        ...document.querySelectorAll('textarea[name*="[remark]"], textarea[name*="criteria"][name*="remark"]'),
      ]);

      for (const score of result.scores || []) {
        if (!score.justification) continue;
        const criterion2 = rubric[score.criterionIndex];
        // "Deductions only" mode: skip criteria where student earned the maximum points
        if (CFG.postRemarksDeductedOnly && criterion2) {
          const maxPts = Math.max(0, ...(criterion2.levels || []).map((/** @type {any} */ l) => l.points));
          if (score.pointsAwarded >= maxPts) continue;
        }
        const { row, cid } = rowMap.get(score.criterionIndex) || {};

        let ta = /** @type {HTMLTextAreaElement|null} */(null);

        // S1: exact name attribute
        if (cid) ta = /** @type {HTMLTextAreaElement|null} */(
          document.querySelector(`textarea[name="advancedgrading[criteria][${cid}][remark]"]`)
        );
        // S2: any textarea inside the criterion row or its next sibling row
        if (!ta && row) {
          ta = /** @type {HTMLTextAreaElement|null} */(
            row.querySelector('textarea')
            || row.nextElementSibling?.querySelector('textarea')
          );
        }
        // S3: cid-based container search (covers separate criterion containers)
        if (!ta && cid) {
          ta = /** @type {HTMLTextAreaElement|null} */(
            document.querySelector(`#rubric-criteria-${cid} textarea`)
            || document.querySelector(`[id*="criteria-${cid}"] textarea`)
            || document.querySelector(`[data-criterionid="${cid}"] textarea`)
          );
        }
        // S4: positional — N-th remark textarea in the page
        if (!ta) ta = allRemarkTAs[score.criterionIndex] ?? null;

        if (ta) {
          ta.value = score.justification;
          ta.dispatchEvent(new Event('input',  { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('[MAG] Wrote remark for criterion', cid ?? score.criterionIndex);
        } else {
          console.warn('[MAG] Remark textarea not found for criterion', cid ?? score.criterionIndex,
            '— justification sent via grade POST body only');
        }
      }
    };

    writeRemarks(); // immediate attempt
    setTimeout(writeRemarks, 700); // retry after AMD async handlers may have rendered textareas

    // Moodle 4.05 uses editor_tiny (TinyMCE 6). The editor lives in a same-origin
    // iframe: IFRAME#id_assignfeedbackcomments_editor_ifr (.tox-edit-area__iframe).
    // window.tinymce is NOT exposed by Moodle's AMD loader, so the TinyMCE API is
    // unavailable. Instead we write directly to the iframe body.
    // Two-pass strategy:
    //   Pass 1 (immediate):   write to textarea so TinyMCE reads our value on init
    //   Pass 2 (1.5 s later): iframe is loaded → write directly to its body to
    //                          update the visible content without a page reload
    const feedback = result.feedback || '';
    if (feedback) {
      // feedback may already be HTML (when images are attached)
      const feedbackHtml = feedback.trimStart().startsWith('<')
        ? feedback
        : '<p>' + feedback.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';

      const getEditorFrame = () => {
        const ta = /** @type {HTMLTextAreaElement|null} */(
          document.querySelector('textarea[name*="assignfeedbackcomments_editor"]')
        );
        const frameId = (ta?.id || 'id_assignfeedbackcomments_editor') + '_ifr';
        return /** @type {HTMLIFrameElement|null} */(document.getElementById(frameId));
      };

      const applyFeedback = (/** @type {boolean} */ writeToIframe) => {
        if (writeToIframe) {
          const frame = getEditorFrame();
          const body  = frame?.contentDocument?.body;
          if (body) {
            body.innerHTML = feedbackHtml;
            // Sync backing textarea so form submission value is also current
            const ta = /** @type {HTMLTextAreaElement|null} */(
              document.querySelector('textarea[name*="assignfeedbackcomments_editor"]')
            );
            if (ta) ta.value = feedback;
            console.log('[MAG] Feedback written to TinyMCE iframe body', frame.id);
            return;
          }
          console.warn('[MAG] TinyMCE iframe not ready; frame:', frame?.id, '| body:', !!body);
          return;
        }
        // Pass 1: pre-load textarea so TinyMCE reads it during initialisation
        const ta = /** @type {HTMLTextAreaElement|null} */(
          document.querySelector('textarea[name*="assignfeedbackcomments_editor"]')
          || document.querySelector('textarea[id*="assignfeedbackcomments"]')
        );
        if (ta) {
          ta.value = feedback;
          console.log('[MAG] Feedback pre-loaded into textarea', ta.id || ta.name);
        }
      };

      applyFeedback(false);                        // pass 1: textarea pre-load
      setTimeout(() => applyFeedback(true), 1500); // pass 2: direct iframe write
    }
  }

  // Call Moodle's internal AJAX service at /lib/ajax/service.php.
  // This is the same endpoint all AMD grading modules use internally.
  async function moodleAjax(methodname, args) {
    const sesskey = getSesskey();
    if (!sesskey) throw new Error('Could not read Moodle sesskey — are you logged in?');
    const r = await xhr('POST',
      `${location.origin}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=${methodname}`,
      {
        body:    JSON.stringify([{ methodname, args }]),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    let parsed;
    try { parsed = JSON.parse(r.responseText); }
    catch { throw new Error(`Moodle returned non-JSON (HTTP ${r.status}): ${r.responseText.slice(0, 120)}`); }

    console.log('[MAG] moodleAjax', methodname, 'HTTP', r.status,
      '→', JSON.stringify(parsed).slice(0, 300));

    if (!Array.isArray(parsed)) {
      // Top-level error object, e.g. {"error":true,"message":"..."} for bad sesskey
      const msg = parsed?.message || parsed?.exception?.message
               || (typeof parsed?.error === 'string' ? parsed.error : null)
               || `Moodle error (HTTP ${r.status}): ${JSON.stringify(parsed).slice(0, 120)}`;
      throw new Error(msg);
    }
    if (parsed[0]?.error) {
      const ex  = parsed[0]?.exception;
      const msg = ex?.message || ex?.errorcode
               || (typeof parsed[0]?.error === 'string' ? parsed[0].error : null)
               || `Moodle AJAX error: ${JSON.stringify(parsed[0]).slice(0, 120)}`;
      throw new Error(msg);
    }
    return parsed[0].data;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function xhr(method, url, /** @type {{headers?:object, body?:any, responseType?:string, timeout?:number}} */ opts = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url,
        headers:      opts.headers      || {},
        data:         opts.body         || undefined,
        responseType: opts.responseType || 'text',
        timeout:      opts.timeout      || 45000,
        onload:    r  => resolve(r),
        onerror:   e  => reject(new Error(e?.error || e?.message || e?.statusText || 'Network request failed')),
        ontimeout: () => reject(new Error(`Timed out fetching ${url.split('/').pop()?.split('?')[0] || url}`)),
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
  // Extract text from a PDF ArrayBuffer using pdfjs-dist (loaded via @require).
  // Returns null if extraction fails — caller falls back to inlineData for Gemini.
  async function pdfToText(/** @type {ArrayBuffer} */ buffer) {
    try {
      const lib = /** @type {any} */ (window).pdfjsLib;
      if (!lib) return null;
      if (!lib.GlobalWorkerOptions.workerSrc) {
        lib.GlobalWorkerOptions.workerSrc =
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      }
      const pdf = await lib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const parts = [];
      for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
        const page    = await pdf.getPage(i);
        const content = await page.getTextContent();
        parts.push(content.items.map((/** @type {any} */ item) => item.str).join(' '));
      }
      return parts.filter(Boolean).join('\n\n').trim() || null;
    } catch {
      return null;
    }
  }

  // Extract plain text from a .docx ArrayBuffer using mammoth.js (@require).
  async function docxToText(/** @type {ArrayBuffer} */ buffer) {
    try {
      const mammoth = /** @type {any} */ (window).mammoth;
      if (!mammoth) return null;
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      return result.value?.trim() || null;
    } catch {
      return null;
    }
  }

  async function fetchFile(url, /** @type {number} */ timeoutMs = 60000) {
    const r = await xhr('GET', url, { responseType: 'arraybuffer', timeout: timeoutMs });
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

  // Distribute a char budget across beginning, middle, and end of a text block.
  // Front-only truncation hides later slides, PDF body sections, and tail code —
  // sampling all three thirds keeps the full document representatively visible.
  // The omission markers explicitly tell the AI not to claim absence for hidden gaps.
  function sampleContent(/** @type {string} */ text, /** @type {number} */ maxLen) {
    if (text.length <= maxLen) return text;
    const startLen = Math.floor(maxLen * 0.4);
    const midLen   = Math.floor(maxLen * 0.3);
    const endLen   = maxLen - startLen - midLen;
    const midOff   = Math.floor((text.length - midLen) / 2);
    const GAP = '\n[…content omitted — do not claim absence for topics that may be in this gap…]\n';
    return text.slice(0, startLen) + GAP
         + text.slice(midOff, midOff + midLen) + GAP
         + text.slice(-endLen);
  }

  // Unpack a ZIP and extract text from every supported file inside it.
  // Uses fflate which decompresses in setInterval-based slices — genuinely non-blocking,
  // so the event loop stays live, status labels update, and timeouts fire correctly.
  // Returns null if nothing could be extracted — callers must not pass null to the AI.
  async function extractZip(/** @type {ArrayBuffer} */ buffer) {
    const fflate = /** @type {any} */ (window).fflate;
    if (!fflate) throw new Error('fflate library not loaded — check @require header');
    const SUPPORTED      = new Set(['py','ipynb','csv','txt','md','r','sql','json','pdf','docx','xlsx','xls','pptx']);
    const MAX_FILE_BYTES = 50 * 1024 * 1024;
    const MAX_CSV_LINES  = 300;
    const MAX_PER_FILE   = 8000;

    // fflate.unzip is genuinely async (chunked via setInterval) — safe to await without
    // any wrapping timeout; the event loop is never blocked for more than a single slice.
    let unzipped;
    try {
      unzipped = await new Promise((resolve, reject) => {
        fflate.unzip(new Uint8Array(buffer), (/** @type {any} */ err, /** @type {any} */ files) => {
          if (err) reject(err); else resolve(files);
        });
      });
    } catch (e) {
      throw new Error(`ZIP could not be opened: ${/** @type {any} */(e).message}`);
    }

    // fflate returns a flat { path: Uint8Array } map (no dir entries)
    const entries = /** @type {[string, Uint8Array][]} */(Object.entries(unzipped))
      .filter(([name]) =>
        !name.endsWith('/') &&
        !name.startsWith('__MACOSX') &&
        !name.split('/').some(p => p.startsWith('.')) &&
        SUPPORTED.has((name.split('.').pop() || '').toLowerCase())
      )
      .sort(([a], [b]) => a.localeCompare(b));

    if (!entries.length) return { text: null, innerFilenames: [] };

    const parts      = [];
    const errorNotes = [];

    for (const [name, data] of entries) {
      const ext = (name.split('.').pop() || '').toLowerCase();
      // data.buffer may be a shared backing buffer — slice out the owned portion as a plain ArrayBuffer
      const ab = /** @type {ArrayBuffer} */ (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));

      if (ab.byteLength > MAX_FILE_BYTES) {
        errorNotes.push(`${name}: ${(ab.byteLength / 1048576).toFixed(0)} MB — skipped`);
        continue;
      }

      // Yield to the event loop between files so the status label can update
      await new Promise(r => setTimeout(r, 0));

      let text = '';
      try {
        if (ext === 'csv') {
          const raw   = bufferToText(ab);
          const lines = raw.split('\n').filter(l => l.trim());
          text = `[CSV DATASET]\n` + lines.slice(0, MAX_CSV_LINES).join('\n');
          if (lines.length > MAX_CSV_LINES) text += `\n[… ${lines.length - MAX_CSV_LINES} more rows omitted]`;
        } else if (ext === 'pdf') {
          // pdfjs uses a Web Worker and is genuinely async — Promise.race is safe here
          const extracted = await Promise.race([
            pdfToText(ab),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 45000)),
          ]);
          text = `[PDF WRITTEN SUMMARY]\n${extracted || '(PDF contained no extractable text — may be scanned)'}`;
        } else if (ext === 'docx') {
          text = `[WORD DOCUMENT]\n${(await docxToText(ab)) || bufferToText(ab)}`;
        } else if (ext === 'xlsx' || ext === 'xls') {
          text = `[SPREADSHEET DATA]\n${parseXLSX(ab)}`;
        } else if (ext === 'ipynb') {
          text = `[JUPYTER NOTEBOOK]\n${parseIPYNB(bufferToText(ab))}`;
        } else if (ext === 'py') {
          text = `[PYTHON CODE]\n${bufferToText(ab)}`;
        } else if (ext === 'pptx') {
          // PPTX is itself a ZIP — use fflate's synchronous API to unpack it
          // (we're already inside fflate's async callback so sync is fine here)
          try {
            const inner = fflate.unzipSync(new Uint8Array(ab));
            const slides = Object.keys(inner)
              .filter(n => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
              .sort((a, b) => {
                const na = parseInt((a.match(/slide(\d+)\.xml/i) || [])[1] || '0');
                const nb = parseInt((b.match(/slide(\d+)\.xml/i) || [])[1] || '0');
                return na - nb;
              });
            const slideTexts = slides.map(n => {
              const xml   = new TextDecoder('utf-8', { fatal: false }).decode(inner[n]);
              // Extract text runs (<a:t> tags are PowerPoint's text spans)
              const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
                .map(m => m[1].trim()).filter(Boolean);
              const num = (n.match(/slide(\d+)\.xml/i) || [])[1] || '?';
              return texts.length ? `[Slide ${num}]\n${texts.join(' ')}` : '';
            }).filter(Boolean);
            text = `[PRESENTATION]\n${slideTexts.join('\n\n') || '(no extractable text in slides)'}`;
          } catch (e) {
            text = `[PRESENTATION — could not parse slides: ${/** @type {any} */(e).message}]`;
          }
        } else {
          text = bufferToText(ab);
        }
      } catch (e) {
        errorNotes.push(`${name}: parse error (${/** @type {any} */(e).message})`);
        continue;
      }

      if (text.length > MAX_PER_FILE) text = sampleContent(text, MAX_PER_FILE);
      parts.push(`\n\n=== ${name} ===\n${text.trim()}`);
    }

    // Collect basenames of every supported entry for the submission manifest.
    const innerFilenames = entries.map(([name]) => name.split('/').pop() || name);
    if (!parts.length) return { text: null, innerFilenames };

    let text = parts.join('');
    if (errorNotes.length) text += `\n\n[Note: ${errorNotes.join('; ')}]`;
    return { text, innerFilenames };
  }

  // Returns { text, inlineData } — inlineData used for PDFs sent directly to Gemini
  async function extractSubmission(fileUrl, filename) {
    const ext    = (filename.split('.').pop() || '').toLowerCase();
    const isZip  = ext === 'zip';
    const { buffer, mime } = await fetchFile(fileUrl, isZip ? 180000 : 60000); // ZIPs get 3 min

    if (isZip || mime.includes('zip') || mime.includes('x-zip')) {
      const { text: zipText, innerFilenames } = await extractZip(buffer);
      return { text: zipText, inlineData: null, innerFilenames };
    }
    if (ext === 'pdf' || mime.includes('pdf')) {
      // Try text extraction first — works with all text-based AI models (HuggingFace, OpenRouter, Ollama).
      // Fall back to base64 inlineData only for Gemini (handles scanned/image PDFs).
      const extracted = await pdfToText(buffer);
      if (extracted && extracted.length > 30) {
        return { text: `[PDF WRITTEN SUMMARY]\n${extracted}`, inlineData: null };
      }
      return { text: null, inlineData: { mimeType: 'application/pdf', data: toBase64(buffer) } };
    }
    if (ext === 'docx' || mime.includes('wordprocessingml') || mime.includes('msword')) {
      const extracted = await docxToText(buffer);
      return { text: extracted || bufferToText(buffer), inlineData: null };
    }
    if (ext === 'xlsx' || ext === 'xls' || mime.includes('spreadsheetml') || mime.includes('excel')) {
      return { text: `[SPREADSHEET DATA]\n${parseXLSX(buffer)}`, inlineData: null };
    }
    if (ext === 'ipynb') {
      return { text: `[JUPYTER NOTEBOOK]\n${parseIPYNB(bufferToText(buffer))}`, inlineData: null };
    }
    if (ext === 'py') {
      return { text: `[PYTHON CODE]\n${bufferToText(buffer)}`, inlineData: null };
    }
    if (ext === 'csv') {
      return { text: `[CSV DATASET]\n${bufferToText(buffer)}`, inlineData: null };
    }
    if (ext === 'pptx' || mime.includes('presentationml') || mime.includes('powerpoint')) {
      // PPTX is a ZIP of XML files — same extraction as inside extractZip
      try {
        const fflate = /** @type {any} */ (window).fflate;
        const inner  = fflate.unzipSync(new Uint8Array(buffer));
        const slides = Object.keys(inner)
          .filter(n => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
          .sort((a, b) => {
            const na = parseInt((a.match(/slide(\d+)\.xml/i) || [])[1] || '0');
            const nb = parseInt((b.match(/slide(\d+)\.xml/i) || [])[1] || '0');
            return na - nb;
          });
        const slideTexts = slides.map(n => {
          const xml   = new TextDecoder('utf-8', { fatal: false }).decode(inner[n]);
          const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
            .map(m => m[1].trim()).filter(Boolean);
          const num = (n.match(/slide(\d+)\.xml/i) || [])[1] || '?';
          return texts.length ? `[Slide ${num}]\n${texts.join(' ')}` : '';
        }).filter(Boolean);
        return { text: `[PRESENTATION]\n${slideTexts.join('\n\n') || '(no extractable text in slides)'}`, inlineData: null };
      } catch (e) {
        return { text: `[PRESENTATION — could not parse slides: ${/** @type {any} */(e).message}]`, inlineData: null };
      }
    }
    // .txt / .md / .r / .sql / anything else — raw text
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

  // Always fetches the Assignment tab page (no action= param) so title + instructions
  // are available regardless of which tab the user is currently on.
  async function fetchAssignmentDetails() {
    const assignUrl = `${location.origin}/mod/assign/view.php?id=${assignId}`;
    try {
      const r   = await xhr('GET', assignUrl);
      const doc = new DOMParser().parseFromString(r.responseText, 'text/html');

      const instrEl = doc.querySelector('.activity-description, .assign-intro, [data-region="assign-intro"]');
      const instructions = instrEl
        ? /** @type {HTMLElement} */(instrEl).textContent.trim()
        : '(No instructions found on assignment page)';

      const titleEl = doc.querySelector('h1') || doc.querySelector('h2');
      const title   = titleEl ? titleEl.textContent.trim() : 'Assignment';

      return { title, instructions };
    } catch {
      // If fetch fails fall back to what's on the current page
      return { title: parseAssignmentTitle(), instructions: parseAssignmentInstructions() };
    }
  }

  // Parse Moodle Advanced Grading Rubric from the DOM of a grade page
  // Confirmed against Willis Moodle HTML: tr.criterion rows, td.description for name,
  // td.level cells, div.definition for text, span.scorevalue for points.
  // IDs are extracted from element id attributes (rubric-criteria-{cid}-levels-{lid})
  // since the preview page has no radio inputs; grading page constructs field names from these IDs.
  function parseRubric(doc = document) {
    const criteria = [];
    const rows = [...doc.querySelectorAll('tr.criterion')];

    for (const row of rows) {
      // Criterion name sits directly inside td.description (confirmed — no child .name span)
      const nameEl = row.querySelector('td.description');
      const name   = nameEl ? nameEl.textContent.trim() : 'Criterion';

      // Willis rubric has no separate description text under the criterion name
      const desc = '';

      // Criterion ID from tr id: "rubric-criteria-{criterionId}".
      // Moodle 4 grader omits the id on tr.criterion — fall back to extracting it
      // from the first td.level id: "rubric-criteria-{cid}-levels-{lid}".
      let criterionId = (row.id.match(/rubric-criteria-(\d+)$/) || [])[1] || null;

      const levels = [];
      const levelEls = row.querySelectorAll('td.level');
      for (const lvl of levelEls) {
        // Level ID from td id: "rubric-criteria-{cid}-levels-{levelId}"
        const levelId = (lvl.id.match(/-levels-(\d+)$/) || [])[1] || null;
        // Opportunistically extract criterionId from level cell id when tr has no id
        if (!criterionId && lvl.id) {
          criterionId = (lvl.id.match(/^rubric-criteria-(\d+)-levels-/) || [])[1] || null;
        }
        // Score: span.scorevalue (confirmed); fall back to div.score textContent
        const scoreEl = lvl.querySelector('.scorevalue') || lvl.querySelector('.score');
        // Definition text: div.definition (confirmed)
        const defEl   = lvl.querySelector('.definition');
        const points  = parseFloat(scoreEl?.textContent || '0') || 0;
        // inputName follows Moodle Advanced Grading field convention
        const inputName = criterionId ? `advancedgrading[criteria][${criterionId}][levelid]` : null;
        levels.push({ id: levelId, inputName, points, description: defEl ? defEl.textContent.trim() : '' });
      }
      levels.sort((a, b) => a.points - b.points);

      criteria.push({ criterionId, name, description: desc, levels });
    }
    return criteria;
  }

  // Scans the page for student grade links — works on any Moodle theme/version.
  // Handles both the submissions-list view (one row per student) and the per-student
  // grading view (one student shown, others listed in the navigation select dropdown).
  function parseStudentList(doc = document) {
    const students = [];
    const seen = new Set();

    const makeGradeUrl = (/** @type {string} */ uid) =>
      `${location.origin}/mod/assign/view.php?id=${assignId}&userid=${uid}&action=grade`;

    // ── Path 1: Moodle's student-navigation <select name="userid"> ───────────
    // Present on the per-student grading page. Each <option> value is a plain user ID
    // and the text is the student's full name (Moodle appends " (N of M)" which we strip).
    const navSelect = doc.querySelector('select[name="userid"]');
    if (navSelect) {
      for (const opt of /** @type {HTMLSelectElement} */(navSelect).options) {
        const uid = opt.value.trim();
        if (!uid || !/^\d+$/.test(uid) || seen.has(uid)) continue;
        seen.add(uid);
        // Strip Moodle's "(N of M matching filters)" suffix
        const name = opt.textContent.trim().replace(/\s*\(\d+\s+of\s+\d+[^)]*\)\s*$/, '').trim()
                  || `Student ${uid}`;
        students.push({ uid, name, gradeLink: makeGradeUrl(uid), fileLinks: [], onlineText: null });
      }
    }

    // ── Path 1b: AMD-populated grader navigation select ──────────────────────
    // Moodle 4 grader view: select#change-user-select (no name attr) is populated
    // by AMD after page load. By the time the user clicks Grade One/All it has options.
    const graderSelect = doc.querySelector('select#change-user-select, select[data-action="change-user"]');
    if (graderSelect) {
      for (const opt of /** @type {HTMLSelectElement} */(graderSelect).options) {
        const uid = opt.value.trim();
        if (!uid || !/^\d+$/.test(uid) || seen.has(uid)) continue;
        seen.add(uid);
        const name = opt.textContent.trim().replace(/\s*\(\d+\s+of\s+\d+[^)]*\)\s*$/, '').trim()
                  || `Student ${uid}`;
        students.push({ uid, name, gradeLink: makeGradeUrl(uid), fileLinks: [], onlineText: null });
      }
    }

    // ── Path 2: Anchor links with userid= (submissions list / fallback) ───────
    const allLinks = /** @type {HTMLAnchorElement[]} */([...doc.querySelectorAll('a[href*="userid="]')])
      .filter(a => { try { return a.href.includes('mod/assign'); } catch { return false; } });

    for (const link of allLinks) {
      let uid;
      try { uid = new URL(link.href).searchParams.get('userid') || ''; } catch { continue; }
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);

      let name = '';
      const row = link.closest('tr');
      if (row) {
        const profileLink = row.querySelector('a[href*="user/view.php"], a[href*="user/profile.php"]');
        if (profileLink) name = profileLink.textContent.trim();
      }
      if (!name) {
        const t = link.textContent.trim();
        const tl = t.toLowerCase();
        const UI_WORDS = ['grade', 'view', 'edit', 'update', 'submit', 'show', 'hide',
          'download', 'upload', 'reset', 'lock', 'unlock', 'revert', 'remove',
          'comments', 'feedback', 'submission', 'grading', 'history', 'log'];
        if (t && t.length > 2 && t.length < 80 &&
            !UI_WORDS.some(w => tl === w || tl.startsWith(w + ' ') || tl.endsWith(' ' + w))) {
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

      /** @type {{url: string, filename: string}[]} */
      const fileLinks = [];
      if (row) {
        /** @type {NodeListOf<HTMLAnchorElement>} */(row.querySelectorAll('a[href*="pluginfile.php"]')).forEach(a => {
          fileLinks.push({ url: a.href, filename: decodeURIComponent((a.href.split('/').pop() || '').split('?')[0]) });
        });
      }

      students.push({ uid, name, gradeLink: makeGradeUrl(uid), fileLinks, onlineText: null });
    }

    return students;
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
      if (textEl) onlineText = /** @type {HTMLElement} */(textEl).textContent?.trim() || null;
    }
    // Extract real student name from the grading page.
    let realName = null;
    const WILLIS_EMAIL = /([a-z][a-z'-]*)\.([a-z][a-z'-]*)@students\.williscollege\.com/i;
    const capFirst = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

    // Priority 1: scan every anchor href — most reliable, never bleeds surrounding text
    for (const a of /** @type {HTMLAnchorElement[]} */([...doc.querySelectorAll('a[href]')])) {
      const m = (a.getAttribute('href') || '').match(WILLIS_EMAIL);
      if (m) { realName = capFirst(m[1]); break; }
    }

    // Priority 2: scan visible text content (email shown as plain text on page)
    if (!realName) {
      const m = (doc.body?.textContent || '').match(WILLIS_EMAIL);
      if (m) realName = capFirst(m[1]);
    }

    // Fallback: selected option in Moodle's student-navigation select
    if (!realName) {
      const selectedOpt = doc.querySelector('select[name="userid"] option[selected]')
                       || doc.querySelector('select[name="userid"] option');
      if (selectedOpt) {
        realName = selectedOpt.textContent.trim()
          .replace(/\s*\(\d+\s+of\s+\d+[^)]*\)\s*$/, '').trim() || null;
      }
    }
    // Fallback: structural selectors on various Moodle themes
    if (!realName) {
      for (const sel of ['.userfullname', '[data-region="user-summary"] .fullname',
                         '.gradingpanel .fullname', '#page-mod-assign-grader h2']) {
        const el = doc.querySelector(sel);
        if (el) { realName = el.textContent.trim(); break; }
      }
    }
    // Last resort: a profile link whose text looks like a real name (not a UI label)
    if (!realName) {
      const GENERIC = new Set(['profile', 'view profile', 'user profile', 'view user', 'edit profile']);
      const profileLink = doc.querySelector('a[href*="user/view.php"], a[href*="user/profile.php"]');
      if (profileLink) {
        const t = profileLink.textContent.trim();
        if (t && !GENERIC.has(t.toLowerCase())) realName = t;
      }
    }
    // Moodle 4 grader view: AMD-populated select#change-user-select has names as option text
    if (!realName) {
      const graderSelect = doc.querySelector('select#change-user-select, select[data-action="change-user"]');
      if (graderSelect) {
        const selectedOpt = /** @type {HTMLSelectElement} */(graderSelect).selectedOptions[0]
                         || /** @type {HTMLSelectElement} */(graderSelect).options[0];
        if (selectedOpt) {
          realName = selectedOpt.textContent.trim()
            .replace(/\s*\(\d+\s+of\s+\d+[^)]*\)\s*$/, '').trim() || null;
        }
      }
    }
    // Sanitise: strip any email address or "(N of M)" suffix that crept in via fallback selectors
    if (realName) {
      realName = realName
        .replace(/\s*[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
        .replace(/\s*\(\d+\s+of\s+\d+[^)]*\)/g, '')
        .trim() || null;
    }
    // Server-side graded state: Moodle marks selected rubric levels with .checked in the
    // server-rendered HTML. This is authoritative — no live-DOM race conditions.
    const isGraded = !!doc.querySelector(
      '.level.checked, .level[aria-checked="true"], td.level[data-checked="1"]'
    );
    return { fileLinks, onlineText, realName, isGraded };
  }

  // ── AI prompts ───────────────────────────────────────────────────────────
  function rubricToText(rubric) {
    return (rubric || []).map((/** @type {any} */ c, /** @type {number} */ i) =>
      `CRITERION ${i + 1}: ${c.name}\n` +
      (c.description ? `Description: ${c.description}\n` : '') +
      'Levels (points → description):\n' +
      (c.levels || []).map((/** @type {any} */ l) => `  ${l.points} pts: ${l.description}`).join('\n')
    ).join('\n\n');
  }

  // Single prompt that returns scores + feedback in one JSON response, halving API calls vs the
  // old two-call approach (grading JSON then feedback text separately). The feedback field follows
  // the same humanization rules as the standalone feedback prompt so quality is unchanged.
  function buildCombinedPrompt(title, instructions, rubric, submissionText, /** @type {string} */ instructorName, /** @type {string} */ style, /** @type {string[]} */ submittedFiles = []) {
    const rubricText   = rubricToText(rubric);
    const maxPoints    = (rubric || []).reduce((/** @type {number} */ s, /** @type {any} */ c) => s + (c.levels?.length ? Math.max(...c.levels.map((/** @type {any} */ l) => l.points)) : 0), 0);
    const sub          = submissionText || '';

    // Check BOTH actual filenames (authoritative — present even if extraction failed) AND
    // extraction markers in the text (covers files inside zips whose names we track separately).
    const fileNamesStr    = submittedFiles.join(' ').toLowerCase();
    const hasCode         = /\.(py|ipynb)\b/.test(fileNamesStr) || sub.includes('[PYTHON CODE]') || sub.includes('[JUPYTER NOTEBOOK]');
    const hasDataset      = /\.(csv|xlsx?|xls)\b/.test(fileNamesStr) || sub.includes('[CSV DATASET]') || sub.includes('[SPREADSHEET DATA]');
    const hasDoc          = /\.(pdf|docx?)\b/.test(fileNamesStr) || sub.includes('[PDF WRITTEN SUMMARY]') || sub.includes('[WORD DOCUMENT]');
    const hasPresentation = /\.(pptx?|ppt)\b/.test(fileNamesStr) || sub.includes('[PRESENTATION]');
    const foundTypes      = [
      hasCode         && 'Python/Jupyter code',
      hasDataset      && 'Dataset (CSV/spreadsheet)',
      hasDoc          && 'Written document (PDF/Word)',
      hasPresentation && 'PowerPoint presentation (.pptx)',
    ].filter(Boolean);
    // List actual filenames when available — more precise than type labels, and ensures
    // the AI never says a file is missing just because text extraction partially failed.
    const foundSummary = submittedFiles.length
      ? submittedFiles.join(', ')
      : (foundTypes.length ? foundTypes.join(', ') : 'No files successfully extracted');
    return `You are an instructor conducting a thorough, fair evaluation of a student submission. Your job is to read every part of the submission carefully and reward genuine understanding — thoroughness means reading everything, not finding reasons to deduct. When in doubt, the default is to award credit.

ACCURACY IS YOUR TOP PRIORITY. You may only award credit for a requirement you can directly verify in the submitted content below. Do not assume, infer, or invent evidence for something you cannot find. If a function, section, slide, or dataset is not visible in the submission text, treat it as absent.

WITHIN WHAT YOU CAN VERIFY: be generous and student-friendly. A partial or imperfect attempt that genuinely addresses the requirement still counts toward it — even if the implementation is simple, the explanation brief, or the approach less polished than ideal. When evidence is present but sits ambiguously between two adjacent rubric levels, always choose the higher one. A student who demonstrates understanding of a concept, even imperfectly or concisely, has earned that credit. Minor gaps that do not undermine the core work should not drop a student to a lower rubric level. Never penalise for style, conciseness, or presentation polish unless the rubric explicitly requires it.

LANGUAGE AND GRAMMAR: Be lenient on grammatical errors, spelling mistakes, awkward phrasing, and non-native English usage — always, even when the rubric includes a writing quality or communication criterion. Many students are non-native English speakers. Technical correctness and conceptual understanding must greatly outweigh language fluency in every scoring decision. Even when a rubric criterion explicitly addresses communication or writing, award the higher level if the technical content is sound; only drop to a lower level for language issues if the writing is so unclear that the technical meaning cannot be determined at all. If the meaning is recoverable, treat it as acceptable.

ASSIGNMENT: ${title}

INSTRUCTIONS:
${instructions}

RUBRIC (total possible: ${maxPoints} points):
${rubricText}

FILES FOUND IN SUBMISSION: ${foundSummary}

STUDENT SUBMISSION:
${submissionText || '[No text submission — file submitted for analysis]'}

Respond ONLY with valid JSON in this exact shape (no markdown, no explanation outside the JSON):
{
  "scores": [
    { "criterionIndex": 0, "pointsAwarded": <number>, "justification": "<one sentence why>" }
  ],
  "totalPoints": <number>,
  "overallComment": "<2-3 sentence overall assessment>",
  "feedback": "<one short paragraph following all FEEDBACK RULES below, OR an empty string \"\" if there is nothing specific and verifiable to add>"
}

— SCORING RULES —
- pointsAwarded must exactly match one of the point values listed in that criterion's levels.
- criterionIndex is 0-based, matching the rubric order above.
- Before scoring each criterion, re-read the INSTRUCTIONS above (including any "Deliverables", "Required Files", or "Submission Requirements" section). Score based on whether those specific requirements are met, not on generic quality.
- EVIDENCE REQUIREMENT: Every justification must name the specific thing that earned or lost the points — a function name, line logic, PDF section heading, slide number, column name, formula. Generic justifications like "the student addressed this" or "the code handles this" are not acceptable. If you cannot name specific evidence, you cannot award credit.
- ABSENCE CLAIMS REQUIRE EXHAUSTIVE VERIFICATION: Before writing that any topic, section, slide, function, analysis, or requirement is "missing", "absent", "not included", "not present", or "not addressed", you must have read every visible portion of that file. The submission may contain "[…content omitted…]" markers where text was cut to fit the context window — you have NOT read what is in those gaps. You cannot claim absence for any topic that could plausibly appear in an omitted section. Making a false absence claim (saying something is missing when it is present) is a grading error as serious as falsely awarding credit. When uncertain whether something is present in an omitted portion, do not penalise.
- TERMINOLOGY AND CONTEXT: Students may address a requirement using different words, headings, or structure than the rubric expects. Before concluding a requirement is absent, check whether the concept appears under alternative terminology, a different section heading, or phrasing the rubric did not anticipate. A requirement is absent only when you have confirmed — across the entire visible submission — that neither the concept nor any equivalent expression of it appears anywhere.
- When uncertain between two adjacent levels, always choose the higher one. The default direction is credit, not deduction.
- BENEFIT OF THE DOUBT: A student who has made a genuine attempt at a requirement and partially succeeds should receive the level above the lowest. Reserve the bottom rubric level only for submissions that make no meaningful attempt whatsoever. Do not cascade a single gap into multiple criteria — if one issue affects several criteria, assign the deduction to the criterion it most clearly belongs to and be conservative about repeating it elsewhere.
- SCORE–FEEDBACK CONSISTENCY (non-negotiable): Your scores and feedback must agree. If every criterion received maximum points, the feedback field must not mention any failing, gap, omission, or deficiency — not even a minor one. If feedback mentions that something is missing, incorrect, incomplete, or could be improved, you must have deducted points in the relevant criterion. Writing deduction-language in feedback while awarding full marks everywhere is a self-contradiction and a grading error. When you draft feedback, cross-check every negative claim against your scores: if no deduction exists for it, remove the claim from feedback.
- HALLUCINATION BAN: Do not fabricate, invent, or infer any problem, gap, or deficiency that you cannot directly observe in the submission text above. You may only state that something is missing after confirming it is absent from every visible section of the submission. A suspicion is not evidence. A possibility is not an absence. Do not write that something "may be" or "might be" missing — only assert absence when you have confirmed it. Every negative claim in both justifications and feedback must point to a specific, observable gap in the submission.
${hasCode ? `- CRITICAL CODE REVIEW: Do a complete pass through every line of submitted code before scoring.
  (a) For each requirement in the INSTRUCTIONS, identify the exact function, class, or logic block that implements it — or state it is absent.
  (b) If a function exists, read its body: verify the logic actually does what the requirement demands. A function name alone is not evidence it works correctly.
  (c) If the code contains errors, incomplete logic, missing steps, or wrong outputs, describe the specific flaw — do not praise correctness you have not confirmed.
  (d) If omission markers are present, do not make any absence claim about the omitted portion — only assess what you can read, and note explicitly if a requirement could not be verified due to omission.` : ''}
${hasDataset ? `- DATASET CHECK: (1) Verify the dataset is the one specified in the INSTRUCTIONS (check filename and/or column names — a different dataset is a significant deficiency). (2) Confirm the code or analysis actually loads and processes it as required, not just that it was uploaded.` : ''}
${hasDoc ? `- DOCUMENT REVIEW: Read every visible section of the submitted document before scoring.
  (a) For each rubric criterion, scan ALL visible sections — headings, body paragraphs, figures, tables — before concluding it is addressed or absent. A requirement covered on a later page is not absent just because you checked the introduction.
  (b) Quote or closely paraphrase the specific sentence, heading, or section that addresses each criterion. If it is genuinely absent from ALL visible sections, state that.
  (c) If omission markers are present, do not claim a section is absent — it may be in the omitted portion. Only penalise absences you can confirm across all visible text.
  (d) Assess whether the content addresses the criterion. Brief, basic, or concise responses still count — do not penalise for limited length alone. Only drop to a lower level if the content is clearly insufficient: missing the point entirely, or so thin that you cannot confirm the criterion was addressed at all.` : ''}
${hasPresentation ? `- PRESENTATION REVIEW: Read ALL visible slides before scoring any criterion.
  (a) Scan every slide in the submission before concluding a topic was or was not addressed. A requirement on slide 12 is not absent just because slide 3 did not mention it.
  (b) For each rubric criterion, identify the specific slide number and content (chart, claim, heading, data point) that addresses it. If it genuinely does not appear on any visible slide, state that.
  (c) If omission markers are present between slides, do not claim those slide topics were not covered — they may be in the omitted portion. Only penalise absences you can confirm across all visible slides.
  (d) Assess whether the slide content meaningfully addresses the criterion. A slide with relevant information — even if brief or basic — meets the criterion. Only disqualify a slide if it is genuinely empty (title with no supporting content whatsoever).` : ''}
${!hasCode && (instructions.toLowerCase().includes('python') || instructions.toLowerCase().includes('code') || instructions.toLowerCase().includes('.py')) ? '- WARNING: The assignment instructions require code/Python but no code file was found in this submission. Penalise any criteria related to coding or implementation accordingly.' : ''}
${!hasDataset && (instructions.toLowerCase().includes('dataset') || instructions.toLowerCase().includes('csv') || instructions.toLowerCase().includes('data')) ? '- WARNING: The assignment instructions require a dataset but none was found in this submission. Penalise any criteria related to data handling accordingly.' : ''}
${!hasPresentation && (instructions.toLowerCase().includes('.pptx') || instructions.toLowerCase().includes('presentation') || instructions.toLowerCase().includes('slides') || instructions.toLowerCase().includes('powerpoint')) ? '- WARNING: The assignment instructions require a presentation/slides but none was found. Penalise any criteria related to the presentation accordingly.' : ''}

— FEEDBACK RULES (for the "feedback" field) —
You are ${instructorName || 'the instructor'}, leaving a quick grade comment. Style: ${style || 'conversational'}.
One short paragraph. Typed fast. No ceremony, no structure for structure's sake.
Write as if you have just finished scoring this submission — the rubric scores you assigned above are the ones to reference.

PICK ONE writing mode that fits this submission. Do not name or signal which one you chose:

  A) Punchy: Short, plain sentences. Get straight to the point. No warm-up.
  B) Conversational: Sounds like thinking out loud. Parenthetical asides, natural pivots, a bit of personality.
  C) Candid mentor: Honest about what's missing, but framed as useful information rather than judgment. Direct without being cold.
  D) Technical: Opens with a named detail from the code, dataset, or report. Concrete, minimal filler.

HARD RULES for "feedback" — follow every one. These are what defeat AI detectors:

BURSTINESS (the single most important signal AI detectors measure):
Alternate between very short and longer sentences. Don't let three consecutive sentences be similar in length.
Pattern to aim for: short burst -> medium -> longer complex clause -> short again.
Example rhythm: "Not great. The axis labels are missing, which makes the chart basically unreadable even though the data itself is fine. Fix that." (short, long, short)

SENTENCE LENGTH:
At least one sentence under 7 words. At least one over 20 words (with a subordinate clause, not just a long list). Never let the paragraph feel metronomic.

SOUND HUMAN:
- Contractions every chance you get: "you've", "it's", "doesn't", "that's", "I'd", "there's", "wasn't", "can't", "won't", "you're", "I'm", "I'd've".
- First-person "I" is natural and expected: "I'd have expected", "I'm not sure why", "I noticed", "I can't tell if", "I had to re-read this part".
- Hedging is human: "looks like", "seems like", "probably", "might want to", "not totally sure", "could be".
- Rhetorical questions: "Why not just use X here?" or "Did you test this with edge cases?"
- Parenthetical asides: "(which matters here)", "(that part worked)", "(though this might be intentional)".
- Fragment sentences are fine. Colons are fine. Starting with "And", "But", "So", or "Though" is fine.
- Mild imprecision is human: "roughly", "kind of", "more or less", "not quite", "a bit".
- Avoid perfectly parallel lists ("X is Y, Z is W, A is B") — that pattern screams AI.

NO LANGUAGE FEEDBACK: Never mention grammar, spelling, punctuation, sentence structure, phrasing, word choice, or language fluency in the "feedback" field — not even as a minor note, a gentle suggestion, or a positive remark. Do not write anything like "watch your grammar", "a few spelling errors", "could be clearer", "the writing is a bit rough", or "good writing". The feedback must focus exclusively on technical content, rubric criteria, and conceptual correctness. If you have nothing technical to say, say less — do not fill the gap with language commentary.

BANNED CHARACTERS AND PHRASES (never write any of these in "feedback"):
Em-dash character: BANNED. Do not use it anywhere in "feedback". Replace with a semicolon, colon, or start a new sentence.
"demonstrates", "showcases", "commendable", "proficiency", "exhibits", "furthermore", "additionally",
"in conclusion", "overall", "it is worth noting", "it is important to", "reflects", "highlights",
"clear understanding", "well-structured", "effectively", "excellent work", "great job", "well done",
"strong effort", "shows a good understanding", "moving forward", "ensure that", "it's clear that",
"you have shown", "noteworthy", "impressive", "solid work", "solid foundation", "solid effort",
"you've laid", "laid a foundation", "laid a solid", "tightening", "tighten up",
"decent attempt", "thorough", "comprehensive", "robust", "valuable", "insightful", "thoughtful",
"meaningful", "crucial", "significant", "notable", "it is evident", "it can be seen",
"this submission", "as mentioned", "in summary", "on the whole", "your analysis is solid",
"is solid", "solid overall", "a solid", "delve", "delve into", "grasp", "nuanced", "tapestry",
"utilize", "leverage" (as a verb for "use"), "streamline", "dive into", "fostered", "garnered",
"it's worth", "at its core", "in essence", "going forward", "take away", "takeaway",
"a testament to", "speaks to", "speaks volumes", "on that note", "with that said",
"having said that", "needless to say", "by and large", "rest assured".

UNIQUENESS MANDATE (non-negotiable):
Write as if you have read only THIS student's work and no other. Every claim must be tied to
a specific detail visible in the submission — a function name, column, chart, argument, slide,
formula, or gap that applies only to this student. If you could paste the same comment onto
a different student's work without changing a word, rewrite it.

DEDUCTION COVERAGE (mandatory — highest priority rule in this section):
For every criterion where you awarded fewer than the maximum points, the feedback MUST include a specific explanation of what was missing, incomplete, or incorrect for that criterion. This is non-negotiable. Do not let any deduction go unmentioned. If multiple criteria were below max, address each one. Reference the actual gap in the work (a missing function, a wrong column, an absent slide, an incomplete analysis), not just "could be improved".

BLANK FEEDBACK: If the student received maximum points on every single criterion AND you have no specific, verifiable technical observation to add, set "feedback" to an empty string "". A blank comment is far better than generic praise, filler, or restating what the rubric scores already communicate. Feedback is not mandatory — write it only when you have something submission-specific and useful to say. When deductions exist, DEDUCTION COVERAGE takes priority and feedback cannot be blank.

VERIFY BEFORE WRITING: Before naming any specific element in feedback — a function, column, heading, chart, slide, formula, dataset column, or section title — locate it in the submission text above. If you cannot find it there, do not name it; use general terms instead. Before saying something is "missing" or "absent" in feedback, scan the full visible submission from start to end. If the topic could plausibly be in an omitted section, write "it's not clear" or "I couldn't find" rather than asserting absence. Never state as fact something you cannot verify in the submission text.

STRUCTURE:
- No formula. Don't do: praise -> detail -> improvement -> encouragement. Lead with whatever matters most.
- Name something specific. Before naming any element, confirm it appears in the submission above — if it doesn't, don't name it. Never invent specifics that aren't in the text.
- If something is missing or wrong, say so precisely — but only after confirming absence across the full visible submission. Don't bury the critique.
- For code: ground every claim in what the code actually does. Read the logic; don't summarise generically.
- For presentations: name a specific slide, chart, claim, or narrative point. Not "your slides covered X" without anchoring it to actual content.

FORBIDDEN in "feedback":
- Do not open with the student's name.
- No opener type should dominate. Valid openers: a named element from the work (function name, column, chart, slide, dataset), a second-person pronoun ("You"/"Your"), an article ("The"/"A"), a verb or gerund ("Missing", "Got", "Needs", "Working", "Looks like"), a conjunction ("But", "So", "And", "Though"), a rhetorical question ("Why is...?"), a short fragment. Pick whichever sounds most natural for this specific submission.
- No bullet points, headers, or markdown of any kind.
- No sign-off or motivational closer of any kind. This means zero encouragement sentences at the end: no "Keep it up", "Good luck", "Best of luck", "Keep up the good work", "Keep that up in future projects", "Looking forward to seeing your next submission", "Hope this helps", "You're on the right track", "Great start", "Keep pushing", "You've got this", or any variant. End on the last piece of actionable feedback. Do not add a warm send-off.
- Don't mention AI, this tool, or anything about how this comment was written.`;
  }

  function buildFeedbackPrompt(title, instructions, rubric, submissionText, scores, instructorName, style) {
    const rubricText = rubricToText(rubric);
    const scoreLines = (scores || []).map((/** @type {any} */ s, /** @type {number} */ i) =>
      `${rubric[i]?.name || 'Criterion ' + i}: ${s.pointsAwarded} pts — ${s.justification}`
    ).join('\n');
    return `You are ${instructorName}, leaving a quick grade comment. Style: ${style}.
One short paragraph. Typed fast. No ceremony, no structure for structure's sake.

ASSIGNMENT: ${title}
INSTRUCTIONS: ${instructions}

RUBRIC:
${rubricText}

SCORES:
${scoreLines}

STUDENT SUBMISSION:
${submissionText || '[File submission — base feedback on rubric scores and assignment instructions]'}

PICK ONE writing mode that fits this submission. Do not name or signal which one you chose:

  A) Punchy: Short, plain sentences. Get straight to the point. No warm-up.
  B) Conversational: Sounds like thinking out loud. Parenthetical asides, natural pivots, a bit of personality.
  C) Candid mentor: Honest about what's missing, but framed as useful information rather than judgment. Direct without being cold.
  D) Technical: Opens with a named detail from the code, dataset, or report. Concrete, minimal filler.

HARD RULES — follow every one. These are what defeat AI detectors:

— BURSTINESS (the single most important signal AI detectors measure) —
Alternate between very short and longer sentences. Don't let three consecutive sentences be similar in length.
Pattern to aim for: short burst → medium → longer complex clause → short again.
Example rhythm: "Not great. The axis labels are missing, which makes the chart basically unreadable even though the data itself is fine. Fix that." — short, long, short.

— SENTENCE LENGTH —
At least one sentence under 7 words. At least one over 20 words (with a subordinate clause, not just a long list). Never let the paragraph feel metronomic.

— SOUND HUMAN —
- Contractions every chance you get: "you've", "it's", "doesn't", "that's", "I'd", "there's", "wasn't", "can't", "won't", "you're", "I'm", "I'd've".
- First-person "I" is natural and expected: "I'd have expected", "I'm not sure why", "I noticed", "I can't tell if", "I had to re-read this part".
- Hedging is human: "looks like", "seems like", "probably", "might want to", "not totally sure", "could be".
- Rhetorical questions: "Why not just use X here?" or "Did you test this with edge cases?"
- Parenthetical asides: "(which matters here)", "(that part worked)", "(though this might be intentional)".
- Fragment sentences are fine. Colons are fine. Starting with "And", "But", "So", or "Though" is fine.
- Mild imprecision is human: "roughly", "kind of", "more or less", "not quite", "a bit".
- Avoid perfectly parallel lists ("X is Y, Z is W, A is B") — that pattern screams AI.

— BANNED CHARACTERS AND PHRASES (never write any of these) —
Em-dash character "—": BANNED. Do not use it anywhere. Replace with a semicolon, colon, or start a new sentence.
"demonstrates", "showcases", "commendable", "proficiency", "exhibits", "furthermore", "additionally",
"in conclusion", "overall", "it is worth noting", "it is important to", "reflects", "highlights",
"clear understanding", "well-structured", "effectively", "excellent work", "great job", "well done",
"strong effort", "shows a good understanding", "moving forward", "ensure that", "it's clear that",
"you have shown", "noteworthy", "impressive", "solid work", "solid foundation", "solid effort",
"you've laid", "laid a foundation", "laid a solid", "tightening", "tighten up",
"decent attempt", "thorough", "comprehensive", "robust", "valuable", "insightful", "thoughtful",
"meaningful", "crucial", "significant", "notable", "it is evident", "it can be seen",
"this submission", "as mentioned", "in summary", "on the whole", "your analysis is solid",
"is solid", "solid overall", "a solid", "delve", "delve into", "grasp", "nuanced", "tapestry",
"utilize", "leverage" (as a verb for "use"), "streamline", "dive into", "fostered", "garnered",
"it's worth", "at its core", "in essence", "going forward", "take away", "takeaway",
"a testament to", "speaks to", "speaks volumes", "on that note", "with that said",
"having said that", "needless to say", "by and large", "rest assured".

— UNIQUENESS MANDATE (non-negotiable) —
Write as if you have read only THIS student's work and no other. Every claim must be tied to
a specific detail visible in the submission — a function name, column, chart, argument, slide,
formula, or gap that applies only to this student. If you could paste the same comment onto
a different student's work without changing a word, rewrite it.

— DEDUCTION COVERAGE (mandatory) —
For every criterion in SCORES where the student received fewer than the maximum points, the feedback MUST include a specific explanation of what was missing, incomplete, or incorrect. Do not let any deduction pass without addressing it. Reference the actual gap (a missing function, wrong column, absent slide, incomplete analysis), not just "could be improved".

— BLANK FEEDBACK —
If the student received maximum points on every criterion AND you have no specific, verifiable technical observation to add, return an empty string "". Feedback is not mandatory. A blank is better than generic praise or restating the rubric scores. When deductions exist, DEDUCTION COVERAGE takes priority and feedback cannot be blank.

— VERIFY BEFORE WRITING —
Before naming any specific element in feedback — a function, column, heading, chart, slide, formula, or section title — locate it in the submission text above. If you cannot find it there, do not name it. Before saying something is "missing" or "absent", scan the full visible submission. If the topic could be in an omitted section, write "it's not clear" or "I couldn't find" rather than asserting absence. Never state as fact something you cannot verify in the submission text.

— STRUCTURE —
- No formula. Don't do: praise → detail → improvement → encouragement. Lead with whatever matters most.
- Name something specific. Before naming any element, confirm it is in the submission above — if not, don't name it. Never invent specifics.
- If something is missing or wrong, say so precisely — but only after confirming absence across the full visible submission. Don't bury the critique.
- For code: ground every claim in what the code actually does. Read the logic; don't summarise generically.
- For presentations: name a specific slide, chart, claim, or narrative point. Not "your slides covered X" without anchoring it to actual content.

— FORBIDDEN —
- Do not open with the student's name.
- No opener type should dominate. Valid openers include — and none of these has priority over the others: a named element from the work (function name, column, chart, slide, dataset), a second-person pronoun ("You"/"Your"), an article ("The"/"A"), a verb or gerund ("Missing", "Got", "Needs", "Working", "Looks like"), a conjunction ("But", "So", "And", "Though"), a rhetorical question ("Why is...?"), a short fragment. Pick the one that sounds most natural for this specific submission. The only rule: if you notice yourself defaulting to any one type, switch.
- No bullet points, headers, or markdown of any kind.
- No sign-off or motivational closer of any kind. This means zero encouragement sentences at the end: no "Keep it up", "Good luck", "Best of luck", "Keep up the good work", "Keep that up in future projects", "Looking forward to seeing your next submission", "Hope this helps", "You're on the right track", "Great start", "Keep pushing", "You've got this", or any variant. End on the last piece of actionable feedback. Do not add a warm send-off.
- Don't mention AI, this tool, or anything about how this comment was written.

— OUTPUT —
Your response is the feedback text itself, and nothing else. Do not explain your reasoning. Do not narrate what you are deciding or checking. Do not write about the rules, the criteria, or what you should or should not include. If you notice yourself writing anything other than the actual feedback paragraph (or an empty string ""), stop and delete it. Output ONLY the final result.`;
  }

  // ── AI callers ───────────────────────────────────────────────────────────
  /** @param {string} promptText @param {object|null} [inlineData] @param {boolean} [_retry] @param {string|null} [_model] @param {string|null} [_key] */
  async function callGemini(promptText, inlineData = null, _retry = true, _model = null, _key = null) {
    const key = _key || CFG.geminiKey;
    if (!key) throw new Error('Gemini API key not configured.');
    const model = _model || CFG.geminiModel;
    /** @type {object[]} */
    const parts = [{ text: promptText }];
    if (inlineData) parts.push({ inlineData });
    const body = JSON.stringify({ contents: [{ parts }] });
    const r = await xhr('POST', GEMINI_ENDPOINT(key, model), {
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (r.status === 0) throw new Error('Gemini: network error or request blocked');
    if (r.status === 404) {
      // Model retired — walk the fallback list before giving up
      const fallbacks = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
      const next = _retry ? fallbacks.find(m => m !== model) : null;
      if (next) {
        setStatus(`Gemini model "${model}" retired — switching to ${next}…`, '#ffb060');
        return callGemini(promptText, inlineData, false, next);
      }
      const errMsg = (() => { try { return JSON.parse(r.responseText)?.error?.message || ''; } catch { return ''; } })();
      throw new Error(`Gemini [404]: ${errMsg || `model "${model}" not found`} — update model in ⚙ Settings`);
    }
    if (r.status === 429) {
      const errMsg = (() => { try { return JSON.parse(r.responseText)?.error?.message || ''; } catch { return ''; } })();
      // Daily/monthly quota exhausted — try next key, or cascade if none left
      if (/quota|exhausted|billing|plan/i.test(errMsg)) {
        exhaustedGeminiKeys.add(key);
        const nextKey = CFG.geminiKeys.find(k => !exhaustedGeminiKeys.has(k));
        if (nextKey) {
          setStatus('Gemini quota exhausted — switching to backup key…', '#ffb060');
          return callGemini(promptText, inlineData, true, _model, nextKey);
        }
        throw new Error(`Gemini [429 quota exhausted]: ${errMsg}`);
      }
      // Short-term RPM rate limit — wait and retry once
      if (_retry) {
        setStatus('Gemini rate-limited — waiting 15 s before retry…', '#ffb060');
        await new Promise(res => setTimeout(res, 15000));
        return callGemini(promptText, inlineData, false, _model);
      }
      throw new Error(`Gemini [429]: ${errMsg || 'rate-limited'}`);
    }
    if (r.status >= 500 && _retry) {
      await new Promise(res => setTimeout(res, 1500));
      return callGemini(promptText, inlineData, false, _model);
    }
    if (!r.responseText) throw new Error(`Gemini: empty response (HTTP ${r.status})`);
    const data = JSON.parse(r.responseText);
    if (data.error) throw new Error(`Gemini [${r.status}]: ${data.error.message}`);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini: empty response body — may have been blocked by safety filters');
    return text;
  }

  /** @param {string} promptText */
  async function callHuggingFace(promptText) {
    const key = CFG.hfKey;
    if (!key) throw new Error('HuggingFace token not configured.');
    const body = JSON.stringify({
      model:       CFG.hfModel,
      messages:    [{ role: 'user', content: promptText }],
      max_tokens:  2048,
      temperature: 0.3,
    });
    let r;
    try {
      r = await xhr('POST', HF_ENDPOINT, {
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body,
      });
    } catch (e) {
      throw new Error(`HuggingFace network error (API may be WAF-blocked): ${/** @type {Error} */(e).message}`);
    }
    if (r.status === 0) throw new Error('HuggingFace: request blocked (status 0)');
    const data = JSON.parse(r.responseText);
    if (data.error) throw new Error(`HuggingFace [HTTP ${r.status}]: ${typeof data.error === 'string' ? data.error : data.error.message}`);
    return data.choices?.[0]?.message?.content || '';
  }

  // Tracks Gemini keys whose daily quota is exhausted for this page session
  const exhaustedGeminiKeys = new Set();
  let groqNetworkBlocked = false; // true after a 403 — Groq blocks this IP/network

  // Session-cached ordered list of free models fetched from OpenRouter
  /** @type {string[]} */
  let _orFreeList = [];

  // Fetches all free models from OpenRouter once per page load, ranked by
  // quality for structured-output tasks (deepseek > llama > qwen > …)
  /** @param {string} key */
  async function loadFreeModelList(key) {
    if (_orFreeList.length) return _orFreeList;
    try {
      const r = await xhr('GET', 'https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      const all = /** @type {{id:string,pricing:{prompt:string,completion:string}}[]} */(
        JSON.parse(r.responseText).data || []);
      const free = all
        .filter(m => m.pricing?.prompt === '0' && m.pricing?.completion === '0')
        .filter(m => !/deepseek-r1|deepseek\/r1|qwq|thinking-model/i.test(m.id))  // exclude CoT reasoning models
        .map(m => m.id);
      const pref = ['deepseek', 'llama', 'qwen', 'mistral', 'phi', 'gemma'];
      const sorted = pref.flatMap(p => free.filter(id => id.toLowerCase().includes(p)));
      const rest   = free.filter(id => !sorted.includes(id));
      _orFreeList  = [...new Set([...sorted, ...rest])];
    } catch {
      _orFreeList = [OPENROUTER_DEFAULT];
    }
    return _orFreeList;
  }

  /** @param {string} promptText */
  async function callOpenRouter(promptText) {
    const key = CFG.openrouterKey;
    if (!key) throw new Error('OpenRouter API key not configured.');
    const headers = {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer':  'https://students.willisonline.ca',
      'X-Title':       'Moodle AutoGrader',
    };

    // Start with configured model, fall back through free list on 404/429/503
    const tried = new Set();
    let model = CFG.openrouterModel || OPENROUTER_DEFAULT;

    while (tried.size < 6) {
      tried.add(model);
      let skipToNext = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const body = JSON.stringify({
          model, messages: [{ role: 'user', content: promptText }],
          max_tokens: 2048, temperature: 0.3,
        });
        const r = await xhr('POST', OPENROUTER_ENDPOINT, { headers, body });
        if (r.status === 0) throw new Error('OpenRouter: request blocked (status 0) — check @connect permission');
        // 429 (rate-limit) or 503 (overloaded): retry once then move on
        if ((r.status === 429 || r.status === 503) && attempt === 1) {
          setStatus(`${model.split('/').pop()} busy — retry…`, '#ffb060');
          await sleep(1000);
          continue;
        }
        if (r.status === 429 || r.status === 503 || r.status === 404) { skipToNext = true; break; }
        if (!r.responseText) { skipToNext = true; break; }
        const data = JSON.parse(r.responseText);
        if (data.error) {
          const msg = typeof data.error === 'string' ? data.error : (data.error.message || String(data.error));
          // Capacity/availability errors from a specific model → try the next one
          if (/no endpoint|overload|unavailable|busy|capacity|quota/i.test(msg)) { skipToNext = true; break; }
          throw new Error(`OpenRouter [HTTP ${r.status}]: ${msg}`);
        }
        const content = data.choices?.[0]?.message?.content;
        if (!content) { skipToNext = true; break; }
        return content;
      }
      if (!skipToNext) break;
      // Current model failed — pick next untried free model
      const list = await loadFreeModelList(key);
      const next = list.find(m => !tried.has(m));
      if (!next) break;
      setStatus(`Trying next free model: ${next.split('/').pop()}…`, '#ffb060');
      model = next;
    }
    throw new Error('OpenRouter: all free models overloaded or unavailable — try again in a few minutes.');
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


  /** @param {string} promptText */
  async function callGroq(promptText) {
    const key = CFG.groqKey;
    if (!key) throw new Error('Groq API key not configured.');
    const body = JSON.stringify({
      model:       CFG.groqModel,
      messages:    [{ role: 'user', content: promptText }],
      max_tokens:  2048,
      temperature: 0.3,
    });
    const r = await xhr('POST', GROQ_ENDPOINT, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body,
    });
    if (r.status === 0) throw new Error('Groq: request blocked (status 0)');
    if (!r.responseText) throw new Error(`Groq: empty response (HTTP ${r.status})`);
    const data = JSON.parse(r.responseText);
    if (data.error) {
      const msg = typeof data.error === 'string' ? data.error : (data.error.message || String(data.error));
      throw new Error(`Groq [${r.status}]: ${msg}`);
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Groq: empty response content');
    return content;
  }

  /** @param {string} promptText */
  async function callMistral(promptText) {
    const key = CFG.mistralKey;
    if (!key) throw new Error('Mistral API key not configured.');
    const body = JSON.stringify({
      model:       CFG.mistralModel,
      messages:    [{ role: 'user', content: promptText }],
      max_tokens:  2048,
      temperature: 0.3,
    });
    const r = await xhr('POST', MISTRAL_ENDPOINT, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body,
    });
    if (r.status === 0) throw new Error('Mistral: network error or request blocked');
    if (!r.responseText) throw new Error(`Mistral: empty response (HTTP ${r.status})`);
    const data = JSON.parse(r.responseText);
    if (data.error) {
      const msg = typeof data.error === 'string' ? data.error : (data.error.message || String(data.error));
      throw new Error(`Mistral [${r.status}]: ${msg}`);
    }
    if (r.status === 429) throw new Error(`Mistral [429]: rate-limited — free tier is ~1 req/s`);
    if (r.status >= 400) throw new Error(`Mistral [${r.status}]: ${data.message || 'request failed'}`);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Mistral: empty response content');
    return content;
  }

  /** @param {string} promptText */
  async function callOllama(promptText) {
    const body = JSON.stringify({
      model: CFG.ollamaModel,
      messages: [{ role: 'user', content: promptText }],
      max_tokens: 2048,
      temperature: 0.3,
      stream: false,
    });
    let r;
    try {
      r = await xhr('POST', OLLAMA_ENDPOINT, {
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (e) {
      throw new Error(`Ollama network error (is Ollama running locally?): ${/** @type {Error} */(e).message}`);
    }
    if (r.status === 0) throw new Error('Ollama: not reachable — make sure Ollama is running on localhost:11434');
    const data = JSON.parse(r.responseText);
    if (data.error) throw new Error(`Ollama error: ${data.error}`);
    return data.choices?.[0]?.message?.content || '';
  }

  // Strips chain-of-thought/reasoning preambles that some models leak into responses.
  // Handles: XML <think> blocks, narrated preambles, and inline process narration.
  function stripThinking(text) {
    if (!text) return text;
    // 1. Remove <think>…</think> or <thinking>…</thinking> blocks (DeepSeek-R1, etc.)
    text = text.replace(/<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
    // 2. Narrated reasoning preamble ("Here's a thinking process:", "Let me think through this:", etc.)
    if (/^(?:here[''`]?s?\s+(?:a\s+)?(?:my\s+)?thinking|let me\s+(?:think|reason|work\s+through)|thinking\s+(?:process|through)|## (?:thinking|reasoning))/i.test(text)) {
      const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
      // Walk backwards to find the last plain-prose paragraph (no list/header markers)
      const answer = [...paras].reverse().find(p => p.length > 20 && !/^[\d\-\*#>]|^\*\*/.test(p));
      if (answer) return answer;
      return '';
    }
    // 3a. Single high-confidence signals — model narrating about the prompt/AI itself.
    //     Any one of these is unambiguous meta-commentary; discard the entire response.
    const hardSignals = [
      /\bi recall\b.{0,60}(?:prompt|test|AI|blank|feedback|instruct)/i,
      /these prompts?\b/i,
      /whether the AI\b/i,
      /(?:this is |it(?:'s| is) )a test\b/i,
      /\bblank feedback\b/i,
      /the prompt (?:says|requires|instructs|asks|tells)/i,
      /(?:the )?AI (?:should|must|can|will) (?:recogni[sz]e|determine|decide|return|output) (?:when|whether|if)/i,
      /my (?:instructions?|rules?|guidelines?) (?:say|require|state|tell me)/i,
    ];
    if (hardSignals.some(p => p.test(text))) return '';
    // 3b. Inline process narration — model narrating its decision without a standard preamble.
    // Detected by 2+ signals that the text is ABOUT the grading process rather than actual feedback.
    const metaSignals = [
      /\bi should (?:return|output|write|give|include)/i,
      /return (?:an )?(?:empty string|""|'')/i,
      /the rules? (?:say|state|require|dictate|mandate)/i,
      /(?:let me|i need to|i must|i have to) (?:think|check|determine|verify|find|look|consider|decide)/i,
      /(?:if i|should i|do i) (?:return|write|include|add|mention|output)/i,
      /(?:no specific|a specific|verifiable) (?:technical )?observation/i,
    ];
    if (metaSignals.filter(p => p.test(text)).length >= 2) return '';
    // 4. Strip em dashes (U+2014) and en dashes (U+2013) — strong AI hallmark.
    //    Replace with a semicolon so surrounding clauses stay grammatically joined.
    text = text.replace(/\s*[–—]\s*/g, '; ').replace(/;\s*$/, '').trim();
    return text;
  }

  function parseGradingJSON(raw) {
    // Strip markdown fences, then extract the first {...} block so prose preamble is ignored
    const stripped = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in AI response');
    return JSON.parse(match[0]);
  }

  // callAI: Gemini → OpenRouter → Ollama (local) → HuggingFace
  // Order reflects quality / context-window for academic rubric grading.
  /** @param {string} prompt @param {object|null} [inlineData] */
  async function callAI(prompt, inlineData = null) {
    let geminiErr = /** @type {Error|null} */(null);
    let lastErr   = /** @type {Error|null} */(null);
    if (CFG.geminiKey) {
      try { return await callGemini(prompt, inlineData); } catch (e) {
        geminiErr = lastErr = /** @type {Error} */(e);
        setStatus(`Gemini failed (${lastErr.message.slice(0, 60)}) — trying next…`, '#ffb060');
      }
    }
    const textPrompt = inlineData
      ? prompt.replace('[No text submission', '[PDF submitted — text unavailable; [No text submission')
      : prompt;
    if (CFG.openrouterKey) {
      try { return await callOpenRouter(textPrompt); } catch (e) {
        lastErr = /** @type {Error} */(e);
        setStatus(`OpenRouter failed (${lastErr.message.slice(0, 60)}) — trying next…`, '#ffb060');
      }
    }
    if (CFG.mistralKey) {
      try { return await callMistral(textPrompt); } catch (e) {
        lastErr = /** @type {Error} */(e);
        setStatus(`Mistral failed (${lastErr.message.slice(0, 60)}) — trying next…`, '#ffb060');
      }
    }
    if (CFG.groqKey && !groqNetworkBlocked) {
      try { return await callGroq(textPrompt); } catch (e) {
        lastErr = /** @type {Error} */(e);
        if (/** @type {Error} */(e).message.includes('[403]')) {
          groqNetworkBlocked = true;
          setStatus('Groq blocked by network (403) — skipping for this session…', '#ffb060');
        } else {
          setStatus(`Groq failed (${lastErr.message.slice(0, 60)}) — trying next…`, '#ffb060');
        }
      }
    }
    if (CFG.ollamaEnabled) {
      try { return await callOllama(textPrompt); } catch (e) {
        lastErr = /** @type {Error} */(e);
        setStatus(`Ollama failed (${lastErr.message.slice(0, 60)}) — trying next…`, '#ffb060');
      }
    }
    if (CFG.hfKey) {
      return callHuggingFace(textPrompt);
    }
    if (lastErr) {
      // When a cascade happened, append the Gemini error so the user sees why their primary provider failed
      if (geminiErr && lastErr !== geminiErr) {
        throw new Error(`${lastErr.message} — Gemini: ${geminiErr.message.slice(0, 120)}`);
      }
      throw lastErr;
    }
    throw new Error('No AI provider configured — add a Gemini or OpenRouter key in ⚙ Settings.');
  }

  /** @param {string} title @param {string} instructions @param {object[]} rubric @param {string} submissionText @param {object|null} inlineData */
  // Multi-file submissions (ZIP with .py + .csv + .pdf) can be large.
  // Each file is pre-capped at 4 500 chars inside extractZip; overall cap here
  // is a final safety net so the combined prompt stays within model context.
  // The split threshold below is calibrated for HuggingFace (Llama-3.1-8B, 8 K context),
  // the most constrained provider. Gemini and gpt-4o-mini never hit it in practice.
  // Prompt overhead (rules + rubric + title/instructions) ≈ 2 500 tokens; output ≈ 2 000.
  // That leaves ~3 500 tokens ≈ 14 000 chars for submission content within HF's 8 K window.
  // 13 000 chars gives comfortable headroom while fitting multi-file submissions better.
  const MAX_SUBMISSION_CHARS = 13000;

  function truncateSubmission(/** @type {string|null|undefined} */ text) {
    if (!text) return text;
    // Collapse runs of blank lines / whitespace first — PDFs often have lots of padding
    const cleaned = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
    if (cleaned.length <= MAX_SUBMISSION_CHARS) return cleaned;

    // For multi-file submissions: distribute budget by file-type priority so a large
    // Python file doesn't crowd out the PDF or PPTX that the rubric also covers.
    const matches = /** @type {RegExpMatchArray[]} */([...cleaned.matchAll(/=== SUBMITTED: (.+?) ===/g)]);
    if (matches.length < 2) {
      // Single file — sample beginning + middle + end so later slides / sections are visible
      return sampleContent(cleaned, MAX_SUBMISSION_CHARS);
    }

    const weight = (/** @type {string} */ name) => {
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (['py', 'ipynb'].includes(ext))       return 4; // code: highest priority
      if (['pdf', 'docx', 'doc'].includes(ext)) return 3; // written docs
      if (['pptx', 'ppt'].includes(ext))        return 2; // presentations
      if (['csv', 'xlsx', 'xls'].includes(ext)) return 1; // data (first rows are enough)
      return 2;
    };

    const sections = matches.map((m, i) => ({
      text:   cleaned.slice(/** @type {number} */(m.index), matches[i + 1]?.index ?? cleaned.length),
      weight: weight(m[1]),
    }));

    const totalWeight = sections.reduce((s, x) => s + x.weight, 0);
    return sections.map(s => {
      const share = Math.round((s.weight / totalWeight) * MAX_SUBMISSION_CHARS);
      // sampleContent instead of front-slice: samples start/middle/end of each section
      return s.text.length > share ? sampleContent(s.text, share) : s.text;
    }).join('').trim();
  }

  async function gradeSubmission(/** @type {string} */ title, /** @type {string} */ instructions, /** @type {any[]} */ rubric, /** @type {string} */ submissionText, /** @type {any} */ inlineData, /** @type {string[]} */ submittedFiles = []) {
    const sub            = truncateSubmission(submissionText);
    const combinedPrompt = buildCombinedPrompt(title, instructions, rubric, sub, CFG.instructorName, CFG.instructorStyle, submittedFiles);

    // Estimate whether the combined prompt fits within HuggingFace's 8 K context (the tightest provider).
    // Total = prompt tokens (≈ chars / 4) + max_tokens output (2 000).
    // When it would exceed ~7 500 tokens, split into two focused calls:
    //   Call 1 — scoring only (drops the FEEDBACK RULES section, ~600 tokens saved)
    //   Call 2 — feedback only (drops the SCORING RULES, uses buildFeedbackPrompt)
    // Each call carries only its half of the rules + the full submission, landing ~6 500 tokens.
    const estimatedTokens = Math.ceil(combinedPrompt.length / 4) + 1500;
    const needsSplit      = estimatedTokens > 7500;

    /** @type {any} */ let grading;

    if (needsSplit) {
      // ── Split mode ────────────────────────────────────────────────────────
      // Build scoring-only prompt: strip the "feedback" JSON field and everything
      // from "— FEEDBACK RULES" onward. Scoring rules + submission still intact.
      const scoringPrompt = combinedPrompt
        .replace(/,?\s*\n\s*"feedback":[^\n]+/, '')        // remove feedback field from format
        .replace(/\n— FEEDBACK RULES[\s\S]*$/, '');        // drop feedback rules section

      const scoringRaw = await callAI(scoringPrompt, inlineData);
      try { grading = parseGradingJSON(scoringRaw); } catch (e) {
        setStatus('Response was not JSON — retrying with enforced format…', '#ffb060');
        const retryRaw = await callAI('CRITICAL: Output ONLY a raw JSON object starting with {. No text before or after it.\n\n' + scoringPrompt, inlineData);
        try { grading = parseGradingJSON(retryRaw); }
        catch (e2) { throw new Error(`AI returned invalid JSON — try again. Raw: ${retryRaw.slice(0, 200)}`); }
      }
      if (!Array.isArray(grading?.scores)) {
        throw new Error(`AI response missing scores array. Raw: ${scoringRaw.slice(0, 200)}`);
      }
      grading.totalPoints = grading.scores.reduce((/** @type {number} */ s, /** @type {any} */ sc) => s + (sc.pointsAwarded || 0), 0);

      // Feedback call — buildFeedbackPrompt already has feedback rules and submission
      const feedPrompt = buildFeedbackPrompt(title, instructions, rubric, sub, grading.scores, CFG.instructorName, CFG.instructorStyle);
      const splitFeedback = CFG.useClaudeForFeedback && CFG.claudeKey
        ? (await callClaude(feedPrompt)).trim()
        : stripThinking((await callAI(feedPrompt, null)).trim());

      return {
        scores:         grading.scores,
        totalPoints:    grading.totalPoints,
        overallComment: grading.overallComment,
        feedback:       splitFeedback || grading.overallComment || '',
      };
    }

    // ── Combined mode (normal assignments) ───────────────────────────────────
    const combinedRaw = await callAI(combinedPrompt, inlineData);
    try { grading = parseGradingJSON(combinedRaw); } catch (e) {
      setStatus('Response was not JSON — retrying with enforced format…', '#ffb060');
      const retryRaw = await callAI('CRITICAL: Output ONLY a raw JSON object starting with {. No text before or after it.\n\n' + combinedPrompt, inlineData);
      try { grading = parseGradingJSON(retryRaw); }
      catch (e2) { throw new Error(`AI returned invalid JSON — try again. Raw: ${retryRaw.slice(0, 200)}`); }
    }
    if (!Array.isArray(grading?.scores)) {
      throw new Error(`AI response missing scores array. Raw: ${combinedRaw.slice(0, 200)}`);
    }
    grading.totalPoints = grading.scores.reduce((/** @type {number} */ s, /** @type {any} */ sc) => s + (sc.pointsAwarded || 0), 0);

    const useClaude = CFG.useClaudeForFeedback && CFG.claudeKey;
    let feedback = typeof grading.feedback === 'string' ? stripThinking(grading.feedback.trim()) : '';
    if (useClaude) {
      const feedPrompt = buildFeedbackPrompt(title, instructions, rubric, sub, grading.scores, CFG.instructorName, CFG.instructorStyle);
      feedback = (await callClaude(feedPrompt)).trim();
    }
    if (!feedback) feedback = grading.overallComment || '';

    return { scores: grading.scores, totalPoints: grading.totalPoints, overallComment: grading.overallComment, feedback };
  }

  // ── Grade posting ────────────────────────────────────────────────────────
  // Encode FormData as application/x-www-form-urlencoded, keeping [ ] unencoded in
  // key names so PHP's parse_str correctly builds nested arrays for Moodle fields like
  // advancedgrading[criteria][86032][levelid].
  function fdToBody(/** @type {FormData} */ fd) {
    return [...fd.entries()]
      .map(([k, v]) => {
        const encodedKey = encodeURIComponent(k).replace(/%5B/gi, '[').replace(/%5D/gi, ']');
        return `${encodedKey}=${encodeURIComponent(/** @type {string} */(v))}`;
      })
      .join('&');
  }

  // Post a student's grade via mod_assign_submit_grading_form.
  // Steps: fetch the live grading form HTML → copy all its inputs → override rubric levels
  // with AI selections → submit. This mirrors what clicking "Save changes" does in Moodle's
  // AMD grader UI (mod_assign/grading_actions serialises the form and calls the same endpoint).
  async function postGrade(student, rubric, result, /** @type {any} */ _assignmentId) {
    const assignDbId = getAssignmentDbId();
    const sesskey    = getSesskey();
    if (!assignDbId || !sesskey) throw new Error('Cannot read assignmentId or sesskey from the page.');

    setStatus(`Loading grading form for ${student.name}…`, '#c9a0ff');

    // 1. Get the grading form. Prefer the live AMD-rendered form already in the page DOM —
    //    it has the correct _qf__ token and ajax=1 (what the web service expects).
    //    Only fall back to fetching the static ?action=grade page if the live form is absent
    //    or belongs to a different student.
    let /** @type {HTMLFormElement|null} */ form = null;
    const liveForm = /** @type {HTMLFormElement|null} */(document.querySelector('form#mform1'));
    const liveUid  = /** @type {HTMLInputElement|null} */(liveForm?.querySelector('input[name=userid]'))?.value;
    if (liveForm && (!liveUid || liveUid === student.uid)) {
      form = liveForm;
      console.log('[MAG] Using live DOM form | userid in form:', liveUid || '(not found)');
    } else {
      if (liveForm) console.log('[MAG] Live form userid', liveUid, '≠', student.uid, '— fetching static page');
      const pageResp = await xhr('GET', student.gradeLink);
      const formDoc  = new DOMParser().parseFromString(pageResp.responseText, 'text/html');
      form = /** @type {HTMLFormElement|null} */(
        formDoc.querySelector('form#mform1') || formDoc.querySelector('form[action*="assign"]')
      );
      console.log('[MAG] Static grade page HTTP', pageResp.status, '| form found:', !!form);
    }
    if (!form) throw new Error('Grade form (form#mform1) not found.');

    // 2. Copy form inputs into FormData.
    //    Exclusions:
    //    • submit/button/reset/image — browser submits only the clicked one; include none
    //    • advancedgrading[criteria][N][] blank placeholders — PHP parse_str merges these with
    //      our [levelid] entry into a mixed numeric/string-key array; Moodle rejects that
    const fd = new FormData();
    for (const el of /** @type {HTMLInputElement[]} */([...form.querySelectorAll('input, select, textarea')])) {
      if (!el.name) continue;
      if (el.type === 'submit' || el.type === 'button' || el.type === 'reset' || el.type === 'image') continue;
      if (/^advancedgrading\[criteria\]\[\d+\]\[\]$/.test(el.name)) continue;
      if (el.type === 'radio' || el.type === 'checkbox') {
        if (el.checked) fd.append(el.name, el.value);
      } else {
        fd.append(el.name, el.value);
      }
    }
    fd.set('sesskey', sesskey);

    // 3. Build criterion prefix map from the form's own radio/hidden inputs.
    //    Keeps an ordered array for index-based fallback (when criterionId is null).
    /** @type {Map<string,string>} */
    const formCriteriaMap = new Map();
    for (const el of /** @type {HTMLInputElement[]} */([...form.querySelectorAll('input[name]')])) {
      const m = el.name.match(/^advancedgrading\[criteria\]\[(\d+)\]\[levelid\]$/);
      if (m) formCriteriaMap.set(m[1], `advancedgrading[criteria][${m[1]}]`);
    }
    const formCriteriaByIndex = [...formCriteriaMap.values()];
    console.log('[MAG] formCriteriaMap keys:', [...formCriteriaMap.keys()],
      '| rubric criterionIds:', rubric?.map((/** @type {any} */ c) => c.criterionId));

    // 4. Apply AI rubric selections (criterionId match → index fallback).
    let rubricFieldsSet = 0;
    for (const score of result.scores || []) {
      const criterion = rubric[score.criterionIndex];
      if (!criterion) continue;
      const matchedLevel = criterion.levels.find((/** @type {any} */ l) => l.points === score.pointsAwarded)
                        || criterion.levels.reduce((/** @type {any} */ a, /** @type {any} */ b) =>
                            Math.abs(b.points - score.pointsAwarded) < Math.abs(a.points - score.pointsAwarded) ? b : a);
      if (!matchedLevel?.id) continue;
      const prefix = (criterion.criterionId && formCriteriaMap.get(criterion.criterionId))
                  || (criterion.criterionId && `advancedgrading[criteria][${criterion.criterionId}]`)
                  || formCriteriaByIndex[score.criterionIndex]
                  || null;
      if (!prefix) continue;
      fd.set(`${prefix}[levelid]`, String(matchedLevel.id));
      if (CFG.postRemarks && score.justification) {
        const maxPts = Math.max(0, ...(criterion.levels || []).map((/** @type {any} */ l) => l.points));
        const isDeducted = score.pointsAwarded < maxPts;
        if (!CFG.postRemarksDeductedOnly || isDeducted) {
          fd.set(`${prefix}[remark]`,       score.justification);
          fd.set(`${prefix}[remarkformat]`, '1');
        }
      }
      rubricFieldsSet++;
    }
    console.log('[MAG] rubric levels set:', rubricFieldsSet, '/ ', rubric?.length);

    // 5. Feedback
    fd.set('assignfeedbackcomments_editor[text]',   result.feedback || '');
    fd.set('assignfeedbackcomments_editor[format]', '1');

    const bodyStr = fdToBody(fd);
    setStatus(`Posting grade for ${student.name}…`, '#c9a0ff');

    // 6. Try the web service first (works on some Moodle installs).
    //    Moodle 4.x AMD passes jsonformdata as JSON.stringify(urlEncodedString).
    try {
      await moodleAjax('mod_assign_submit_grading_form', {
        assignmentid:  parseInt(assignDbId),
        userid:        parseInt(student.uid),
        attemptnumber: -1,
        jsonformdata:  JSON.stringify(bodyStr),
      });
      return true;
    } catch {
      // Web service not available on this Moodle — form POST fallback below
    }

    // 7. Fallback: traditional form POST (view.php?action=submitgrade in body).
    //    Moodle saves the grade and redirects to ?action=grading on success.
    const formAction = new URL(form.getAttribute('action') || '/mod/assign/view.php', student.gradeLink).href;
    const postR   = await xhr('POST', formAction, {
      body:    bodyStr,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    console.log('[MAG] form POST HTTP', postR.status, '→', postR.finalUrl || '(no redirect)');
    const respDoc = new DOMParser().parseFromString(postR.responseText, 'text/html');
    const errEl   = respDoc.querySelector('.errorbox, .alert-danger, .alert-error, .moodle-exception-message');
    if (errEl) throw new Error(errEl.textContent.trim().slice(0, 200));
    if (postR.status >= 400) throw new Error(`Grade POST failed: HTTP ${postR.status}`);
    return true;
  }

  // ── Plagiarism detection ─────────────────────────────────────────────────
  // All comparison runs locally in the browser — zero API calls.
  // "AI Confirm" per suspicious pair is manual and costs 1 API call only when triggered.

  function plagNormalize(/** @type {string} */ text) {
    return (text || '')
      .replace(/#[^\n]*/g, ' ')         // strip Python / shell comments
      .replace(/\/\/[^\n]*/g, ' ')      // strip JS / C++ line comments
      .replace(/[^a-z0-9\s]/gi, ' ')    // keep only alphanum + whitespace
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function plagShingles(/** @type {string} */ text, n = 5) {
    const words = text.split(' ').filter(Boolean);
    const set   = /** @type {Set<string>} */ (new Set());
    for (let i = 0; i <= words.length - n; i++) {
      set.add(words.slice(i, i + n).join('\x00'));
    }
    return set;
  }

  function plagJaccard(/** @type {Set<string>} */ setA, /** @type {Set<string>} */ setB) {
    if (!setA.size && !setB.size) return 0; // two empty texts are not "identical"
    if (!setA.size || !setB.size) return 0;
    let inter = 0;
    for (const s of setA) if (setB.has(s)) inter++;
    return inter / (setA.size + setB.size - inter);
  }

  function plagSimilarity(/** @type {string} */ textA, /** @type {string} */ textB) {
    const normA = plagNormalize(textA);
    const normB = plagNormalize(textB);
    if (!normA || !normB) return 0;
    if (normA === normB) return 1.0;
    return plagJaccard(plagShingles(normA), plagShingles(normB));
  }

  function computePlagiarismPairs(/** @type {Record<string,{name:string,extractedText:string}>} */ cache) {
    const entries = Object.entries(cache).filter(([, v]) => v.extractedText);
    const pairs = /** @type {{sA:any,sB:any,score:number}[]} */ ([]);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [uidA, dataA] = entries[i];
        const [uidB, dataB] = entries[j];
        const score = plagSimilarity(dataA.extractedText, dataB.extractedText);
        pairs.push({ sA: { uid: uidA, name: dataA.name }, sB: { uid: uidB, name: dataB.name }, score });
      }
    }
    return pairs.sort((a, b) => b.score - a.score);
  }

  function openPlagiarismPanel(/** @type {Record<string,{name:string,extractedText:string}>} */ cache) {
    const existing = document.getElementById('mag-plag-overlay');
    if (existing) existing.remove();

    setStatus('Running plagiarism check…', '#c9a0ff');
    const pairs = computePlagiarismPairs(cache);
    setStatus('Plagiarism check complete.', '#80d0a0');

    const overlay = document.createElement('div');
    overlay.id = 'mag-plag-overlay';

    const checkedCount = Object.keys(cache).length;
    const SHOW_MIN = 0.40;
    const visible  = pairs.filter(p => p.score >= SHOW_MIN);

    const scoreChip = (/** @type {number} */ score) => {
      const pct = Math.round(score * 100);
      const cls = pct === 100 ? 'exact' : pct >= 80 ? 'high' : pct >= 60 ? 'med' : 'low';
      const lbl = pct === 100 ? '⚠ Exact match' : pct >= 80 ? '⚠ Very high' : pct >= 60 ? '⚠ High' : 'Moderate';
      return `<span class="mag-plag-score mag-plag-${cls}">${pct}% ${lbl}</span>`;
    };

    const rowsHtml = visible.length
      ? visible.map((p, idx) => `
          <div class="mag-plag-row" id="mag-plag-row-${idx}">
            <span class="mag-plag-names">${p.sA.name} &amp; ${p.sB.name}</span>
            ${scoreChip(p.score)}
            <button class="mag-btn mag-plag-ai-btn" data-idx="${idx}" title="Ask AI to confirm (costs 1 API call)">AI Confirm</button>
            <div class="mag-plag-verdict" id="mag-plag-verdict-${idx}"></div>
          </div>`).join('')
      : `<div class="mag-plag-clear">No suspicious pairs found above 40% similarity.</div>`;

    const below = pairs.filter(p => p.score < SHOW_MIN);

    overlay.innerHTML = `
      <div class="mag-plag-box">
        <div class="mag-plag-header">
          <h3>🔍 Plagiarism Check</h3>
          <button class="mag-btn" id="mag-plag-close">✕</button>
        </div>
        <div class="mag-plag-body">
          <div class="mag-plag-meta">
            ${checkedCount} submission${checkedCount !== 1 ? 's' : ''} compared
            &nbsp;·&nbsp; ${visible.length} suspicious pair${visible.length !== 1 ? 's' : ''} flagged
            &nbsp;·&nbsp; 5-gram Jaccard similarity &nbsp;·&nbsp; 0 API calls used
          </div>
          ${rowsHtml}
          ${below.length ? `
            <details class="mag-plag-details">
              <summary>Show ${below.length} pair${below.length !== 1 ? 's' : ''} below 40% (likely coincidental)</summary>
              ${below.map(p => `
                <div class="mag-plag-row mag-plag-dim">
                  <span class="mag-plag-names">${p.sA.name} &amp; ${p.sB.name}</span>
                  <span class="mag-plag-score">${Math.round(p.score * 100)}%</span>
                </div>`).join('')}
            </details>` : ''}
        </div>
      </div>`;

    (document.getElementById('mag-review-overlay') || document.body).appendChild(overlay);

    const closeBtn = document.getElementById('mag-plag-close');
    if (closeBtn) closeBtn.onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // Draggable by header — same pattern as the review panel
    overlay.addEventListener('mousedown', e => {
      const header = /** @type {HTMLElement|null} */(/** @type {Element} */(e.target).closest('.mag-plag-header'));
      if (!header) return;
      const box = /** @type {HTMLElement|null} */(overlay.querySelector('.mag-plag-box'));
      if (!box) return;
      // On first drag switch from flex-centering to explicit absolute coords
      if (box.style.position !== 'absolute') {
        const r = box.getBoundingClientRect();
        overlay.style.alignItems     = 'flex-start';
        overlay.style.justifyContent = 'flex-start';
        box.style.position = 'absolute';
        box.style.left     = r.left + 'px';
        box.style.top      = r.top  + 'px';
      }
      const sx = e.clientX - box.offsetLeft;
      const sy = e.clientY - box.offsetTop;
      header.style.cursor = 'grabbing';
      const onMove = (/** @type {MouseEvent} */ ev) => {
        box.style.left = Math.max(0, Math.min(window.innerWidth  - box.offsetWidth,  ev.clientX - sx)) + 'px';
        box.style.top  = Math.max(0, Math.min(window.innerHeight - box.offsetHeight, ev.clientY - sy)) + 'px';
      };
      const onUp = () => {
        header.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });

    for (const btn of /** @type {NodeListOf<HTMLButtonElement>} */(overlay.querySelectorAll('.mag-plag-ai-btn'))) {
      btn.addEventListener('click', async () => {
        const idx  = parseInt(/** @type {HTMLButtonElement} */(btn).dataset.idx || '0');
        const pair = visible[idx];
        const vEl  = document.getElementById(`mag-plag-verdict-${idx}`);
        if (!vEl) return;
        btn.disabled    = true;
        btn.textContent = 'Analyzing…';
        vEl.innerHTML   = '';
        try {
          const clip = (/** @type {string} */ t, /** @type {number} */ n) => (t || '').slice(0, n);
          const prompt =
`You are checking two student submissions for academic dishonesty.
Similarity score: ${Math.round(pair.score * 100)}%

STUDENT A (${pair.sA.name}):
${clip(cache[pair.sA.uid].extractedText, 2500)}

---

STUDENT B (${pair.sB.name}):
${clip(cache[pair.sB.uid].extractedText, 2500)}

Respond ONLY with valid JSON (no markdown):
{"verdict":"likely_plagiarism"|"coincidental"|"uncertain","confidence":"high"|"medium"|"low","reason":"one sentence naming the specific element that matches or differs"}

Check: same variable names, identical code logic, same written arguments, same phrasing, same errors. Note if overlap comes from shared boilerplate or assignment template vs actual copied work.`;
          const raw    = await callAI(prompt, null);
          const match  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim().match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(match ? match[0] : raw);
          const icon   = parsed.verdict === 'likely_plagiarism' ? '🚨' : parsed.verdict === 'coincidental' ? '✓' : '❓';
          const cls    = `mag-plag-v-${parsed.verdict.replace(/_/g, '-')}`;
          vEl.innerHTML = `<span class="mag-plag-verdict-chip ${cls}">${icon} ${parsed.verdict.replace(/_/g, ' ')} (${parsed.confidence} confidence) — ${parsed.reason}</span>`;
          btn.textContent = 'Re-analyze';
          btn.disabled    = false;
        } catch (err) {
          vEl.textContent = `⚠ ${/** @type {Error} */(err).message}`;
          btn.textContent = 'Retry';
          btn.disabled    = false;
        }
      });
    }
  }

  // ── CSS ──────────────────────────────────────────────────────────────────
  GM_addStyle(`
    #mag-bar {
      position: fixed; top: 0; left: 50%; transform: translateX(-50%); z-index: 99999;
      width: 50%;
      border-radius: 0 0 10px 10px;
      background: linear-gradient(135deg, #2d0057, #5a0096);
      transition: all 0.18s ease;
      color: #fff; font-family: sans-serif; font-size: 13px;
      display: flex; align-items: center; gap: 10px;
      padding: 7px 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.35);
      cursor: grab;
    }
    #mag-bar button, #mag-bar select, #mag-bar input { cursor: pointer; }
    #mag-bar .mag-title { font-weight: bold; letter-spacing: 0.04em; margin-right: 6px; }
    #mag-bar .mag-sep   { opacity: 0.4; }
    #mag-bar.collapsed {
      left: auto; right: 10px; top: 10px; width: auto; border-radius: 8px;
      padding: 5px 10px; box-shadow: 0 2px 12px rgba(0,0,0,0.5); cursor: move;
      transition: border-radius 0.2s ease, padding 0.2s ease, box-shadow 0.2s ease;
    }
    #mag-bar.collapsed #mag-collapse-btn { cursor: pointer; }
    #mag-bar.collapsed .mag-title,
    #mag-bar.collapsed .mag-sep,
    #mag-bar.collapsed #mag-grade-one,
    #mag-bar.collapsed #mag-grade-n,
    #mag-bar.collapsed #mag-grade-n-count,
    #mag-bar.collapsed #mag-grade-all,
    #mag-bar.collapsed #mag-settings-btn,
    #mag-bar.collapsed #mag-status { display: none; }
    #mag-bar.collapsed #mag-collapse-btn::after { content: 'MAG'; }
    #mag-bar.collapsed.snapped-right {
      right: 0; left: auto;
      border-radius: 10px 0 0 10px;
      padding: 14px 7px;
      box-shadow: -3px 0 16px rgba(0,0,0,0.55);
    }
    #mag-bar.collapsed.snapped-right #mag-collapse-btn {
      writing-mode: vertical-lr;
      margin: 0; padding: 6px 4px;
    }
    /* Expanded bar snapped to right edge — vertical column layout */
    #mag-bar.snapped-right:not(.collapsed) {
      flex-direction: column;
      align-items: stretch;
      width: 148px;
      left: auto; right: 0;
      border-radius: 10px 0 0 10px;
      box-shadow: -3px 0 16px rgba(0,0,0,0.55);
      transform: none;
      padding: 10px 8px;
    }
    #mag-bar.snapped-right:not(.collapsed) .mag-sep { display: none; }
    #mag-bar.snapped-right:not(.collapsed) .mag-title {
      text-align: center; margin-right: 0;
      padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.2);
    }
    #mag-bar.snapped-right:not(.collapsed) #mag-status {
      margin-left: 0; margin-top: auto;
      font-size: 10px; white-space: normal; text-align: center;
    }
    #mag-bar.snapped-right:not(.collapsed) #mag-collapse-btn {
      margin-left: 0; align-self: center; margin-top: 4px;
    }
    /* Left-edge snapped — collapsed pill */
    #mag-bar.collapsed.snapped-left {
      left: 0; right: auto;
      border-radius: 0 10px 10px 0;
      padding: 14px 7px;
      box-shadow: 3px 0 16px rgba(0,0,0,0.55);
    }
    #mag-bar.collapsed.snapped-left #mag-collapse-btn {
      writing-mode: vertical-lr;
      margin: 0; padding: 6px 4px;
    }
    /* Left-edge snapped — expanded vertical column layout */
    #mag-bar.snapped-left:not(.collapsed) {
      flex-direction: column;
      align-items: stretch;
      width: 148px;
      left: 0; right: auto;
      border-radius: 0 10px 10px 0;
      box-shadow: 3px 0 16px rgba(0,0,0,0.55);
      transform: none;
      padding: 10px 8px;
    }
    #mag-bar.snapped-left:not(.collapsed) .mag-sep { display: none; }
    #mag-bar.snapped-left:not(.collapsed) .mag-title {
      text-align: center; margin-right: 0;
      padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.2);
    }
    #mag-bar.snapped-left:not(.collapsed) #mag-status {
      margin-left: 0; margin-top: auto;
      font-size: 10px; white-space: normal; text-align: center;
    }
    #mag-bar.snapped-left:not(.collapsed) #mag-collapse-btn {
      margin-left: 0; align-self: center; margin-top: 4px;
    }
    #mag-collapse-btn { margin-left: auto; font-size: 11px; padding: 3px 8px; opacity: 0.75; }
    #mag-collapse-btn:hover { opacity: 1; }
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
    #mag-grade-n-count {
      width: 34px; text-align: center; background: #1a0030;
      border: 1px solid #5a30a0; border-radius: 4px; color: #f0e8ff;
      font-size: 12px; padding: 3px 2px; -moz-appearance: textfield;
    }
    #mag-grade-n-count::-webkit-inner-spin-button,
    #mag-grade-n-count::-webkit-outer-spin-button { -webkit-appearance: none; }
    #mag-grade-n-count:focus { outline: none; border-color: #9060d0; }
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
      background: rgba(0,0,0,0.60);
    }
    #mag-review-overlay.open { display: block; }
    #mag-review-box {
      background: #0e0020; border: 1px solid #7b2fff;
      border-radius: 14px 14px 4px 14px; /* flat bottom-right so resize grip is visible */
      width: 820px; height: 75vh; min-width: 380px; min-height: 260px;
      color: #f0e8ff; font-family: sans-serif;
      box-shadow: 0 20px 60px rgba(0,0,0,0.8);
      position: absolute; top: 54px; left: 50%; transform: translateX(-50%);
      display: flex; flex-direction: column;
      resize: both; overflow: auto;
    }
    .mag-review-header {
      background: linear-gradient(135deg, #2d0057, #5a0096);
      padding: 16px 22px; border-radius: 14px 14px 0 0;
      display: flex; align-items: center; gap: 12px;
      cursor: grab; user-select: none; flex-shrink: 0;
    }
    .mag-review-header.dragging { cursor: grabbing; }
    .mag-review-header h3 { margin: 0; font-size: 15px; flex: 1; }
    #mag-review-box.minimized .mag-review-body,
    #mag-review-box.minimized .mag-review-footer { display: none; }
    #mag-review-box.minimized { height: auto !important; resize: none; min-height: 0 !important; }
    .mag-review-body { padding: 20px 22px; overflow-y: auto; flex: 1; min-height: 0; }
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
    .mag-score-deducted { background: rgba(200, 90, 10, 0.22); border-left: 2px solid rgba(220, 130, 30, 0.65); }
    .mag-fb-toolbar {
      display: flex; gap: 3px; margin-top: 4px; margin-bottom: 2px;
    }
    .mag-fb-fmt-btn {
      background: #2a0050; border: 1px solid #5a30a0; color: #c090ff;
      border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px;
      line-height: 1.5; transition: background 0.1s;
      font-family: sans-serif;
    }
    .mag-fb-fmt-btn:hover  { background: #3d0080; }
    .mag-fb-fmt-btn b  { font-weight: 700; }
    .mag-fb-fmt-btn em { font-style: italic; }
    .mag-fb-fmt-btn u  { text-decoration: underline; }
    .mag-feedback-area {
      width: 100%; box-sizing: border-box; background: #1a0030;
      border: 1px solid #4a2080; border-radius: 6px; color: #f0e8ff;
      padding: 8px 10px; font-size: 12px; font-family: sans-serif;
      min-height: 90px; margin-top: 0; outline: none; overflow-y: auto;
      line-height: 1.5; white-space: pre-wrap;
    }
    .mag-feedback-area:focus { border-color: #7b2fff; }
    .mag-feedback-label { font-size: 11px; color: #9070c0; margin-bottom: 2px; }
    /* Image attachment area */
    .mag-fb-img-area {
      display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px;
      min-height: 28px; margin-top: 6px; padding: 5px;
      border: 1px dashed #3a1a60; border-radius: 5px;
      background: rgba(18,0,36,0.3); box-sizing: border-box; width: 100%;
    }
    .mag-fb-paste-hint {
      font-size: 11px; color: #5a3090; font-style: italic;
      padding: 2px 4px; width: 100%; text-align: center;
    }
    .mag-fb-img-wrap {
      position: relative; display: inline-block; line-height: 0;
    }
    .mag-fb-img-wrap img {
      display: block; max-width: 100%; border-radius: 3px;
      border: 1px solid #4a2080;
    }
    .mag-fb-img-toolbar {
      position: absolute; top: 3px; right: 3px;
      display: flex; gap: 3px; opacity: 0; transition: opacity 0.15s;
    }
    .mag-fb-img-wrap:hover .mag-fb-img-toolbar { opacity: 1; }
    .mag-fb-img-btn {
      background: rgba(20,0,40,0.88); border: 1px solid #7040c0;
      color: #d0b0ff; border-radius: 3px; padding: 2px 6px;
      cursor: pointer; font-size: 10px; line-height: 1.5;
    }
    .mag-fb-img-btn:hover { background: rgba(80,30,160,0.88); }
    .mag-fb-resize-handle {
      position: absolute; width: 12px; height: 12px;
      background: #7b2fff; opacity: 0.55; transition: opacity 0.12s;
    }
    .mag-fb-resize-handle:hover { opacity: 1; }
    .mag-fb-resize-handle[data-corner="nw"] { top:1px;  left:1px;  cursor:nw-resize; border-radius:0 3px 0 3px; }
    .mag-fb-resize-handle[data-corner="ne"] { top:1px;  right:1px; cursor:ne-resize; border-radius:3px 0 3px 0; }
    .mag-fb-resize-handle[data-corner="sw"] { bottom:1px; left:1px;  cursor:sw-resize; border-radius:3px 0 3px 0; }
    .mag-fb-resize-handle[data-corner="se"] { bottom:1px; right:1px; cursor:se-resize; border-radius:0 3px 0 3px; }
    /* Crop modal */
    #mag-crop-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.84);
      z-index: 1000001; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
    }
    #mag-crop-wrap { position: relative; cursor: crosshair; user-select: none; }
    #mag-crop-sel {
      position: absolute; display: none;
      border: 2px solid #a060ff; background: rgba(120,40,255,0.18);
      pointer-events: none; box-sizing: border-box;
    }
    .mag-justif-ta {
      width: 100%; box-sizing: border-box; background: #140025;
      border: 1px solid #3a1060; border-radius: 4px; color: #cdb8f0;
      padding: 4px 6px; font-size: 11px; font-family: sans-serif;
      resize: vertical; min-height: 38px;
    }
    .mag-justif-ta:focus { border-color: #7040c0; outline: none; }
    .mag-card-actions { display: flex; gap: 8px; margin-top: 10px; }
    .mag-post-btn { background: #7b2fff; border: none; color: #fff; border-radius: 5px; padding: 5px 14px; cursor: pointer; font-size: 12px; }
    .mag-post-btn:hover { background: #9040ff; }
    .mag-post-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .mag-skip-btn { background: #2a1040; border: 1px solid #5a30a0; color: #c0a0e0; border-radius: 5px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
    .mag-skip-btn:hover { background: #3a1860; }
    .mag-regrade-btn { background: #3a1a8a; border: 1px solid #7050c0; color: #d0b0ff; border-radius: 5px; padding: 6px 16px; cursor: pointer; font-size: 12px; }
    .mag-regrade-btn:hover { background: #4a2aaa; }
    .mag-post-progress { width: 100%; margin-top: 8px; display: none; }
    .mag-progress-track { height: 5px; background: #2a1040; border-radius: 3px; overflow: hidden; }
    .mag-progress-fill {
      height: 100%; width: 0; border-radius: 3px;
      background: linear-gradient(90deg, #7b2fff, #c060ff, #7b2fff);
      background-size: 200% 100%;
      transition: width 0.5s ease;
      animation: mag-shimmer 1.8s linear infinite;
    }
    .mag-progress-fill.mag-complete {
      animation: none; background: #40c080; transition: width 0.25s ease;
    }
    @keyframes mag-shimmer {
      0%   { background-position: 0% 50%; }
      100% { background-position: 200% 50%; }
    }
    .mag-post-result-row { display: none; flex-direction: row; gap: 6px; margin-top: 8px; }
    .mag-done-btn, .mag-stay-btn, .mag-move-btn {
      flex: 1; border: none; color: #fff;
      border-radius: 5px; padding: 7px 10px; cursor: pointer;
      font-size: 12px; font-weight: 600; letter-spacing: 0.03em;
    }
    .mag-done-btn { background: #40c080; }
    .mag-done-btn:hover { background: #50d090; }
    .mag-stay-btn { background: #5a30c8; }
    .mag-stay-btn:hover { background: #6a40d8; }
    .mag-move-btn { background: #c07820; }
    .mag-move-btn:hover { background: #d08830; }
    .mag-overall-comment { font-size: 11px; color: #9070c0; margin-top: 6px; font-style: italic; }
    .mag-review-footer {
      padding: 14px 22px; border-top: 1px solid #2a1040;
      display: flex; gap: 10px; align-items: center; justify-content: flex-end;
    }
    .mag-progress-text { flex: 1; font-size: 12px; color: #9070c0; }
    .mag-remarks-label {
      display: flex; align-items: center; gap: 5px;
      font-size: 12px; color: #9070c0; cursor: pointer; user-select: none;
      white-space: nowrap; transition: opacity 0.15s;
    }
    .mag-remarks-label input[type=checkbox] { accent-color: #7b2fff; cursor: pointer; }
    .mag-remarks-label.mag-disabled { opacity: 0.38; cursor: not-allowed; pointer-events: none; }
    .mag-remarks-label.mag-disabled input[type=checkbox] { cursor: not-allowed; }

    /* ── Plagiarism panel ─────────────────────────────────────────────────── */
    .mag-plag-overlay {
      display: flex; position: absolute; inset: 0; z-index: 10;
      background: rgba(0,0,0,0.60); align-items: center; justify-content: center;
    }
    .mag-plag-box {
      background: #0e0020; border: 1px solid #7b2fff; border-radius: 14px;
      width: 700px; max-width: 96vw; max-height: 80vh;
      color: #f0e8ff; font-family: sans-serif;
      box-shadow: 0 20px 60px rgba(0,0,0,0.8);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .mag-plag-header {
      background: linear-gradient(135deg, #2d0057, #5a0096);
      padding: 16px 22px; border-radius: 14px 14px 0 0;
      display: flex; align-items: center; gap: 12px; flex-shrink: 0;
      cursor: grab; user-select: none;
    }
    .mag-plag-header h3 { margin: 0; font-size: 15px; flex: 1; }
    .mag-plag-body { padding: 20px 22px; overflow-y: auto; flex: 1; }
    .mag-plag-meta { font-size: 12px; color: #7060a0; margin-bottom: 14px; }
    .mag-plag-clear { color: #60d090; font-size: 13px; padding: 8px 0; }
    .mag-plag-row {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 9px 0; border-bottom: 1px solid #1a0030; font-size: 13px;
    }
    .mag-plag-dim { opacity: 0.45; }
    .mag-plag-names { flex: 1; min-width: 180px; font-weight: 500; }
    .mag-plag-score {
      font-size: 11px; padding: 3px 9px; border-radius: 12px;
      white-space: nowrap; font-weight: bold;
    }
    .mag-plag-exact { background: rgba(220,20,20,0.55);  color: #ff9090; }
    .mag-plag-high  { background: rgba(200,60,20,0.40);  color: #ff8050; }
    .mag-plag-med   { background: rgba(180,130,20,0.40); color: #ffc050; }
    .mag-plag-low   { background: rgba(150,150,20,0.30); color: #d8c840; }
    .mag-plag-ai-btn { font-size: 11px; padding: 3px 10px; white-space: nowrap; }
    .mag-plag-verdict { width: 100%; font-size: 11px; padding: 2px 0; }
    .mag-plag-verdict-chip { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; }
    .mag-plag-v-likely-plagiarism { background: rgba(200,20,20,0.30); color: #ff6060; }
    .mag-plag-v-coincidental      { background: rgba(20,160,80,0.30);  color: #60d090; }
    .mag-plag-v-uncertain         { background: rgba(150,140,20,0.30); color: #d0c060; }
    .mag-plag-details { margin-top: 12px; }
    .mag-plag-details summary { font-size: 11px; color: #6050a0; cursor: pointer; padding: 4px 0; }
  `);

  // ── Toolbar ──────────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.id = 'mag-bar';
  bar.innerHTML = `
    <span class="mag-title">✦ Moodle AutoGrader</span>
    <span class="mag-sep">|</span>
    <button class="mag-btn primary" id="mag-grade-one">Grade submission ▸</button>
    <input type="number" id="mag-grade-n-count" min="1" max="99" value="5" title="Batch size">
    <button class="mag-btn" id="mag-grade-n" style="background:rgba(80,40,160,0.45);border-color:rgba(160,100,255,0.6)" title="Auto-grade and post the next N ungraded students">Grade N ▸▸</button>
    <button class="mag-btn" id="mag-grade-all" style="background:rgba(180,80,20,0.35);border-color:rgba(255,150,60,0.5)" title="Auto-grade and post every student in sequence">Grade All ▸▸</button>
    <span class="mag-sep">|</span>
    <button class="mag-btn" id="mag-settings-btn">⚙ Settings</button>
    <span id="mag-status"></span>
    <button class="mag-btn" id="mag-collapse-btn" title="Collapse toolbar">‹</button>
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
        <label>Gemini API Key(s) ⭐ <em style="opacity:.6">(recommended — free, large context, reads PDFs natively)</em></label>
        <input type="text" id="mag-s-gemini" placeholder="AIza..." style="font-family:monospace;font-size:0.85em">
        <div class="mag-hint">Free key: <strong>aistudio.google.com</strong> → Get API key. No billing required.<br>
        <strong>Beat daily quota:</strong> paste multiple keys separated by commas — backup keys activate automatically when the active one is quota-exhausted.</div>
      </div>
      <div class="mag-field">
        <label>Gemini model</label>
        <input type="text" id="mag-s-gemini-model" placeholder="gemini-3.6-flash">
        <div class="mag-hint">Default: gemini-3.6-flash (Google's recommended replacement for 2.0-flash). Also available: gemini-3.5-flash, gemini-2.5-flash. Clear field to reset to default.</div>
      </div>
      <div class="mag-field">
        <label>OpenRouter API Key <em style="opacity:.6">(2nd — free tier, DeepSeek / Llama 70B quality)</em></label>
        <input type="password" id="mag-s-openrouter" placeholder="sk-or-...">
        <div class="mag-hint">Free key: <strong>openrouter.ai</strong> → Sign up → API Keys. Auto-selects the best available free model.</div>
      </div>
      <div class="mag-field">
        <label>OpenRouter model</label>
        <input type="text" id="mag-s-openrouter-model" placeholder="deepseek/deepseek-chat-v3-0324:free">
        <div class="mag-hint">Leave blank to auto-detect the best free model. Browse: openrouter.ai/models?max_price=0</div>
      </div>
      <div class="mag-field">
        <label>Mistral API Key <em style="opacity:.6">(3rd — permanently free tier, ~1B tokens/mo, fast)</em></label>
        <input type="password" id="mag-s-mistral" placeholder="...">
        <div class="mag-hint">Free key: <strong>console.mistral.ai</strong> → Sign up → API Keys. No credit card required. Text-only.</div>
      </div>
      <div class="mag-field">
        <label>Mistral model</label>
        <input type="text" id="mag-s-mistral-model" placeholder="mistral-small-latest">
        <div class="mag-hint">Default: mistral-small-latest. Also on free tier: open-mistral-nemo.</div>
      </div>
      <div class="mag-field">
        <label>Groq API Key <em style="opacity:.6">(4th — free tier, ~1K req/day, Llama 70B, very fast)</em></label>
        <input type="password" id="mag-s-groq" placeholder="gsk_...">
        <div class="mag-hint">Free key: <strong>console.groq.com</strong> → Sign up → API Keys. No credit card required.</div>
      </div>
      <div class="mag-field">
        <label>Groq model</label>
        <input type="text" id="mag-s-groq-model" placeholder="llama-3.3-70b-versatile">
        <div class="mag-hint">Default: llama-3.3-70b-versatile. Also available: llama-4-scout, kimi-k2. Text-only — no PDFs.</div>
      </div>
      <div class="mag-field">
        <label><input type="checkbox" id="mag-s-ollama"> Use Ollama (4th — local &amp; offline, free, requires Ollama on localhost:11434)</label>
        <div class="mag-hint">Install: <strong>ollama.com</strong> → run <code>ollama pull phi4</code> (or any model).</div>
      </div>
      <div class="mag-field">
        <label>Ollama model</label>
        <input type="text" id="mag-s-ollama-model" placeholder="phi4">
        <div class="mag-hint">Default: phi3. Recommended: phi4, llama3.1, qwen2.5. Run <code>ollama list</code> to see installed models.</div>
      </div>
      <div class="mag-field">
        <label>HuggingFace Token <em style="opacity:.6">(last resort — free, text-only, 8K context limit)</em></label>
        <input type="password" id="mag-s-hf" placeholder="hf_...">
        <div class="mag-hint">Free token: <strong>huggingface.co</strong> → Settings → Access Tokens → New token (Read).</div>
      </div>
      <div class="mag-field">
        <label>HuggingFace model</label>
        <input type="text" id="mag-s-hf-model" placeholder="meta-llama/Llama-3.1-8B-Instruct">
        <div class="mag-hint">Default: meta-llama/Llama-3.1-8B-Instruct. Larger: Qwen/Qwen2.5-72B-Instruct (may require PRO).</div>
      </div>
      <div class="mag-field">
        <label>Claude API Key <em style="opacity:.6">(optional — for higher-quality feedback)</em></label>
        <input type="password" id="mag-s-claude" placeholder="sk-ant-...">
        <div class="mag-hint">Leave blank to use Gemini/OpenRouter for feedback too.</div>
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
        <label><input type="checkbox" id="mag-s-post-remarks"> Write AI justifications to rubric remark boxes when posting grade</label>
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
    /** @type {HTMLInputElement} */(document.getElementById('mag-s-gemini')).value       = CFG.geminiKeys.join(', ');
    /** @type {HTMLInputElement} */(document.getElementById('mag-s-gemini-model')).value = CFG.geminiModel;

    /** @type {HTMLInputElement} */(document.getElementById('mag-s-ollama')).checked         = CFG.ollamaEnabled;
    /** @type {HTMLInputElement} */(document.getElementById('mag-s-ollama-model')).value     = CFG.ollamaModel;
    /** @type {HTMLInputElement} */(document.getElementById('mag-s-hf')).value               = CFG.hfKey;
    /** @type {HTMLInputElement} */(document.getElementById('mag-s-hf-model')).value         = CFG.hfModel;
    /** @type {HTMLInputElement} */(document.getElementById('mag-s-openrouter')).value       = CFG.openrouterKey;
    /** @type {HTMLInputElement} */(document.getElementById('mag-s-openrouter-model')).value = CFG.openrouterModel;
    /** @type {HTMLInputElement} */(document.getElementById('mag-s-mistral')).value          = CFG.mistralKey;
    /** @type {HTMLInputElement} */(document.getElementById('mag-s-mistral-model')).value   = CFG.mistralModel;
    /** @type {HTMLInputElement} */(document.getElementById('mag-s-groq')).value             = CFG.groqKey;
    /** @type {HTMLInputElement} */(document.getElementById('mag-s-groq-model')).value       = CFG.groqModel;
    document.getElementById('mag-s-claude').value       = CFG.claudeKey;
    document.getElementById('mag-s-use-claude').checked = CFG.useClaudeForFeedback;
    document.getElementById('mag-s-name').value     = CFG.instructorName;
    document.getElementById('mag-s-style').value    = CFG.instructorStyle;
    /** @type {HTMLInputElement} */(document.getElementById('mag-s-post-remarks')).checked = CFG.postRemarks;
    document.getElementById('mag-s-auto').checked         = CFG.autoPost;
    settingsOverlay.classList.add('open');
  }
  function closeSettings() { settingsOverlay.classList.remove('open'); }

  document.getElementById('mag-settings-btn').onclick = openSettings;
  const applyBarPos = () => {
    try {
      const pos = JSON.parse(get('barPos') || 'null');
      if (!pos) return;
      if (pos.snappedRight) {
        bar.classList.add('snapped-right');
        bar.style.right = '0'; bar.style.left = 'auto';
        if (pos.top != null) bar.style.top = pos.top + 'px';
      } else if (pos.snappedLeft) {
        bar.classList.add('snapped-left');
        bar.style.left = '0'; bar.style.right = 'auto';
        if (pos.top != null) bar.style.top = pos.top + 'px';
      } else if (pos.left != null) {
        bar.style.right     = 'auto';
        bar.style.left      = pos.left + 'px';
        bar.style.top       = pos.top  + 'px';
        // If restoring an expanded bar's floating position, detach from the CSS anchor
        if (!bar.classList.contains('collapsed')) {
          bar.style.transform    = 'none';
          bar.style.borderRadius = '10px';
        }
      }
    } catch {}
  };

  document.getElementById('mag-collapse-btn').onclick = () => {
    const wasSnappedRight = bar.classList.contains('snapped-right');
    const wasSnappedLeft  = bar.classList.contains('snapped-left');
    const collapsed = bar.classList.toggle('collapsed');
    /** @type {HTMLButtonElement} */ (document.getElementById('mag-collapse-btn')).textContent =
      collapsed ? '' : '‹';
    set('barCollapsed', collapsed ? '1' : '');
    if (!collapsed) {
      bar.style.transition = 'none';
      bar.classList.remove('snapped-right');
      bar.classList.remove('snapped-left');
      bar.style.width = ''; bar.style.transform = '';

      if (wasSnappedRight) {
        bar.classList.add('snapped-right');
        bar.style.borderRadius = '';
        bar.style.right = '0'; bar.style.left = 'auto';
        try {
          const pos = JSON.parse(get('barPos') || 'null');
          if (pos?.top != null) bar.style.top = pos.top + 'px';
        } catch {}
      } else if (wasSnappedLeft) {
        bar.classList.add('snapped-left');
        bar.style.borderRadius = '';
        bar.style.left = '0'; bar.style.right = 'auto';
        try {
          const pos = JSON.parse(get('barPos') || 'null');
          if (pos?.top != null) bar.style.top = pos.top + 'px';
        } catch {}
      } else {
        bar.style.borderRadius = '';
        try {
          const pos = JSON.parse(get('barPos') || 'null');
          if (pos && !pos.snappedRight && !pos.snappedLeft && pos.left != null) {
            bar.style.left = pos.left + 'px';
            bar.style.top  = pos.top  + 'px';
            bar.style.right = 'auto';
            bar.style.borderRadius = '10px';
          } else {
            bar.style.left = ''; bar.style.top = ''; bar.style.right = '';
          }
        } catch {
          bar.style.left = ''; bar.style.top = ''; bar.style.right = '';
        }
      }

      requestAnimationFrame(() => { bar.style.transition = ''; });
    } else {
      applyBarPos();
    }
  };

  // Restore collapsed state + drag position across page loads
  if (get('barCollapsed') === '1') {
    bar.classList.add('collapsed');
    /** @type {HTMLButtonElement} */ (document.getElementById('mag-collapse-btn')).textContent = '';
  }
  applyBarPos(); // restores position for both collapsed and expanded states

  // Draggable bar — works in both collapsed and expanded states.
  // Right-edge snap (within 80px): bar slides to right edge and locks there.
  // Collapsed+snapped → vertical pill.  Expanded+snapped → horizontal strip at right.
  // Dragging the expanded bar near right edge collapses it first, then snaps.
  bar.addEventListener('mousedown', (/** @type {MouseEvent} */ e) => {
    if (e.button !== 0) return;
    const isCollapsed = bar.classList.contains('collapsed');
    // In expanded mode skip drag when clicking buttons, selects, inputs
    if (!isCollapsed && /** @type {HTMLElement} */(e.target).closest('button, select, input, a')) return;

    const SNAP_DIST = 80;
    let dragging = false;
    const wasSnapped   = isCollapsed && (bar.classList.contains('snapped-right') || bar.classList.contains('snapped-left'));
    const wasExpanded  = !isCollapsed;

    // Capture initial visual rect BEFORE any class changes
    const rect  = bar.getBoundingClientRect();
    let grabX = e.clientX - rect.left;
    let grabY = e.clientY - rect.top;

    const onMove = (/** @type {MouseEvent} */ ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        dragging = true;
        bar.style.transition = 'none';
        bar.style.cursor     = 'grabbing';

        if (wasSnapped) {
          // Unsnap on first movement (not on mousedown) so a plain click expands normally
          bar.classList.remove('snapped-right');
          bar.classList.remove('snapped-left');
          bar.style.left  = Math.max(0, ev.clientX - bar.offsetWidth  / 2) + 'px';
          bar.style.top   = Math.max(0, ev.clientY - bar.offsetHeight / 2) + 'px';
          bar.style.right = 'auto';
          grabX = ev.clientX - bar.offsetLeft;
          grabY = ev.clientY - bar.offsetTop;
        } else if (wasExpanded) {
          // Detach from percentage/transform anchor; snap-zone logic below handles left/right each frame
          bar.style.transform    = 'none';
          bar.style.top          = rect.top + 'px';
          bar.style.borderRadius = '10px';
        } else {
          bar.style.right = 'auto';
        }
      }

      const rawTop = Math.max(0, Math.min(window.innerHeight - bar.offsetHeight, ev.clientY - grabY));

      if (wasExpanded) {
        // Use mouse-cursor distance from each edge for snap zone — avoids width-feedback oscillation
        const nearRight = (window.innerWidth - ev.clientX) < SNAP_DIST;
        const nearLeft  = ev.clientX < SNAP_DIST;
        bar.style.top = rawTop + 'px';
        if (nearRight) {
          if (bar.classList.contains('snapped-left'))  { bar.classList.remove('snapped-left');  bar.style.borderRadius = '10px'; }
          if (!bar.classList.contains('snapped-right')) { bar.classList.add('snapped-right'); bar.style.borderRadius = ''; }
          bar.style.left = 'auto'; bar.style.right = '0';
        } else if (nearLeft) {
          if (bar.classList.contains('snapped-right')) { bar.classList.remove('snapped-right'); bar.style.borderRadius = '10px'; }
          if (!bar.classList.contains('snapped-left'))  { bar.classList.add('snapped-left');  bar.style.borderRadius = ''; }
          bar.style.right = 'auto'; bar.style.left = '0';
        } else {
          if (bar.classList.contains('snapped-right')) { bar.classList.remove('snapped-right'); bar.style.borderRadius = '10px'; }
          if (bar.classList.contains('snapped-left'))  { bar.classList.remove('snapped-left');  bar.style.borderRadius = '10px'; }
          const rawLeft = Math.max(0, Math.min(window.innerWidth - bar.offsetWidth, ev.clientX - grabX));
          bar.style.right = 'auto';
          bar.style.left  = rawLeft + 'px';
        }
      } else {
        // Collapsed: position-based magnetic snap on both edges
        const rawLeft   = Math.max(0, Math.min(window.innerWidth - bar.offsetWidth, ev.clientX - grabX));
        const fromRight = window.innerWidth - (rawLeft + bar.offsetWidth);
        const fromLeft  = rawLeft;
        let finalLeft;
        if (fromRight < SNAP_DIST)     finalLeft = window.innerWidth - bar.offsetWidth;
        else if (fromLeft < SNAP_DIST) finalLeft = 0;
        else                           finalLeft = rawLeft;
        bar.style.left = finalLeft + 'px';
        bar.style.top  = rawTop + 'px';
      }
    };

    const onUp = () => {
      bar.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      if (!dragging) return;

      bar.style.transition = '';

      if (wasExpanded) {
        // Live preview already positioned the bar — just finalize state
        if (bar.classList.contains('snapped-right')) {
          bar.style.left = 'auto'; bar.style.right = '0';
          set('barPos', JSON.stringify({ snappedRight: true, top: bar.offsetTop }));
        } else if (bar.classList.contains('snapped-left')) {
          bar.style.right = 'auto'; bar.style.left = '0';
          set('barPos', JSON.stringify({ snappedLeft: true, top: bar.offsetTop }));
        } else {
          set('barPos', JSON.stringify({ left: bar.offsetLeft, top: bar.offsetTop }));
        }
      } else {
        // Collapsed: slide-to-edge animation then snap on right or left, or save position
        const bcr          = bar.getBoundingClientRect();
        const distFromRight = window.innerWidth - bcr.right;
        const distFromLeft  = bcr.left;

        if (distFromRight < SNAP_DIST) {
          const targetLeft   = window.innerWidth - bar.offsetWidth;
          const alreadyFlush = Math.abs(bar.offsetLeft - targetLeft) < 2;
          const applySnap = () => {
            bar.style.transition = '';
            bar.classList.add('snapped-right');
            bar.style.left = 'auto'; bar.style.right = '0';
            set('barPos', JSON.stringify({ snappedRight: true, top: bar.offsetTop }));
          };
          if (alreadyFlush) {
            applySnap();
          } else {
            bar.style.transition = 'left 0.2s ease';
            bar.style.left = targetLeft + 'px';
            const onEnd = (/** @type {TransitionEvent} */ ev) => {
              if (ev.propertyName !== 'left') return;
              bar.removeEventListener('transitionend', onEnd);
              applySnap();
            };
            bar.addEventListener('transitionend', onEnd);
          }
        } else if (distFromLeft < SNAP_DIST) {
          const alreadyFlush = bar.offsetLeft < 2;
          const applySnap = () => {
            bar.style.transition = '';
            bar.classList.add('snapped-left');
            bar.style.right = 'auto'; bar.style.left = '0';
            set('barPos', JSON.stringify({ snappedLeft: true, top: bar.offsetTop }));
          };
          if (alreadyFlush) {
            applySnap();
          } else {
            bar.style.transition = 'left 0.2s ease';
            bar.style.left = '0';
            const onEnd = (/** @type {TransitionEvent} */ ev) => {
              if (ev.propertyName !== 'left') return;
              bar.removeEventListener('transitionend', onEnd);
              applySnap();
            };
            bar.addEventListener('transitionend', onEnd);
          }
        } else {
          set('barPos', JSON.stringify({ left: bar.offsetLeft, top: bar.offsetTop }));
        }
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
  document.getElementById('mag-s-cancel').onclick     = closeSettings;
  document.getElementById('mag-s-save').onclick = () => {
    set('gemini_key',   /** @type {HTMLInputElement} */(document.getElementById('mag-s-gemini')).value.trim());
    set('gemini_model', (/** @type {HTMLInputElement} */(document.getElementById('mag-s-gemini-model')).value.trim()) || GEMINI_DEFAULT);

    set('ollama_enabled',   /** @type {HTMLInputElement} */(document.getElementById('mag-s-ollama')).checked ? 'true' : 'false');
    set('ollama_model',     (/** @type {HTMLInputElement} */(document.getElementById('mag-s-ollama-model')).value.trim()) || OLLAMA_DEFAULT);
    set('hf_key',           /** @type {HTMLInputElement} */(document.getElementById('mag-s-hf')).value.trim());
    set('hf_model',         (/** @type {HTMLInputElement} */(document.getElementById('mag-s-hf-model')).value.trim()) || HF_DEFAULT);
    set('openrouter_key',   /** @type {HTMLInputElement} */(document.getElementById('mag-s-openrouter')).value.trim());
    set('openrouter_model', (/** @type {HTMLInputElement} */(document.getElementById('mag-s-openrouter-model')).value.trim()) || OPENROUTER_DEFAULT);
    set('mistral_key',      /** @type {HTMLInputElement} */(document.getElementById('mag-s-mistral')).value.trim());
    set('mistral_model',    (/** @type {HTMLInputElement} */(document.getElementById('mag-s-mistral-model')).value.trim()) || MISTRAL_DEFAULT);
    set('groq_key',         /** @type {HTMLInputElement} */(document.getElementById('mag-s-groq')).value.trim());
    set('groq_model',       (/** @type {HTMLInputElement} */(document.getElementById('mag-s-groq-model')).value.trim()) || GROQ_DEFAULT);
    set('claude_key',      document.getElementById('mag-s-claude').value.trim());
    set('claude_feedback', document.getElementById('mag-s-use-claude').checked ? 'true' : 'false');
    set('instructor_name', document.getElementById('mag-s-name').value.trim() || 'Instructor');
    set('instructor_style',document.getElementById('mag-s-style').value.trim() || 'direct and constructive');
    set('post_remarks',    /** @type {HTMLInputElement} */(document.getElementById('mag-s-post-remarks')).checked ? 'true' : 'false');
    set('auto_post',       /** @type {HTMLInputElement} */(document.getElementById('mag-s-auto')).checked ? 'true' : 'false');
    closeSettings();
    setStatus('Settings saved.', '#80d0a0');
  };
  settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) closeSettings(); });

  // ── Feedback image paste / crop / resize ─────────────────────────────────

  /** Show a full-screen crop modal. onConfirm receives a compressed data URL. */
  function showCropModal(/** @type {string} */ dataUrl, /** @type {(url: string) => void} */ onConfirm) {
    const img = new Image();
    img.onload = () => {
      const maxW  = window.innerWidth  * 0.82;
      const maxH  = window.innerHeight * 0.66;
      const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const dW    = Math.round(img.naturalWidth  * scale);
      const dH    = Math.round(img.naturalHeight * scale);

      const overlay = document.createElement('div');
      overlay.id = 'mag-crop-overlay';
      overlay.innerHTML = `
        <div style="color:#d0b0ff;font-size:13px;margin-bottom:10px;text-align:center">
          Drag to select a crop region, or use Insert Full
        </div>
        <div id="mag-crop-wrap" style="width:${dW}px;height:${dH}px">
          <img src="${dataUrl}" style="width:${dW}px;height:${dH}px;display:block;pointer-events:none">
          <div id="mag-crop-sel"></div>
        </div>
        <div style="margin-top:14px;display:flex;gap:10px">
          <button id="mag-crop-ok"     style="background:#7b2fff;border:none;color:#fff;border-radius:6px;padding:8px 20px;cursor:pointer;font-size:13px">✂ Crop &amp; Insert</button>
          <button id="mag-crop-full"   style="background:#2a1050;border:1px solid #7040c0;color:#d0b0ff;border-radius:6px;padding:8px 20px;cursor:pointer;font-size:13px">Insert Full</button>
          <button id="mag-crop-cancel" style="background:#1a0030;border:1px solid #4a2060;color:#9070c0;border-radius:6px;padding:8px 20px;cursor:pointer;font-size:13px">Cancel</button>
        </div>
      `;
      document.body.appendChild(overlay);

      const wrap = /** @type {HTMLElement} */(document.getElementById('mag-crop-wrap'));
      const sel  = /** @type {HTMLElement} */(document.getElementById('mag-crop-sel'));
      let sx = 0, sy = 0, active = false;
      /** @type {{x:number,y:number,w:number,h:number}|null} */ let cropRect = null;

      wrap.addEventListener('mousedown', ev => {
        ev.preventDefault();
        const r = wrap.getBoundingClientRect();
        sx = ev.clientX - r.left; sy = ev.clientY - r.top;
        active = true; cropRect = null;
        Object.assign(sel.style, { display:'block', left:sx+'px', top:sy+'px', width:'0', height:'0' });
      });
      const onDragMove = (/** @type {MouseEvent} */ ev) => {
        if (!active) return;
        const r  = wrap.getBoundingClientRect();
        const cx = Math.max(0, Math.min(dW, ev.clientX - r.left));
        const cy = Math.max(0, Math.min(dH, ev.clientY - r.top));
        Object.assign(sel.style, {
          left: Math.min(sx,cx)+'px', top: Math.min(sy,cy)+'px',
          width: Math.abs(cx-sx)+'px', height: Math.abs(cy-sy)+'px',
        });
      };
      const onDragUp = (/** @type {MouseEvent} */ ev) => {
        if (!active) return;
        active = false;
        const r  = wrap.getBoundingClientRect();
        const cx = Math.max(0, Math.min(dW, ev.clientX - r.left));
        const cy = Math.max(0, Math.min(dH, ev.clientY - r.top));
        const w  = Math.abs(cx - sx) / scale;
        const h  = Math.abs(cy - sy) / scale;
        if (w > 5 && h > 5) cropRect = {
          x: Math.min(sx, cx) / scale, y: Math.min(sy, cy) / scale, w, h,
        };
      };
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup',   onDragUp);

      /** Compress to JPEG ≤ maxSide wide and call onConfirm */
      const compress = (/** @type {HTMLImageElement} */ srcImg, /** @type {number} */ sx2, /** @type {number} */ sy2, /** @type {number} */ sw, /** @type {number} */ sh, maxSide = 900) => {
        const ratio = Math.min(1, maxSide / sw, maxSide / sh);
        const c = document.createElement('canvas');
        c.width = Math.round(sw * ratio); c.height = Math.round(sh * ratio);
        /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')).drawImage(srcImg, sx2, sy2, sw, sh, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.86);
      };

      const btnOk     = /** @type {HTMLElement} */ (document.getElementById('mag-crop-ok'));
      const btnFull   = /** @type {HTMLElement} */ (document.getElementById('mag-crop-full'));
      const btnCancel = /** @type {HTMLElement} */ (document.getElementById('mag-crop-cancel'));

      btnOk.onclick = () => {
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup',   onDragUp);
        overlay.remove();
        if (cropRect) onConfirm(compress(img, cropRect.x, cropRect.y, cropRect.w, cropRect.h));
        else          onConfirm(compress(img, 0, 0, img.naturalWidth, img.naturalHeight));
      };
      btnFull.onclick = () => {
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup',   onDragUp);
        overlay.remove();
        onConfirm(compress(img, 0, 0, img.naturalWidth, img.naturalHeight));
      };
      btnCancel.onclick = () => {
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup',   onDragUp);
        overlay.remove();
      };
      overlay.addEventListener('keydown', ev => { if (ev.key === 'Escape') overlay.remove(); });
    };
    img.src = dataUrl;
  }

  /** Insert a (possibly cropped) image into a card's image attachment area */
  function insertFeedbackImage(/** @type {string} */ uid, /** @type {string} */ dataUrl) {
    const imgArea = document.getElementById(`mag-fbimg-${uid}`);
    if (!imgArea) return;

    const wrap = document.createElement('div');
    wrap.className = 'mag-fb-img-wrap';

    const img = document.createElement('img');
    img.className = 'mag-fb-img';
    img.src       = dataUrl;
    img.draggable = false;
    img.onload    = () => { img.style.width = Math.min(400, img.naturalWidth) + 'px'; };

    const toolbar = document.createElement('div');
    toolbar.className = 'mag-fb-img-toolbar';
    toolbar.innerHTML = '<button class="mag-fb-img-btn" title="Re-crop">✂</button>' +
                        '<button class="mag-fb-img-btn" title="Remove">✕</button>';

    const corners = ['nw', 'ne', 'sw', 'se'];
    const handles = corners.map(c => {
      const h = document.createElement('div');
      h.className = 'mag-fb-resize-handle';
      h.dataset.corner = c;
      return h;
    });

    wrap.append(img, toolbar, ...handles);
    imgArea.appendChild(wrap);

    // Hide hint
    const hint = imgArea.querySelector('.mag-fb-paste-hint');
    if (hint) /** @type {HTMLElement} */(hint).style.display = 'none';

    // Re-crop
    /** @type {HTMLButtonElement} */(toolbar.children[0]).onclick = () =>
      showCropModal(img.src, url => { img.src = url; });

    // Delete
    /** @type {HTMLButtonElement} */(toolbar.children[1]).onclick = () => {
      wrap.remove();
      if (!imgArea.querySelector('.mag-fb-img-wrap') && hint)
        /** @type {HTMLElement} */(hint).style.display = '';
    };

    // Resize drag — all four corners
    handles.forEach(h => {
      h.addEventListener('mousedown', ev => {
        ev.preventDefault(); ev.stopPropagation();
        const corner = h.dataset.corner || 'se';
        const x0 = ev.clientX, y0 = ev.clientY;
        const w0 = img.offsetWidth, h0 = img.offsetHeight;
        const aspect = h0 > 0 ? w0 / h0 : 1;
        const onM = (/** @type {MouseEvent} */ e) => {
          const dx = e.clientX - x0, dy = e.clientY - y0;
          // For left-edge corners, dragging left grows the image
          const xDelta = (corner === 'nw' || corner === 'sw') ? -dx : dx;
          // Use whichever delta is larger in magnitude; keep aspect ratio
          const delta = Math.abs(xDelta) >= Math.abs(dy) ? xDelta : (corner === 'nw' || corner === 'ne' ? -dy : dy) * aspect;
          img.style.width = Math.max(60, w0 + delta) + 'px';
        };
        const onU = () => { document.removeEventListener('mousemove', onM); document.removeEventListener('mouseup', onU); };
        document.addEventListener('mousemove', onM);
        document.addEventListener('mouseup',   onU);
      });
    });
  }

  // Global paste listener — intercepts image pastes when focus is inside any MAG card
  document.addEventListener('paste', ev => {
    const items = ev.clipboardData?.items;
    if (!items) return;
    let imgItem = null;
    for (const item of items) { if (item.type.startsWith('image/')) { imgItem = item; break; } }
    if (!imgItem) return;

    const card = /** @type {HTMLElement|null} */(document.activeElement)?.closest?.('[id^="mag-card-"]')
              || /** @type {HTMLElement} */(ev.target)?.closest?.('[id^="mag-card-"]');
    if (!card) return;
    const uid = card.id.replace('mag-card-', '');
    if (!document.getElementById(`mag-fbimg-${uid}`)) return;

    ev.preventDefault();
    const blob = imgItem.getAsFile();
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = e2 => {
      const url = /** @type {string} */(e2.target?.result);
      if (url) showCropModal(url, cropped => insertFeedbackImage(uid, cropped));
    };
    reader.readAsDataURL(blob);
  }, true); // capture phase so it fires even when textarea has focus

  // ── Review panel ─────────────────────────────────────────────────────────
  const reviewOverlay = document.createElement('div');
  reviewOverlay.id = 'mag-review-overlay';
  document.body.appendChild(reviewOverlay);
  // Intentionally no click-outside-to-close — only the ✕ button closes the panel

  // Drag logic for the review box — activated by mousedown on .mag-review-header
  reviewOverlay.addEventListener('mousedown', e => {
    const header = /** @type {HTMLElement} */(e.target).closest('.mag-review-header');
    if (!header) return;
    const box = /** @type {HTMLElement} */ (document.getElementById('mag-review-box'));
    if (!box) return;
    // On first drag, replace transform-centering with explicit coordinates
    if (box.style.transform) {
      const r = box.getBoundingClientRect();
      box.style.transform = 'none';
      box.style.left = r.left + 'px';
      box.style.top  = r.top  + 'px';
    }
    const startX = e.clientX - box.offsetLeft;
    const startY = e.clientY - box.offsetTop;
    header.classList.add('dragging');
    const onMove = (/** @type {MouseEvent} */ ev) => {
      box.style.left = (ev.clientX - startX) + 'px';
      box.style.top  = (ev.clientY - startY) + 'px';
    };
    const onUp = () => {
      header.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function buildStudentCard(student, rubric, result, idx) {
    const card = document.createElement('div');
    card.className = 'mag-student-card';
    card.id = `mag-card-${student.uid}`;

    const statusClass = result ? (result.error ? 'error' : 'done') : 'pending';
    const statusText  = result ? (result.error ? '✗ Error' : result.moodleGraded ? 'Graded in Moodle' : '✓ Graded') : '○ Pending';

    // Scale raw rubric points to the 100-point Moodle grade.
    // Compute rawTotal from individual scores — never trust the AI's totalPoints field.
    const maxRaw    = (rubric || []).reduce((/** @type {number} */ s, /** @type {any} */ c) =>
      s + Math.max(0, ...(c.levels || []).map((/** @type {any} */ l) => l.points)), 0);
    const rawTotal  = result && !result.error
      ? (result.scores || []).reduce((/** @type {number} */ s, /** @type {any} */ sc) => s + (sc.pointsAwarded || 0), 0)
      : 0;
    const scaled100 = maxRaw > 0 ? Math.round((rawTotal / maxRaw) * 100) : rawTotal;

    const scoresTable = !result
      ? '<div style="color:#9070c0;font-size:12px">Waiting to be graded…</div>'
      : result.error
        ? `<div style="color:#ff7070;font-size:12px">⚠ ${result.error}</div>`
        : result.moodleGraded
          ? `<div style="padding:8px 0"><button class="mag-regrade-btn" id="mag-regrade-${student.uid}">Regrade submission?</button></div>`
          : `
      <table class="mag-scores-table">
        <thead><tr><th>Criterion</th><th>Score</th><th>Justification</th></tr></thead>
        <tbody>
          ${(result.scores || []).map((/** @type {any} */ s, /** @type {number} */ i) => {
            const crit = rubric[s.criterionIndex] || rubric[i] || {};
            const maxCritPts = Math.max(0, ...(crit.levels || []).map((/** @type {any} */ l) => l.points));
            const isDeducted = s.pointsAwarded < maxCritPts;
            const opts = (crit.levels || []).map(l =>
              `<option value="${l.points}" ${l.points === s.pointsAwarded ? 'selected' : ''}>${l.points} pts — ${l.description.slice(0, 40)}…</option>`
            ).join('');
            return `<tr>
              <td>${crit.name || 'Criterion ' + i}</td>
              <td id="mag-score-cell-${student.uid}-${i}" ${isDeducted ? 'class="mag-score-deducted"' : ''}><select data-uid="${student.uid}" data-crit="${i}">${opts}</select></td>
              <td><textarea class="mag-justif-ta" id="mag-just-${student.uid}-${i}">${s.justification || ''}</textarea></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div class="mag-overall-comment">${result.overallComment || ''}</div>
    `;

    const rawFb = result && !result.error && !result.moodleGraded ? (result.feedback || '') : '';
    const fbHtml = rawFb.trimStart().startsWith('<')
      ? rawFb
      : rawFb ? '<p>' + rawFb.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>' : '';
    const feedbackArea = result && !result.error && !result.moodleGraded
      ? `<div class="mag-feedback-label">Instructor feedback (editable before posting):</div>
         <div class="mag-fb-toolbar">
           <button class="mag-fb-fmt-btn" data-cmd="bold"      title="Bold (Ctrl+B)"><b>B</b></button>
           <button class="mag-fb-fmt-btn" data-cmd="italic"    title="Italic (Ctrl+I)"><em>I</em></button>
           <button class="mag-fb-fmt-btn" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
         </div>
         <div class="mag-feedback-area" id="mag-fb-${student.uid}" contenteditable="true">${fbHtml}</div>
         <div class="mag-fb-img-area" id="mag-fbimg-${student.uid}">
           <span class="mag-fb-paste-hint">📎 Paste a screenshot here (Ctrl+V)</span>
         </div>`
      : '';

    card.innerHTML = `
      <div class="mag-card-header">
        <span class="mag-card-name">${student.name}</span>
        ${result && !result.error && !result.moodleGraded ? `<span class="mag-card-total" id="mag-total-${student.uid}">${scaled100} / 100</span>` : ''}
        <span class="mag-card-status ${statusClass}" id="mag-status-${student.uid}">${statusText}</span>
      </div>
      <div class="mag-card-body" id="mag-body-${student.uid}">
        ${scoresTable}
        ${feedbackArea}
        ${result && !result.error && !result.moodleGraded ? `
          <div class="mag-card-actions">
            <div id="mag-post-wrap-${student.uid}" style="display:flex;gap:8px;align-items:center">
              <button class="mag-post-btn" id="mag-post-${student.uid}">${CFG.postRemarks ? 'Post Grade, Feedback & Remarks' : 'Post Grade & Feedback'}</button>
              <button class="mag-skip-btn" id="mag-skip-${student.uid}">Skip</button>
            </div>
            <div class="mag-post-progress" id="mag-postprog-${student.uid}">
              <div class="mag-progress-track">
                <div class="mag-progress-fill" id="mag-progfill-${student.uid}"></div>
              </div>
              <div class="mag-post-result-row" id="mag-result-row-${student.uid}">
                <button class="mag-done-btn" id="mag-done-${student.uid}">Done (<span id="mag-donetimer-${student.uid}">5</span>s)</button>
                <button class="mag-stay-btn" id="mag-stay-${student.uid}">Save &amp; Stay</button>
                <button class="mag-move-btn" id="mag-move-${student.uid}">Save &amp; Move ▸</button>
              </div>
            </div>
          </div>` : ''}
      </div>
    `;
    return card;
  }

  function wireCardButtons(student, rubric, result, assignmentId) {
    // Wire "Regrade submission?" button (shown when student was already graded in Moodle)
    const regradeBtn = /** @type {HTMLButtonElement|null} */(document.getElementById(`mag-regrade-${student.uid}`));
    if (regradeBtn) {
      regradeBtn.onclick = () => {
        if (activeGradeCurrentFn) activeGradeCurrentFn().catch(e => setStatus('⚠ ' + e.message, '#ff9060'));
      };
    }

    const postBtn = /** @type {HTMLButtonElement|null} */(document.getElementById(`mag-post-${student.uid}`));
    const skipBtn = document.getElementById(`mag-skip-${student.uid}`);
    if (!postBtn) return;

    // Wire formatting toolbar buttons + keyboard shortcuts on the contenteditable feedback div
    const fbDiv = document.getElementById(`mag-fb-${student.uid}`);
    if (fbDiv) {
      // Toolbar buttons
      const toolbar = fbDiv.previousElementSibling;
      if (toolbar && toolbar.classList.contains('mag-fb-toolbar')) {
        for (const btn of /** @type {NodeListOf<HTMLButtonElement>} */(toolbar.querySelectorAll('.mag-fb-fmt-btn'))) {
          btn.addEventListener('mousedown', ev => {
            ev.preventDefault(); // keep focus in fbDiv
            document.execCommand(btn.dataset.cmd || '');
          });
        }
      }
      // Keyboard shortcuts
      fbDiv.addEventListener('keydown', ev => {
        if (!ev.ctrlKey && !ev.metaKey) return;
        const map = /** @type {Record<string,string>} */({ b: 'bold', i: 'italic', u: 'underline' });
        const cmd = map[ev.key.toLowerCase()];
        if (cmd) { ev.preventDefault(); document.execCommand(cmd); }
      });
    }

    // Wire score-select changes to update the scaled total in real time
    const totalSpan    = document.getElementById(`mag-total-${student.uid}`);
    const scoreSelects = /** @type {NodeListOf<HTMLSelectElement>} */(
      document.querySelectorAll(`select[data-uid="${student.uid}"]`)
    );
    const maxRaw = (rubric || []).reduce((/** @type {number} */ s, /** @type {any} */ c) =>
      s + Math.max(0, ...(c.levels || []).map((/** @type {any} */ l) => l.points)), 0);
    if (totalSpan && scoreSelects.length) {
      const recalcTotal = () => {
        const sum = [...scoreSelects].reduce((s, sel) => s + (parseFloat(sel.value) || 0), 0);
        totalSpan.textContent = `${maxRaw > 0 ? Math.round((sum / maxRaw) * 100) : sum} / 100`;
      };
      for (const sel of scoreSelects) {
        sel.addEventListener('change', recalcTotal);
        // Update justification textarea when score changes
        sel.addEventListener('change', () => {
          const ci  = parseInt(/** @type {HTMLSelectElement} */(sel).dataset.crit || '0');
          const crit = (rubric || [])[ci];
          const justEl = /** @type {HTMLTextAreaElement|null} */(document.getElementById(`mag-just-${student.uid}-${ci}`));
          if (!justEl || !crit) return;
          const newPts   = parseFloat(/** @type {HTMLSelectElement} */(sel).value);
          const origScore = (result?.scores || [])[ci];
          if (origScore && newPts === origScore.pointsAwarded) {
            justEl.value = origScore.justification || '';
          } else {
            const lvl = (crit.levels || []).find((/** @type {any} */ l) => l.points === newPts);
            justEl.value = lvl ? lvl.description : '';
          }
          const maxCritPts = Math.max(0, ...(crit.levels || []).map((/** @type {any} */ l) => l.points));
          const scoreCell = document.getElementById(`mag-score-cell-${student.uid}-${ci}`);
          if (scoreCell) scoreCell.classList.toggle('mag-score-deducted', newPts < maxCritPts);
        });
      }
    }

    let regradeConfirmed = false;
    postBtn.onclick = async () => {
      // Re-grade protection: warn if Moodle already has rubric levels set (skip in auto-grade modes)
      if (!isAutoGrading()) {
        const moodleAlreadyGraded = !!document.querySelector(
          '.level.checked, .level[aria-checked="true"], td.level[data-checked="1"], ' +
          '.advancedgrading .checked, [id*="rubric"] .checked'
        );
        if (moodleAlreadyGraded && !regradeConfirmed) {
          regradeConfirmed = true;
          postBtn.disabled = false;
          const origLabel = postBtn.textContent || '';
          postBtn.textContent = '⚠ Already graded — click again to overwrite';
          postBtn.style.background = '#8a2010';
          setTimeout(() => {
            if (regradeConfirmed) {
              regradeConfirmed = false;
              postBtn.textContent = origLabel;
              postBtn.style.background = '';
            }
          }, 5000);
          return;
        }
        regradeConfirmed = false;
      }

      postBtn.disabled = true;
      postBtn.textContent = 'Posting…';

      // Show progress bar, hide the button row
      const postWrap     = document.getElementById(`mag-post-wrap-${student.uid}`);
      const progContainer = document.getElementById(`mag-postprog-${student.uid}`);
      const progFill     = document.getElementById(`mag-progfill-${student.uid}`);
      const doneBtn      = /** @type {HTMLButtonElement|null} */(document.getElementById(`mag-done-${student.uid}`));
      if (postWrap)     postWrap.style.display     = 'none';
      if (progContainer) progContainer.style.display = 'block';
      // Animate fill to ~80% immediately (fake progress — snaps fast, slows near end)
      if (progFill) requestAnimationFrame(() => { if (progFill) progFill.style.width = '80%'; });

      try {
        // Collect edited scores from selects
        const scoreSelects = document.querySelectorAll(`select[data-uid="${student.uid}"]`);
        const editedScores = (result.scores || []).map((/** @type {any} */ s, /** @type {number} */ i) => {
          const sel     = scoreSelects[i];
          const justEl  = /** @type {HTMLTextAreaElement|null} */(document.getElementById(`mag-just-${student.uid}-${i}`));
          return {
            ...s,
            pointsAwarded: sel ? parseFloat(sel.value) : s.pointsAwarded,
            justification: justEl?.value ?? s.justification,
          };
        });
        const fbEl = document.getElementById(`mag-fb-${student.uid}`);
        // Read innerHTML from the contenteditable div (null → element not in DOM, fall back to AI result).
        const rawText = fbEl !== null ? fbEl.innerHTML : (result.feedback || '');
        const imgEls  = /** @type {NodeListOf<HTMLImageElement>} */(
          document.querySelectorAll(`#mag-fbimg-${student.uid} img.mag-fb-img`)
        );
        let editedFeedback;
        if (imgEls.length > 0) {
          const textHtml = rawText
            ? '<p>' + rawText.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>'
            : '';
          const imgHtml  = Array.from(imgEls).map(im =>
            `<p><img src="${im.src}" style="max-width:${im.style.width||'400px'};height:auto"></p>`
          ).join('');
          editedFeedback = textHtml + imgHtml;
        } else {
          editedFeedback = rawText;
        }
        const editedResult   = { ...result, scores: editedScores, feedback: editedFeedback };

        await postGrade(student, rubric, editedResult, assignmentId);

        // Complete the bar
        if (progFill) { progFill.classList.add('mag-complete'); progFill.style.width = '100%'; }
        setStatus('Grade posted ✓', '#40c080');
        document.getElementById(`mag-status-${student.uid}`).textContent = '✓ Posted';
        document.getElementById(`mag-status-${student.uid}`).className   = 'mag-card-status done';
        document.getElementById(`mag-card-${student.uid}`).style.opacity = '0.7';
        applyResultToLiveDom(rubric, editedResult);

        // Auto-grade modes: navigate without showing interaction buttons
        if (isAutoGrading()) {
          const sn = /** @type {HTMLElement|null} */(document.querySelector(
            'button[name="saveandshownext"], input[name="saveandshownext"], ' +
            '[data-action="save-and-next"], [data-action="save-and-show-next"], ' +
            'button[name="saveandnext"], input[name="saveandnext"]'
          ));
          if (sn) { sn.click(); return; }
          const mn = /** @type {HTMLElement|null} */(document.querySelector('[data-action="next-user"], [data-action="nextuser"]'));
          if (mn) mn.click();
          return;
        }

        // Show Done / Stay / Move row after successful post
        const resultRow = /** @type {HTMLElement|null} */(document.getElementById(`mag-result-row-${student.uid}`));
        const stayBtn   = /** @type {HTMLButtonElement|null} */(document.getElementById(`mag-stay-${student.uid}`));
        const moveBtn   = /** @type {HTMLButtonElement|null} */(document.getElementById(`mag-move-${student.uid}`));
        if (resultRow && doneBtn) {
          resultRow.style.display = 'flex';
          doneBtn.focus();
          const timerEl = document.getElementById(`mag-donetimer-${student.uid}`);
          let countdown = 5;
          let timerCancelled = false;

          const cancelTimer = () => {
            if (timerCancelled) return;
            timerCancelled = true;
            clearInterval(tick);
            document.removeEventListener('keydown', keyHandler);
          };

          const dismiss = () => {
            cancelTimer();
            reviewOverlay.classList.remove('open');
          };

          const tick = setInterval(() => {
            countdown--;
            if (timerEl) timerEl.textContent = String(countdown);
            if (countdown <= 0) dismiss();
          }, 1000);

          const keyHandler = (/** @type {KeyboardEvent} */ e) => {
            const tag = /** @type {Element} */(document.activeElement)?.tagName;
            if (tag === 'TEXTAREA' || tag === 'INPUT') return;
            if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); dismiss(); }
          };
          document.addEventListener('keydown', keyHandler);
          doneBtn.onclick = dismiss;

          if (stayBtn) stayBtn.onclick = () => {
            cancelTimer();
            // Click Moodle's own "Save changes" button — re-submits the live form (which
            // applyResultToLiveDom already filled), clears the "dirty" flag, and stays on
            // this student without navigation. Same logic as Save & Move / saveandshownext.
            const saveChangesBtn = /** @type {HTMLElement|null} */(document.querySelector(
              'button[name="savechanges"]'
            ));
            if (saveChangesBtn) saveChangesBtn.click();
            // Transform Done into a plain close button (timer is gone)
            if (doneBtn) { doneBtn.textContent = 'Done ✓'; doneBtn.onclick = () => reviewOverlay.classList.remove('open'); }
          };

          if (moveBtn) moveBtn.onclick = () => {
            cancelTimer();
            // Prefer Moodle's own "Save and show next" button: it submits the grading form
            // and navigates in one step, clearing the "dirty" flag set by applyResultToLiveDom
            // and bypassing the unsaved-changes confirmation dialog.
            const saveAndNext = /** @type {HTMLElement|null} */(document.querySelector(
              'button[name="saveandshownext"], input[name="saveandshownext"], ' +
              '[data-action="save-and-next"], [data-action="save-and-show-next"], ' +
              'button[name="saveandnext"], input[name="saveandnext"]'
            ));
            if (saveAndNext) {
              saveAndNext.click();
            } else {
              // Fallback: plain next-user click (may still trigger Moodle's dialog)
              const mNext = /** @type {HTMLElement|null} */(document.querySelector(
                '[data-action="next-user"], [data-action="nextuser"]'
              ));
              if (mNext) mNext.click();
            }
          };
        }
      } catch (err) {
        // Restore buttons on error
        if (progFill) { progFill.style.width = '0'; progFill.classList.remove('mag-complete'); }
        if (progContainer) progContainer.style.display = 'none';
        if (postWrap)  postWrap.style.display = 'flex';
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
      // Click Moodle's own next-user button; the nav watcher handles card + grading
      const mNext = /** @type {HTMLElement|null} */(document.querySelector(
        '[data-action="next-user"], [data-action="nextuser"]'
      ));
      if (mNext) mNext.click();
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
        <button class="mag-btn" id="mag-review-minimize" style="padding:3px 9px" title="Minimize">−</button>
        <button class="mag-btn" id="mag-review-close" style="padding:3px 10px" title="Close">✕</button>
      </div>
      <div class="mag-review-body" id="mag-review-cards"></div>
      <div class="mag-review-footer">
        <span class="mag-progress-text" id="mag-review-progress">
          ${doneCount} / ${students.length} graded
        </span>
        <label class="mag-remarks-label" title="When posting a grade, also write the AI justification into the remark box at the end of each rubric row">
          <input type="checkbox" id="mag-remarks-toggle" ${CFG.postRemarks ? 'checked' : ''}>
          Post remarks
        </label>
        <label class="mag-remarks-label" title="Only post remarks for rubric criteria where marks were deducted (student did not earn full points)">
          <input type="checkbox" id="mag-remarks-deducted-toggle" ${CFG.postRemarksDeductedOnly ? 'checked' : ''}>
          Deductions only
        </label>
        <span id="mag-nav-slot" style="display:inline-flex;gap:6px"></span>
        <button class="mag-btn" id="mag-plag-btn" disabled title="Compare all graded submissions for similarity (0 API calls)">🔍 Plagiarism</button>
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

    const deductedToggle = /** @type {HTMLInputElement|null} */(document.getElementById('mag-remarks-deducted-toggle'));
    const remarksToggle  = /** @type {HTMLInputElement|null} */(document.getElementById('mag-remarks-toggle'));

    // Apply / remove visual greyed-out class on the deductions label
    const setDeductedEnabled = (/** @type {boolean} */ enabled) => {
      if (!deductedToggle) return;
      deductedToggle.disabled = !enabled;
      const label = deductedToggle.closest('label');
      if (label) label.classList.toggle('mag-disabled', !enabled);
    };

    // Deductions-only is a subset of remarks — keep it disabled when remarks is off
    setDeductedEnabled(CFG.postRemarks);

    if (remarksToggle) {
      remarksToggle.onchange = () => {
        const on = remarksToggle.checked;
        set('post_remarks', on ? 'true' : 'false');
        setDeductedEnabled(on);
        if (!on && deductedToggle) { deductedToggle.checked = false; set('post_remarks_deducted_only', 'false'); }
        // Refresh all un-posted post buttons to reflect new label
        for (const btn of /** @type {NodeListOf<HTMLButtonElement>} */(document.querySelectorAll('.mag-post-btn'))) {
          if (btn.textContent === 'Post Grade & Feedback' || btn.textContent === 'Post Grade, Feedback & Remarks') {
            btn.textContent = on ? 'Post Grade, Feedback & Remarks' : 'Post Grade & Feedback';
          }
        }
      };
    }

    if (deductedToggle) {
      deductedToggle.onchange = () => set('post_remarks_deducted_only', deductedToggle.checked ? 'true' : 'false');
    }

    document.getElementById('mag-review-minimize').onclick = () => {
      const box = document.getElementById('mag-review-box');
      const btn = /** @type {HTMLButtonElement} */ (document.getElementById('mag-review-minimize'));
      if (!box || !btn) return;
      const isMin = box.classList.toggle('minimized');
      btn.textContent = isMin ? '+' : '−';
      btn.title       = isMin ? 'Restore' : 'Minimize';
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
    if (!CFG.aiKey) {
      openSettings();
      throw new Error('Please configure a Gemini, HuggingFace, or OpenRouter API key in Settings first.');
    }
  }

  // ── Orchestrators ─────────────────────────────────────────────────────────
  async function runGradeOne() {
    try {
      assertKeys();
    } catch (e) { setStatus('⚠ ' + e.message, '#ff9060'); return; }

    setStatus('Reading assignment…', '#c9a0ff');
    const { title, instructions } = await fetchAssignmentDetails();

    // On the AMD grader (?action=grader) select#change-user-select may only hold the
    // currently-displayed student as its single option — Moodle populates it lazily.
    // We therefore cannot rely on parseStudentList() to return the full class list.
    // Instead, read the UID from the dropdown, fetch the traditional grade page for
    // that student (same request we need for the rubric), and parse the full
    // select[name="userid"] that Moodle always embeds there.
    const graderSel = /** @type {HTMLSelectElement|null} */(
      document.querySelector('select#change-user-select, select[data-action="change-user"]')
    );
    const currentUid = graderSel?.value?.trim() || '';

    // Start with whatever the live DOM gives us (may be only 1 student on AMD grader)
    /** @type {any[]} */ let students = parseStudentList();

    // If the live DOM didn't find the current student, add a stub so we can proceed
    if (currentUid && !students.find(s => s.uid === currentUid)) {
      students.unshift({
        uid: currentUid, name: `Student ${currentUid}`,
        gradeLink: `${location.origin}/mod/assign/view.php?id=${assignId}&userid=${currentUid}&action=grade`,
        fileLinks: [], onlineText: null,
      });
    }

    if (!students.length) {
      setStatus('No student found — make sure a student is selected in the grader.', '#ff9060');
      return;
    }

    // startIdx: prefer the student matching the AMD dropdown selection
    let startIdx = 0;
    if (currentUid) {
      const i = students.findIndex(s => s.uid === currentUid);
      if (i >= 0) startIdx = i;
    }

    setStatus('Loading rubric and student list…', '#c9a0ff');
    /** @type {any[]} */ let rubric = [];
    try {
      // Fetch the traditional grade page: gives us the rubric AND a full student list
      // via select[name="userid"]. One XHR does both jobs.
      const startUid   = students[startIdx]?.uid || currentUid;
      const gradeUrl   = `${location.origin}/mod/assign/view.php?id=${assignId}&userid=${startUid}&action=grade`;
      const gradeResp  = await xhr('GET', gradeUrl);
      const gradeDoc   = new DOMParser().parseFromString(gradeResp.responseText, 'text/html');
      rubric           = parseRubric(gradeDoc);

      // Bootstrap the full student list from the grade page when the AMD dropdown
      // only gave us a stub.
      const fullList = parseStudentList(gradeDoc);
      if (fullList.length > students.length) {
        students = fullList;
        const ni = students.findIndex(s => s.uid === startUid);
        if (ni >= 0) startIdx = ni;
      }
    } catch (e) { setStatus('Could not load rubric: ' + e.message, '#ff9060'); }

    // Open panel showing one student at a time, beginning from the selected student
    let currentIdx = startIdx;
    /** @type {Record<string,any>} */ const results = {};
    const panel    = openReviewPanel(title, [students[startIdx]], rubric, {});

    activeGradeCurrentFn = null; // clear any stale reference first
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
        // Always fetch the grade page: resolves real name + provides the full file list.
        // The grade page is authoritative — it shows every separately submitted file.
        // The list-page snapshot may show only some (e.g. just the zip when the student
        // also uploaded loose files alongside it).
        const fetched = await fetchStudentFiles(student);
        if (fetched.fileLinks.length) {
          // Start with grade-page links; append any list-page links not already present
          const seen = new Set(fetched.fileLinks.map(f => f.url));
          fileLinks = [...fetched.fileLinks, ...fileLinks.filter(f => !seen.has(f.url))];
        }
        if (!submissionText && fetched.onlineText) submissionText = fetched.onlineText;
        if (fetched.realName && student.name.startsWith('Student ')) {
          student.name = fetched.realName;
          const nameEl = document.querySelector(`#mag-card-${student.uid} .mag-card-name`);
          if (nameEl) nameEl.textContent = student.name;
          setStatus(`Grading ${currentIdx + 1}/${students.length}: ${student.name}…`, '#c9a0ff');
        }
        // Flat list of all filenames submitted — outer files plus inner zip entries.
        // Used to build an accurate manifest in the AI prompt so it never falsely reports
        // a file as missing when the student did submit it.
        const submittedFiles = [];
        if (fileLinks.length) {
          const parts = [];
          for (const file of fileLinks) {
            setStatus(`Reading ${file.filename}…`, '#c9a0ff');
            try {
              const extracted = await extractSubmission(file.url, file.filename);
              if (extracted.text) parts.push(`\n\n=== SUBMITTED: ${file.filename} ===\n${extracted.text}`);
              if (extracted.inlineData && !inlineData) inlineData = extracted.inlineData;
              // For zip files, list the inner entries; for everything else, the outer filename
              const names = extracted.innerFilenames?.length ? extracted.innerFilenames : [file.filename];
              submittedFiles.push(...names);
            } catch (fileErr) {
              console.warn(`[MAG] Could not read ${file.filename}:`, /** @type {any} */(fileErr).message);
              submittedFiles.push(file.filename); // still submitted even if unreadable
            }
          }
          if (parts.length) {
            submissionText = parts.join('').trim();
          } else if (!submissionText) {
            throw new Error(`Could not read any submitted files for ${student.name}. The files may be corrupted or in an unsupported format.`);
          }
        }
        const result = await gradeSubmission(title, instructions, rubric, submissionText, inlineData, submittedFiles);
        results[student.uid] = result;
        /** @type {any} */(result)._extractedText = submissionText; // retain for per-session use
        plagiarismCache[student.uid] = { name: student.name, extractedText: submissionText };
        _savePlagCache();
        panel.updateCard(student, result);
        // Enable plagiarism button once ≥ 2 submissions cached (persists across panel sessions)
        {
          const pb2 = /** @type {HTMLButtonElement|null} */(document.getElementById('mag-plag-btn'));
          if (pb2) pb2.disabled = Object.keys(plagiarismCache).length < 2;
        }
        if (isAutoGrading()) {
          if (gradeNRemaining > 0) gradeNRemaining--;
          setStatus(`${student.name} graded — auto-posting…`, '#c9a0ff');
          await sleep(300);
          const pb = /** @type {HTMLButtonElement|null} */(document.getElementById(`mag-post-${student.uid}`));
          if (pb && !pb.disabled) pb.click();
        } else {
          setStatus(`${student.name} graded. Review and post, then click Next.`, '#c9a0ff');
        }
      } catch (err) {
        results[student.uid] = { error: err.message };
        panel.updateCard(student, { error: err.message });
        setStatus(`Error grading ${student.name}: ${err.message}`, '#ff9060');
      }
    };
    activeGradeCurrentFn = gradeCurrentStudent; // expose so the toolbar button can re-trigger

    // ── Navigation helpers ────────────────────────────────────────────────────

    // Read which student Moodle's AMD grader currently has loaded.
    const getMoodleUid = () =>
      /** @type {HTMLSelectElement|null} */(
        document.querySelector('select#change-user-select, select[data-action="change-user"]')
      )?.value?.trim() || '';

    // Find or lazily create a student object for a UID from Moodle's dropdown.
    const getOrCreateStudent = (/** @type {string} */ uid) => {
      let s = students.find(st => st.uid === uid);
      if (!s) {
        const sel = /** @type {HTMLSelectElement|null} */(document.querySelector('select#change-user-select'));
        // Try exact CSS attr selector first; fall back to iterating (handles option values
        // with leading/trailing whitespace that AMD sometimes produces), then fall back to
        // whichever option is currently selected (safe since newUid came from sel.value.trim()).
        const opt = sel?.querySelector(`option[value="${uid}"]`)
                 || (sel ? [...sel.options].find(o => o.value.trim() === uid) : null)
                 || (sel?.value?.trim() === uid ? (sel.selectedOptions?.[0] ?? null) : null);
        const name = opt?.textContent?.trim().replace(/\s*\(\d+\s+of\s+\d+[^)]*\)\s*$/, '').trim()
                  || `Student ${uid}`;
        s = { uid, name, gradeLink: `${location.origin}/mod/assign/view.php?id=${assignId}&userid=${uid}&action=grade`, fileLinks: [], onlineText: null };
        students.push(s);
      }
      return s;
    };

    // ── Navigation buttons ────────────────────────────────────────────────────
    const navSlot = document.getElementById('mag-nav-slot');
    /** @type {Set<string>} */ const addedUids = new Set([students[startIdx]?.uid].filter(Boolean));

    const prevBtn = document.createElement('button');
    prevBtn.id        = 'mag-prev-btn';
    prevBtn.className = 'mag-btn';
    prevBtn.textContent = '◂ Prev';

    const nextBtn = document.createElement('button');
    nextBtn.id        = 'mag-next-btn';
    nextBtn.className = 'mag-btn';
    nextBtn.textContent = 'Next Student ▸';

    // MAG Prev/Next are transparent pass-throughs to Moodle's own navigation buttons.
    // The watcher below picks up the navigation event and handles everything from there.
    prevBtn.onclick = () => {
      const m = /** @type {HTMLElement|null} */(document.querySelector(
        '[data-action="previous-user"], [data-action="previoususer"]'
      ));
      if (m) m.click();
    };

    nextBtn.onclick = () => {
      const m = /** @type {HTMLElement|null} */(document.querySelector(
        '[data-action="next-user"], [data-action="nextuser"]'
      ));
      if (m) m.click();
    };

    if (navSlot) {
      navSlot.appendChild(prevBtn);
      navSlot.appendChild(nextBtn);
      if (isAutoGrading()) {
        const stopBtn = document.createElement('button');
        stopBtn.className = 'mag-btn';
        stopBtn.style.cssText = 'background:#6a1010;border-color:#a03030;margin-left:4px';
        stopBtn.textContent = '⬛ Stop Auto';
        stopBtn.onclick = () => {
          gradeAllActive = false;
          gradeNRemaining = 0;
          stopBtn.remove();
          setStatus('Auto-grading stopped.', '#9070c0');
        };
        navSlot.appendChild(stopBtn);
      }
    }

    // Wire plagiarism check button (rendered in review panel footer)
    const plagBtnEl = /** @type {HTMLButtonElement|null} */(document.getElementById('mag-plag-btn'));
    if (plagBtnEl) {
      plagBtnEl.onclick = () => openPlagiarismPanel(plagiarismCache);
      // Restore enabled state from cache accumulated across prior panel sessions
      plagBtnEl.disabled = Object.keys(plagiarismCache).length < 2;
    }

    // ── Real-time Moodle navigation watcher ───────────────────────────────────
    // Polls the AMD dropdown every 250 ms. Any change in value (from MAG buttons,
    // Moodle's own buttons, or the dropdown itself) triggers onMoodleNavigated.
    // This is the single source of truth for student context switching.

    // Intentionally NOT pre-seeded: leaving this empty means the navWatcher fires
    // onMoodleNavigated for the initial student too, giving it the same Moodle-graded
    // check as every subsequent navigation. Pre-seeding it to getMoodleUid() would
    // skip the initial student's check and call gradeCurrentStudent() blindly.
    let lastWatchedUid = '';
    let navBusy        = false;

    // Reflect Prev/Next button states from the dropdown's current position.
    // Conservative: if the dropdown has ≤1 option AMD hasn't fully loaded yet — skip update.
    // Only marks "All done" when we're provably at the last entry in a populated list.
    const refreshNavBtnStates = (/** @type {string} */ uid) => {
      const selEl = /** @type {HTMLSelectElement|null} */(document.querySelector('select#change-user-select'));
      if (!selEl || selEl.options.length <= 1) return; // AMD not loaded yet
      const opts = Array.from(selEl.options).filter(o => /^\d+$/.test(o.value?.trim() || ''));
      if (opts.length <= 1) return; // same check after filtering
      const pos  = opts.findIndex(o => o.value.trim() === uid);
      if (pos < 0) return; // uid not in list yet — don't touch buttons
      prevBtn.disabled = pos === 0;
      const atEnd = pos >= opts.length - 1;
      nextBtn.disabled = atEnd;
      nextBtn.textContent = atEnd ? 'All done ✓' : 'Next Student ▸';
    };

    const onMoodleNavigated = async (/** @type {string} */ newUid) => {
      const student = getOrCreateStudent(newUid);
      currentIdx    = students.indexOf(student);
      addedUids.add(newUid);

      // Replace the panel with ONLY this student's card (single-student focus).
      // Any existing result is shown immediately if we've already graded them.
      const cardsEl = document.getElementById('mag-review-cards');
      if (cardsEl) {
        cardsEl.innerHTML = '';
        const existingResult = results[newUid] || null;
        const card = buildStudentCard(student, /** @type {any[]} */(rubric), existingResult, currentIdx);
        cardsEl.appendChild(card);
        wireCardButtons(student, rubric, existingResult, assignId);
      }
      refreshNavBtnStates(newUid);

      // Helper: navigate to next student (used by Grade All skip logic)
      const autoAdvance = async () => {
        await sleep(600);
        const sn = /** @type {HTMLElement|null} */(document.querySelector(
          'button[name="saveandshownext"], input[name="saveandshownext"], ' +
          '[data-action="save-and-next"], [data-action="save-and-show-next"], ' +
          'button[name="saveandnext"], input[name="saveandnext"]'
        ));
        if (sn) { sn.click(); return; }
        const mn = /** @type {HTMLElement|null} */(document.querySelector('[data-action="next-user"], [data-action="nextuser"]'));
        if (mn) mn.click();
      };


      // If already seen this session (graded by MAG or previously detected as Moodle-graded):
      // never re-grade. Grade All also skips automatically.
      if (results[newUid] && !results[newUid].error) {
        const isMoodleGraded = !!results[newUid].moodleGraded;
        setStatus(
          `${student.name} — ${isMoodleGraded ? 'rubric already set in Moodle' : 'already graded'}.` +
          (isAutoGrading() ? ' Skipping…' : isMoodleGraded ? '' : " Post, or click 'Grade submission' to re-grade."),
          '#9070c0'
        );
        // Status chip and regrade button are rendered correctly by buildStudentCard for moodleGraded.
        if (isAutoGrading()) await autoAdvance();
        return;
      }

      // Determine graded state by fetching the student's grade page from the server.
      // Live-DOM approaches (MutationObserver, polling) are unreliable here: AMD swaps
      // the entire panel element when navigating between students, so any observer watching
      // the old element becomes detached, and any synchronous DOM check reads the previous
      // student's stale .checked state. The server-rendered grade page always reflects the
      // true grade state with no race conditions.
      // This XHR also resolves the student's real name, replacing the separate name-resolution
      // call that was previously done after detection.
      let gradedInMoodle = false;
      try {
        const fetched = await fetchStudentFiles(student);
        // Abort if Moodle navigated to a different student while the XHR was in-flight.
        const midUid = getMoodleUid();
        if (midUid && midUid !== newUid) { lastWatchedUid = ''; return; }
        gradedInMoodle = fetched.isGraded;
        // Update name now so the card built below is correct immediately.
        if (fetched.realName && student.name !== fetched.realName) {
          student.name = fetched.realName;
          const nameEl = document.querySelector(`#mag-card-${newUid} .mag-card-name`);
          if (nameEl) nameEl.textContent = fetched.realName;
        }
      } catch (_e) {
        // XHR failed — treat as ungraded so grading can still proceed.
        gradedInMoodle = false;
      }

      if (gradedInMoodle) {
        if (!results[newUid]) results[newUid] = { moodleGraded: true };
        setStatus(`${student.name} — rubric already set in Moodle.${isAutoGrading() ? ' Skipping…' : ''}`, '#9070c0');
        panel.updateCard(student, { moodleGraded: true });
        if (isAutoGrading()) await autoAdvance();
      } else {
        // Not graded anywhere yet — auto-grade now
        await gradeCurrentStudent();
      }
    };

    // AMD may not have populated the dropdown yet at this point — don't read button states now.
    // Defer: try after 1.5 s once AMD has had time to populate the full student list.
    setTimeout(() => refreshNavBtnStates(getMoodleUid()), 1500);

    // Core navigation detector. Checks three signals:
    //   1. select#change-user-select value (primary — AMD updates this on navigation)
    //   2. URL userid param (fallback — Moodle pushState before AMD updates select)
    // De-bounced by navBusy to prevent concurrent onMoodleNavigated calls.
    const detectNav = () => {
      if (!reviewOverlay.classList.contains('open')) return;
      if (navBusy) return;

      // Signal 1: select value
      let uid = getMoodleUid();

      // Signal 2: URL userid param (fallback when select is empty or unchanged)
      if (!uid || uid === lastWatchedUid) {
        const urlUid = new URL(location.href).searchParams.get('userid') || '';
        if (urlUid && urlUid !== lastWatchedUid) uid = urlUid;
      }

      if (uid && uid !== lastWatchedUid) {
        lastWatchedUid = uid;
        navBusy = true;
        onMoodleNavigated(uid)
          .catch(err => console.error('[MAG] nav error:', err))
          .finally(() => { navBusy = false; });
      }
    };

    // Poll every 250 ms — catches any navigation Moodle performs
    const navWatcher = setInterval(() => {
      if (!reviewOverlay.classList.contains('open')) { clearInterval(navWatcher); activeGradeCurrentFn = null; gradeAllActive = false; gradeNRemaining = 0; return; }
      detectNav();
    }, 250);

    // Also react immediately when Moodle's AMD module updates the select value
    const magSelEl = /** @type {HTMLSelectElement|null} */(document.querySelector('select#change-user-select'));
    if (magSelEl) magSelEl.addEventListener('change', detectNav);
    // No explicit gradeCurrentStudent() call here. The navWatcher fires within 250 ms
    // and calls onMoodleNavigated for the initial student, which runs the Moodle-graded
    // check first — showing the regrade button if already graded, or grading only if not.
  }

  // ── Button wiring ─────────────────────────────────────────────────────────
  // Holds the gradeCurrentStudent fn of the active session so the toolbar button
  // can re-trigger grading for the currently focused student without opening a new panel.
  let activeGradeCurrentFn = /** @type {(()=>Promise<void>)|null} */ (null);
  let gradeAllActive  = false; // set true by "Grade All" — triggers auto-post and auto-advance
  let gradeNRemaining = 0;    // set to N by "Grade N" — decrements after each auto-post; stops at 0
  const isAutoGrading = () => gradeAllActive || gradeNRemaining > 0;

  // Plagiarism cache persists across panel close/reopen AND page refreshes (same tab).
  // Keyed by assignment id param so different assignments don't bleed into each other.
  const _plagCacheKey = `mag_plag_${new URLSearchParams(location.search).get('id') || 'x'}`;
  /** @type {Record<string,{name:string,extractedText:string}>} */
  const plagiarismCache = (() => {
    try { const s = window.sessionStorage.getItem(_plagCacheKey); return s ? JSON.parse(s) : {}; }
    catch { return {}; }
  })();
  function _savePlagCache() {
    try { window.sessionStorage.setItem(_plagCacheKey, JSON.stringify(plagiarismCache)); }
    catch {}
  }

  /** @type {HTMLElement} */(document.getElementById('mag-grade-one')).onclick = () => {
    if (reviewOverlay.classList.contains('open')) {
      // Panel is open — re-grade the currently focused student on demand
      if (activeGradeCurrentFn) {
        activeGradeCurrentFn().catch(e => setStatus('⚠ ' + e.message, '#ff9060'));
      }
    } else {
      runGradeOne().catch(e => setStatus('⚠ ' + e.message, '#ff9060'));
    }
  };

  const gradeNCountEl = /** @type {HTMLInputElement} */(document.getElementById('mag-grade-n-count'));
  const gradeNBtn     = /** @type {HTMLElement} */(document.getElementById('mag-grade-n'));
  const syncGradeNLabel = () => {
    const n = Math.max(1, parseInt(gradeNCountEl.value) || 5);
    gradeNBtn.textContent = `Grade ${n} ▸▸`;
  };
  syncGradeNLabel();
  gradeNCountEl.addEventListener('input', syncGradeNLabel);
  gradeNBtn.onclick = () => {
    if (reviewOverlay.classList.contains('open')) return;
    const n = Math.max(1, parseInt(gradeNCountEl.value) || 5);
    gradeNRemaining = n;
    runGradeOne().catch(e => { gradeNRemaining = 0; setStatus('⚠ ' + e.message, '#ff9060'); });
  };

  /** @type {HTMLElement} */(document.getElementById('mag-grade-all')).onclick = () => {
    if (reviewOverlay.classList.contains('open')) return; // already open
    gradeAllActive = true;
    runGradeOne().catch(e => { gradeAllActive = false; gradeNRemaining = 0; setStatus('⚠ ' + e.message, '#ff9060'); });
  };

  // Show first-run prompt if no keys configured
  if (!CFG.aiKey) {
    setStatus('First run — add a Gemini or HuggingFace token in ⚙ Settings.', '#ffb060');
  } else {
    setStatus('Ready.', '#80d0a0');
  }

})();
