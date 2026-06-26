// @ts-nocheck
// Moodle → Nova Grade Sync — Chrome/Edge Extension content script
// Converted from moodle-nova-sync.user.js v4.6.0
// All grade-matching logic is identical to the Tampermonkey version.

(async function () {
  'use strict';

  // ── Chrome extension API shims (replace Tampermonkey GM_ functions) ──────────

  function mnsAddStyle(css) {
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  async function mnsGetValue(key, defaultVal) {
    const result = await chrome.storage.local.get({ [key]: defaultVal });
    return result[key];
  }

  function mnsSetValue(key, val) {
    // Fire-and-forget — no await needed for UI state persistence
    chrome.storage.local.set({ [key]: val });
  }

  // GM_notification is replaced by the existing flash() toast in each section.
  // No extra notification API is needed.

  // ── Load configuration set by the user in the Options page ──────────────────
  const cfg = await chrome.storage.sync.get({
    moodleHost:     'students.willisonline.ca',
    novaHost:       'nova.williscollege.ca',
    fixedColCount:  5,
    assessmentCell: 1,
    courseMappings: {},
  });

  const IS_MOODLE = location.hostname === cfg.moodleHost;
  const IS_NOVA   = location.hostname === cfg.novaHost;

  // Exit silently on every other website — no UI or processing is done.
  if (!IS_MOODLE && !IS_NOVA) return;

  // ── Shared storage key ────────────────────────────────────────────────────────
  const STORAGE_KEY = 'mns_grades';

  // ═══════════════════════════════════════════════════════════════════════════════
  //  MOODLE SCRAPER
  // ═══════════════════════════════════════════════════════════════════════════════
  if (IS_MOODLE) {

    const SEL = {
      studentRow:  'tr[data-uid], tr.user',
      studentName: 'th .username, th a, td.cell.c0 a, .userfullname',
    };

    mnsAddStyle(`
      #mns-bar {
        position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
        background: #e65c00; color: #fff; font-family: sans-serif;
        padding: 6px 14px; display: flex; align-items: center; gap: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,.35); font-size: 13px;
      }
      #mns-bar select {
        flex: 1; max-width: 300px; padding: 4px 8px; border-radius: 4px;
        border: none; font-size: 13px; background: #fff; color: #333;
      }
      #mns-bar button {
        padding: 5px 12px; background: #fff; color: #e65c00;
        font-weight: bold; border: none; border-radius: 4px;
        cursor: pointer; font-size: 13px; white-space: nowrap;
      }
      #mns-bar button:hover { background: #ffe8d6; }
      #mns-bar button:disabled { background: #ccc; color: #888; cursor: not-allowed; }
      #mns-bar button#mns-capture-all-btn { background: #ffe8d6; }
      #mns-bar button#mns-capture-all-btn:hover { background: #ffd4b3; }
      #mns-bar button#mns-capture-all-btn:disabled { background: #ccc; color: #888; }
      #mns-bar.mns-minimized { width: auto; right: auto; padding: 4px 10px; border-radius: 0 0 6px 0; }
      #mns-bar.mns-minimized > *:not(#mns-min-btn) { display: none !important; }
      #mns-min-btn {
        margin-left: auto; padding: 2px 8px; background: rgba(255,255,255,0.25);
        color: #fff; border: none; border-radius: 3px; cursor: pointer;
        font-size: 12px; white-space: nowrap;
      }
      #mns-min-btn:hover { background: rgba(255,255,255,0.4); }
      #mns-msg {
        position: fixed; top: 40px; right: 14px; z-index: 99999;
        padding: 6px 14px; border-radius: 4px; font-family: sans-serif;
        font-size: 12px; color: #fff; display: none; max-width: 340px;
        word-break: break-word;
      }
    `);

    const bar = document.createElement('div');
    bar.id = 'mns-bar';
    bar.innerHTML = `
      <span style="white-space:nowrap;font-weight:bold">📋 Moodle→Nova</span>
      <select id="mns-col-select"><option value="">— detecting columns… —</option></select>
      <button id="mns-capture-btn" disabled>Capture</button>
      <button id="mns-capture-all-btn" disabled title="Capture ALL activities at once">Capture All</button>
      <span id="mns-stored-label" style="font-size:11px;opacity:.85"></span>
      <button id="mns-min-btn">▲ Hide</button>
    `;
    document.body.prepend(bar);

    const msg = document.createElement('div');
    msg.id = 'mns-msg';
    document.body.appendChild(msg);

    function flash(text, color = '#2a7a2a', ms = 5000) {
      msg.textContent = text;
      msg.style.background = color;
      msg.style.display = 'block';
      clearTimeout(flash._t);
      flash._t = setTimeout(() => (msg.style.display = 'none'), ms);
    }

    function normalizeName(raw) {
      let s = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
                 .replace(/['''\u2018\u2019`]/g, '')               // strip apostrophes
                 .replace(/-/g, ' ')                               // hyphens → spaces
                 .replace(/\s+/g, ' ').trim();
      if (s.includes(',')) {
        const [last, ...rest] = s.split(',').map(p => p.trim());
        return `${rest.join(' ')} ${last}`.toLowerCase();
      }
      return s.toLowerCase();
    }

    function parseColumns() {
      let bestRow = null;
      document.querySelectorAll('thead tr, tr.heading').forEach(row => {
        if (!bestRow || row.querySelectorAll('th').length > bestRow.querySelectorAll('th').length)
          bestRow = row;
      });
      if (!bestRow) return [];

      const cols = [];
      // Use .cells (not querySelectorAll('th')) so colIndex matches row.cells[colIndex] in student rows
      Array.from(bestRow.cells).forEach((cell, colIndex) => {
        const colClass = Array.from(cell.classList).find(c => /^c\d+$/.test(c));
        if (!colClass) return;

        let label = cell.textContent.replace(/\s+/g, ' ').trim();
        label = label.replace(/^Expand\s+column\s+/i, '');
        label = label.replace(/\s*Cell actions\b.*/i, '').trim();
        label = label.replace(/^(.+)\s+\1$/i, '$1').trim();

        if (!label || label.length <= 1) return;
        if (/^(first name|last name|surname|email|select)/i.test(label)) return;
        // Allow item-level totals (any label that contains a digit, e.g. "Assignment 1 total",
        // "Quiz 1 NOVA total", "Lesson 3 Quiz total") and exam/midterm labels.
        // Block category aggregates that have no digit: "Course total", "Quizzes total",
        // "Assignments total", "Non-Graded Total", bare "Total", etc.
        if (/\btotal\b/i.test(label) && !/\d|\b(?:exam|midterm)\b/i.test(label)) return;
        if (/\blab\s+(?:exercise|activity|assignment)\b/i.test(label)) return;
        if (/\bacademic\s+integrity\b/i.test(label)) return;

        cols.push({ colClass, colIndex, label });
      });
      return cols;
    }

    // Extract grade from raw text.
    // Prefers the value inside parentheses when format is "46 (100 %)" → "100".
    // Falls back to the first number for plain values like "85.00".
    function extractGrade(raw) {
      const paren = raw.match(/\(\s*([\d.]+)\s*%/);
      if (paren) return paren[1];
      const first = raw.match(/([\d.]+)/);
      return first ? first[1] : '';
    }

    function parseStudents({ colClass, colIndex }) {
      const students = [];
      document.querySelectorAll(SEL.studentRow).forEach(row => {
        const nameEl = row.querySelector(SEL.studentName);
        if (!nameEl) return;
        const rawName = nameEl.textContent.replace(/\s+/g, ' ').trim();
        if (!rawName || rawName.length < 2) return;
        let grade = '';
        // Primary: use absolute column position (unaffected by missing/merged cells)
        // Fallback: CSS class lookup (in case row structure differs from header)
        const targetCell = row.cells[colIndex] ?? row.querySelector(`td.${colClass}`);
        if (targetCell) {
          // 1. Visible text input (edit mode) — skip hidden inputs which hold form IDs
          const input = targetCell.querySelector('input:not([type="hidden"])');
          if (input && input.value.trim()) grade = extractGrade(input.value);
          // 2. Moodle read-only span
          if (!grade) {
            const span = targetCell.querySelector('.gradevalue, .grade');
            if (span) grade = extractGrade(span.textContent);
          }
          // 3. Raw cell text fallback
          if (!grade) grade = extractGrade(targetCell.textContent);
        } else {
          console.warn(`[MNS] Cell not found for "${rawName}" — colIndex=${colIndex}, colClass=${colClass}`);
        }
        students.push({ name: rawName, normalizedName: normalizeName(rawName), grade });
      });
      return students;
    }

    function populateSelector() {
      const select = document.getElementById('mns-col-select');
      const btn = document.getElementById('mns-capture-btn');
      const btnAll = document.getElementById('mns-capture-all-btn');
      const cols = parseColumns();
      if (!cols.length) {
        select.innerHTML = '<option value="">⚠ No columns detected — check console (F12)</option>';
        console.warn('[MNS] Could not find activity header cells.');
        return;
      }
      select.innerHTML = cols.map(c =>
        `<option value="${c.colClass}:${c.colIndex}">${c.label}</option>`
      ).join('');
      btn.disabled = false;
      btnAll.disabled = false;
    }

    // Restore collapsed state from previous session
    if (await mnsGetValue('mns_moodle_bar_min', false)) {
      bar.classList.add('mns-minimized');
      document.getElementById('mns-min-btn').textContent = '▼ MNS';
    }

    document.getElementById('mns-min-btn').addEventListener('click', () => {
      const minimized = bar.classList.toggle('mns-minimized');
      document.getElementById('mns-min-btn').textContent = minimized ? '▼ MNS' : '▲ Hide';
      mnsSetValue('mns_moodle_bar_min', minimized);
    });

    // ── Capture single column ─────────────────────────────────────────────────
    document.getElementById('mns-capture-btn').addEventListener('click', async () => {
      const select = document.getElementById('mns-col-select');
      const [colClass, colIdxStr] = select.value.split(':');
      const colIndex = parseInt(colIdxStr, 10);
      const colLabel = select.options[select.selectedIndex]?.text || 'Unknown';
      const students = parseStudents({ colClass, colIndex });
      const valid = students.filter(s => s.name);
      if (!valid.length) {
        flash('⚠ No students found. Open F12 console for details.', '#b00');
        return;
      }
      const payload = {
        version: 'single',
        activity: colLabel,
        students: valid,
        capturedAt: new Date().toISOString(),
        url: window.location.href,
      };
      mnsSetValue(STORAGE_KEY, JSON.stringify(payload));
      const withGrades = valid.filter(s => s.grade).length;
      flash(`✓ Captured ${valid.length} students (${withGrades} with grades) from "${colLabel}"`);
      document.getElementById('mns-stored-label').textContent =
        `Stored: "${colLabel}" · ${valid.length} students`;
      console.info('[MNS] Captured payload:', payload);
    });

    // ── Capture All columns ───────────────────────────────────────────────────
    document.getElementById('mns-capture-all-btn').addEventListener('click', async () => {
      const cols = parseColumns();
      if (!cols.length) {
        flash('⚠ No columns detected.', '#b00');
        return;
      }

      const btnAll = document.getElementById('mns-capture-all-btn');
      btnAll.disabled = true;
      btnAll.textContent = 'Capturing…';

      const activities = {};
      let totalWithGrades = 0;

      for (const col of cols) {
        const students = parseStudents(col);
        const valid = students.filter(s => s.name);
        activities[col.label] = valid;
        totalWithGrades += valid.filter(s => s.grade).length;
      }

      const activityCount = Object.keys(activities).length;
      const firstKey = Object.keys(activities)[0];
      const studentCount = firstKey ? activities[firstKey].length : 0;

      const payload = {
        version: 'multi',
        activities,
        capturedAt: new Date().toISOString(),
        url: window.location.href,
      };

      mnsSetValue(STORAGE_KEY, JSON.stringify(payload));

      btnAll.disabled = false;
      btnAll.textContent = 'Capture All';

      flash(`✓ Captured All: ${activityCount} activities, ${studentCount} students, ${totalWithGrades} grade entries`);
      document.getElementById('mns-stored-label').textContent =
        `Stored: ${activityCount} activities · ${studentCount} students`;
      console.info('[MNS] Capture All payload:', payload);
    });

    // ── Show stored info on load ──────────────────────────────────────────────
    (async () => {
      const stored = await mnsGetValue(STORAGE_KEY, null);
      if (stored) {
        try {
          const d = JSON.parse(stored);
          const mins = Math.round((Date.now() - new Date(d.capturedAt).getTime()) / 60000);
          if (d.version === 'multi') {
            const actCount = Object.keys(d.activities).length;
            document.getElementById('mns-stored-label').textContent =
              `Stored: ${actCount} activities · ${mins}m ago`;
          } else {
            document.getElementById('mns-stored-label').textContent =
              `Stored: "${d.activity}" · ${d.students.length} students · ${mins}m ago`;
          }
        } catch (_) {}
      }
      setTimeout(populateSelector, 800);
    })();
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  //  NOVA FILLER
  // ═══════════════════════════════════════════════════════════════════════════════
  if (IS_NOVA) {

    const SEL = {
      table:          'table',
      fixedColCount:  cfg.fixedColCount,
      assessmentCell: cfg.assessmentCell,
      gradeInput:     'input',
      fuzzyTolerance: 2,
    };

    mnsAddStyle(`
      #mns-bar {
        position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
        background: #005f99; color: #fff; font-family: sans-serif;
        padding: 6px 14px; display: flex; align-items: center; gap: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,.35); font-size: 13px;
      }
      #mns-bar select {
        flex: 1; max-width: 300px; padding: 4px 8px; border-radius: 4px;
        border: none; font-size: 13px; background: #fff; color: #333;
      }
      #mns-bar .mns-btn {
        padding: 5px 12px; background: #fff; color: #005f99;
        font-weight: bold; border: none; border-radius: 4px;
        cursor: pointer; font-size: 13px; white-space: nowrap;
      }
      #mns-bar .mns-btn:hover { background: #d6eeff; }
      #mns-bar .mns-btn:disabled { background: #ccc; color: #888; cursor: not-allowed; }
      #mns-bar .mns-btn#mns-fill-all-btn { background: #d6eeff; }
      #mns-bar .mns-btn#mns-fill-all-btn:hover { background: #b8dfff; }
      #mns-bar .mns-btn#mns-fill-all-btn:disabled { background: #ccc; color: #888; }
      #mns-bar .mns-btn#mns-undo-btn { background: #fdecea; color: #c0392b; display: none; }
      #mns-bar .mns-btn#mns-undo-btn:hover { background: #f9c4be; }
      #mns-bar.mns-minimized { width: auto; right: auto; padding: 4px 10px; border-radius: 0 0 6px 0; }
      #mns-bar.mns-minimized > *:not(#mns-min-btn) { display: none !important; }
      #mns-min-btn {
        margin-left: auto; padding: 2px 8px; background: rgba(255,255,255,0.25);
        color: #fff; border: none; border-radius: 3px; cursor: pointer;
        font-size: 12px; white-space: nowrap;
      }
      #mns-min-btn:hover { background: rgba(255,255,255,0.4); }
      .mns-sep { color: rgba(255,255,255,0.35); font-size: 16px; padding: 0 2px; }
      #mns-bar select#mns-stu-select { max-width: 160px; }
      .mns-btn.mns-danger { background: #fdecea !important; color: #c0392b !important; }
      .mns-btn.mns-danger:hover { background: #f9c4be !important; }
      .mns-btn.mns-danger:disabled { background: #ccc !important; color: #888 !important; }
      .mns-btn.mns-warn { background: #fff3cd !important; color: #7a5500 !important; }
      .mns-btn.mns-warn:hover { background: #ffe082 !important; }
      .mns-btn.mns-warn:disabled { background: #ccc !important; color: #888 !important; }
      #mns-msg {
        position: fixed; top: 40px; right: 14px; z-index: 99999;
        padding: 6px 14px; border-radius: 4px; font-size: 12px;
        color: #fff; font-family: sans-serif; display: none; max-width: 360px;
        word-break: break-word;
      }
      #mns-panel {
        position: fixed; top: 44px; right: 14px; z-index: 99999;
        width: 420px; max-height: 520px; overflow-y: auto;
        background: #fff; border: 1px solid #bbb; border-radius: 6px;
        box-shadow: 0 4px 20px rgba(0,0,0,.2); font-family: sans-serif;
        font-size: 12px; display: none;
      }
      .mns-ph { background: #005f99; color: #fff; padding: 8px 12px;
        font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
      .mns-px { cursor: pointer; font-size: 16px; }
      .mns-tbl { width: 100%; border-collapse: collapse; }
      .mns-tbl th { background: #f0f0f0; padding: 4px 8px; text-align: left; font-weight: bold; }
      .mns-tbl td { padding: 4px 8px; border-bottom: 1px solid #eee; }
      .mns-ok  { background: #f0fff0; }
      .mns-fuz { background: #fffbe6; }
      .mns-no  { background: #fff0f0; }
      #mns-go {
        display: block; width: calc(100% - 16px); margin: 8px; padding: 8px;
        color: #fff; font-weight: bold; font-size: 13px;
        border: none; border-radius: 4px; cursor: pointer;
      }
      #mns-go:hover { filter: brightness(0.88); }
      .mns-hl { outline: 2px solid #e65c00 !important; background: #fff3e0 !important; }
      .mns-filled { background: #d4f5d4 !important; }
      /* ── Glassmorphic progress bar ─────────────────────────────────── */
      #mns-progress {
        display: none; position: fixed; top: 50px; left: 50%;
        transform: translateX(-50%); z-index: 999999; min-width: 360px;
        background: linear-gradient(135deg,rgba(4,18,72,0.86),rgba(0,55,115,0.86));
        backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(120,190,255,0.30);
        border-radius: 18px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.14);
        padding: 14px 22px 16px; font-family: sans-serif; color: #fff;
        text-shadow: 0 1px 3px rgba(0,0,0,0.5); pointer-events: none;
      }
      #mns-progress-label { font-size: 13px; font-weight: bold; margin-bottom: 9px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #mns-progress-track {
        position: relative; height: 22px; border-radius: 99px;
        background: rgba(255,255,255,0.13);
        box-shadow: inset 0 2px 6px rgba(0,0,0,0.45); overflow: hidden;
      }
      #mns-progress-fill {
        position: absolute; top: 0; left: 0; height: 100%; width: 0%;
        background: linear-gradient(90deg, #c94400 0%, #ff7e00 38%, #ffc200 100%);
        transition: width 0.12s linear;
        animation: mns-pb-glow 1.3s ease-in-out infinite;
      }
      @keyframes mns-pb-glow {
        0%, 100% { box-shadow: 0 0 8px rgba(255,160,0,0.55); }
        50%       { box-shadow: 0 0 24px rgba(255,200,50,0.95); }
      }
      #mns-progress-pct {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 900; color: #fff; letter-spacing: 0.04em;
        font-family: system-ui, sans-serif;
        text-shadow: 0 0 8px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,0.85);
        pointer-events: none; z-index: 2; white-space: nowrap;
      }
      #mns-progress-count { font-size: 11px; opacity: 0.72; margin-top: 6px; text-align: right; }
      /* ── End-of-task summary dialog ────────────────────────────────── */
      #mns-summary {
        display: none; position: fixed; top: 50%; left: 50%;
        transform: translate(-50%,-50%); z-index: 999999;
        min-width: 360px; max-width: 500px;
        background: linear-gradient(155deg,rgba(4,18,72,0.92),rgba(0,50,108,0.92));
        backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
        border: 1px solid rgba(100,180,255,0.28);
        border-radius: 22px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.12);
        padding: 24px 28px 20px; font-family: sans-serif; color: #fff;
        text-shadow: 0 1px 3px rgba(0,0,0,0.40);
      }
      #mns-summary-close {
        position: absolute; top: 14px; right: 18px; cursor: pointer;
        font-size: 18px; opacity: 0.60; line-height: 1;
      }
      #mns-summary-close:hover { opacity: 1; }
      #mns-summary h3 { margin: 0 0 14px; font-size: 15px; color: #a8d8ff; }
      .mns-sum-row {
        display: flex; justify-content: space-between; align-items: center;
        padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.09);
        font-size: 13px;
      }
      .mns-sum-row:last-of-type { border-bottom: none; }
      .mns-sum-val  { font-weight: bold; color: #ffd080; }
      .mns-sum-ok   { color: #7edd8a; }
      .mns-sum-warn { color: #ffcc44; }
      .mns-sum-err  { color: #ff7070; }
      #mns-sum-ok-btn {
        display: block; width: 100%; margin-top: 16px;
        background: rgba(255,255,255,0.13); border: 1px solid rgba(255,255,255,0.28);
        color: #fff; padding: 8px 0; border-radius: 99px; cursor: pointer;
        font-size: 13px; font-weight: bold; letter-spacing: 0.4px;
        backdrop-filter: blur(4px); transition: background 0.15s;
      }
      #mns-sum-ok-btn:hover { background: rgba(255,255,255,0.22); }
      /* ── Red highlight for empty grade cells ───────────────────────── */
      .mns-empty-cell {
        background: rgba(220,45,45,0.10) !important;
        outline: 1px solid rgba(210,40,40,0.50) !important;
        border-radius: 3px;
      }
    `);

    const bar = document.createElement('div');
    bar.id = 'mns-bar';
    bar.innerHTML = `
      <span style="font-weight:bold;white-space:nowrap">⬇ Nova Sync</span>
      <select id="mns-row-select"><option value="">— select assessment row —</option></select>
      <button class="mns-btn" id="mns-preview-btn" disabled>Preview</button>
      <button class="mns-btn" id="mns-fill-all-btn" disabled title="Fill selected row immediately (no preview panel)">Fill Now</button>
      <span class="mns-sep">|</span>
      <select id="mns-stu-select"><option value="">— student —</option></select>
      <button class="mns-btn mns-warn" id="mns-fill-stu-btn" disabled title="Fill all activities for selected student">Fill Student</button>
      <button class="mns-btn mns-danger" id="mns-clear-stu-btn" disabled title="Clear all grades for selected student">Clear Student</button>
      <span class="mns-sep">|</span>
      <button class="mns-btn mns-warn" id="mns-fill-class-btn" disabled title="Fill all matched activities for entire class">Fill All</button>
      <button class="mns-btn mns-danger" id="mns-clear-class-btn" disabled title="Clear all grade inputs on this page">Clear All</button>
      <button class="mns-btn" id="mns-undo-btn" title="Undo last fill — restores previous values">↩ Undo</button>
      <span id="mns-cap-info" style="font-size:11px;opacity:.8"></span>
      <button id="mns-min-btn">▲ Hide</button>
    `;
    document.body.prepend(bar);

    const msgEl = document.createElement('div');
    msgEl.id = 'mns-msg';
    document.body.appendChild(msgEl);

    const panel = document.createElement('div');
    panel.id = 'mns-panel';
    document.body.appendChild(panel);

    const progressEl = document.createElement('div');
    progressEl.id = 'mns-progress';
    progressEl.innerHTML =
      '<div id="mns-progress-label">Filling grades…</div>' +
      '<div id="mns-progress-track"><div id="mns-progress-fill"></div><span id="mns-progress-pct">0%</span></div>' +
      '<div id="mns-progress-count"></div>';
    document.body.appendChild(progressEl);

    const summaryEl = document.createElement('div');
    summaryEl.id = 'mns-summary';
    document.body.appendChild(summaryEl);

    const mnsProgress = {
      show(label) {
        document.getElementById('mns-progress-label').textContent = label;
        document.getElementById('mns-progress-fill').style.width = '0%';
        document.getElementById('mns-progress-pct').textContent = '0%';
        document.getElementById('mns-progress-count').textContent = '';
        progressEl.style.display = 'block';
      },
      hide() { progressEl.style.display = 'none'; },
    };

    function mnsProgressSetPct(pct, countText) {
      const p = Math.min(pct, 100);
      document.getElementById('mns-progress-fill').style.width = p + '%';
      document.getElementById('mns-progress-pct').textContent = Math.round(p) + '%';
      if (countText != null) document.getElementById('mns-progress-count').textContent = countText;
    }

    function mnsSummaryDialog(result, label) {
      const { filled, skippedExisting = 0, skippedNoGrade = 0, unmatched = 0 } = result;
      const titleColor = filled > 0 ? '#7edd8a' : '#ff7070';
      const titleIcon  = filled > 0 ? '✓' : '⚠';
      const titleText  = filled > 0
        ? `${filled} grade${filled !== 1 ? 's' : ''} filled${label ? ' — ' + label : ''}`
        : `No grades filled${label ? ' — ' + label : ''}`;
      const noChangeNote = filled === 0
        ? `<div style="margin-top:11px;padding:9px 12px;background:rgba(255,200,60,0.14);border:1px solid rgba(255,200,60,0.28);border-radius:8px;font-size:12px;color:#ffd08a">No changes were made. Would you like to re-confirm the student’s grade(s) from Moodle before filling again?</div>`
        : '';
      const statRows = [
        { label: 'Cells filled',              val: filled,          cls: 'mns-sum-ok'   },
        skippedExisting ? { label: 'Skipped (had existing data)', val: skippedExisting, cls: 'mns-sum-warn' } : null,
        skippedNoGrade  ? { label: 'No grade in Moodle',          val: skippedNoGrade,  cls: 'mns-sum-warn' } : null,
        unmatched       ? { label: 'Unmatched students',           val: unmatched,       cls: 'mns-sum-err'  } : null,
      ].filter(Boolean);
      summaryEl.innerHTML =
        `<span id="mns-summary-close">✕</span>` +
        `<h3><span style="color:${titleColor}">${titleIcon}</span> ${titleText}</h3>` +
        statRows.map(r => `<div class="mns-sum-row"><span>${r.label}</span><span class="mns-sum-val ${r.cls}">${r.val}</span></div>`).join('') +
        noChangeNote +
        `<button id="mns-sum-ok-btn">OK</button>`;
      summaryEl.style.display = 'block';
      summaryEl.querySelector('#mns-summary-close').onclick = () => { summaryEl.style.display = 'none'; };
      summaryEl.querySelector('#mns-sum-ok-btn').onclick    = () => { summaryEl.style.display = 'none'; };
    }

    function highlightEmptyCells() {
      const p = parseTable();
      if (!p) return;
      p.assessmentRows.forEach(row => {
        p.studentCols.forEach(col => {
          const inp = row.cells[col.colIndex] && row.cells[col.colIndex].querySelector(SEL.gradeInput);
          if (!inp) return;
          if (inp.value.trim() === '') inp.classList.add('mns-empty-cell');
          else inp.classList.remove('mns-empty-cell');
        });
      });
    }

    async function fillRowAsync(matches, skipExisting, onProgress) {
      let filled = 0, skippedExisting = 0, skippedNoGrade = 0, noInput = 0, processed = 0;
      for (const m of matches) {
        if (!m.match) { processed++; }
        else {
          const grade = m.match.student.grade;
          if (!grade)    { skippedNoGrade++; processed++; }
          else if (!m.input) { noInput++; processed++; }
          else {
            const wrote = setInputValue(m.input, grade, skipExisting);
            if (wrote) filled++; else skippedExisting++;
            processed++;
          }
        }
        if (onProgress) onProgress(processed);
        if (processed % 4 === 0) await new Promise(r => setTimeout(r, 0));
      }
      return { filled, skippedExisting, skippedNoGrade, noInput,
               unmatched: matches.filter(m => !m.match).length };
    }

    // Finds the Nova "Score:" row — the row whose first cell is exactly "Score:".
    // That row holds the weighted percentage totals that auto-calculate after grades are entered.
    function findScoreRow(tableEl) {
      if (!tableEl) return null;
      for (const row of tableEl.querySelectorAll('tr')) {
        const first = row.querySelector('td, th');
        if (first && first.textContent.trim() === 'Score:') return row;
      }
      return null;
    }

    // Polls Score: row text every pollMs. Resolves ONLY when:
    //   • at least one text change has been observed (Nova started recalculating), AND
    //   • text has been stable for stableMs since the last change.
    // If no change is ever seen (grades produced identical scores), a minWaitMs floor
    // prevents declaring done before Nova has even started recalculating.
    function createScoreSettleWatcher(tableEl, pollMs = 200, stableMs = 2500, minWaitMs = 3000, timeoutMs = 30000) {
      const scoreRow = findScoreRow(tableEl);
      const targetEl = scoreRow || tableEl;
      if (!targetEl) return { promise: new Promise(r => setTimeout(r, stableMs)), scoreRow: null };
      let resolveSettle;
      const promise = new Promise(r => { resolveSettle = r; });
      const snap = () => targetEl.textContent;
      const startTime = performance.now();
      let lastSnap = snap();
      let lastChangeAt = startTime;
      let hasEverChanged = false;
      let pollTimer;
      const hardTimeout = setTimeout(() => { clearTimeout(pollTimer); resolveSettle(); }, timeoutMs);
      function check() {
        const now = performance.now();
        const current = snap();
        if (current !== lastSnap) { lastSnap = current; lastChangeAt = now; hasEverChanged = true; }
        const canResolve = (hasEverChanged || now - startTime >= minWaitMs)
                        && (now - lastChangeAt >= stableMs);
        if (canResolve) { clearTimeout(hardTimeout); resolveSettle(); return; }
        pollTimer = setTimeout(check, pollMs);
      }
      pollTimer = setTimeout(check, pollMs);
      return { promise, scoreRow };
    }

    // Smoothly animate the bar from fromPct to toPct over durationMs using RAF.
    // Returns a cancel function; once cancelled the bar stays at its current position.
    // The bar is capped at toPct so it never jumps to 100% before the observer quiesces.
    function animateBar(fromPct, toPct, durationMs, onTick) {
      let rafId, cancelled = false;
      const t0 = performance.now();
      function tick(now) {
        if (cancelled) return;
        const elapsed = Math.min(now - t0, durationMs);
        const linear = elapsed / durationMs;
        const eased = linear * linear * (3 - 2 * linear); // smooth-step
        onTick(fromPct + (toPct - fromPct) * eased);
        if (elapsed < durationMs) rafId = requestAnimationFrame(tick);
      }
      rafId = requestAnimationFrame(tick);
      return () => { cancelled = true; cancelAnimationFrame(rafId); };
    }

    function flash(text, color = '#2a7a2a', ms = 7000) {
      msgEl.textContent = text;
      msgEl.style.background = color;
      msgEl.style.display = 'block';
      clearTimeout(flash._t);
      flash._t = setTimeout(() => (msgEl.style.display = 'none'), ms);
    }

    function norm(raw) {
      let s = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
                 .replace(/['''\u2018\u2019`]/g, '')               // strip apostrophes
                 .replace(/-/g, ' ')                               // hyphens → spaces
                 .replace(/\s+/g, ' ').trim();
      if (s.includes(',')) {
        const [last, ...rest] = s.split(',').map(p => p.trim());
        return `${rest.join(' ')} ${last}`.toLowerCase();
      }
      return s.toLowerCase();
    }

    function levenshtein(a, b) {
      const m = a.length, n = b.length;
      const dp = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
      for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
          dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
            : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      return dp[m][n];
    }

    // ── Name similarity: returns 0–1. Three strategies, highest wins. ──────────
    function nameSimilarity(a, b) {
      if (a === b) return 1;

      // 1. Character-level Levenshtein ratio
      const levSim = 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

      // 2. Space-collapsed: "al hassan" vs "alhassan" → identical after collapse
      const ca = a.replace(/\s/g, ''), cb = b.replace(/\s/g, '');
      const collSim = 1 - levenshtein(ca, cb) / Math.max(ca.length, cb.length, 1);

      // 3. Token overlap: fraction of the shorter name's tokens found in the longer.
      //    Keeps numeric tokens (e.g. "1", "2") so "Quiz 1" ≠ "Quiz 2".
      //    Drops single non-numeric chars only (e.g. initials like "J").
      const keepTok = t => t.length > 1 || /^\d+$/.test(t);
      const tokA = a.split(' ').filter(keepTok);
      const tokB = b.split(' ').filter(keepTok);
      const [shorter, longer] = tokA.length <= tokB.length ? [tokA, tokB] : [tokB, tokA];
      // Numeric tokens must match exactly — levenshtein("1","2")=1 so <=1 tolerance
      // would make every quiz number match every other, collapsing all quizzes to the same score.
      const tokenMatches = shorter.filter(t =>
        longer.some(lt => /^\d+$/.test(t) && /^\d+$/.test(lt) ? t === lt : levenshtein(t, lt) <= 1)
      ).length;
      const tokenSim = shorter.length > 0 ? tokenMatches / shorter.length : 0;

      // 4. Number guard: if BOTH labels contain numbers but none of them are shared,
      //    cap the score at 0.49 so any exact-number match always ranks above it.
      const numsA = a.match(/\d+/g) || [];
      const numsB = b.match(/\d+/g) || [];
      if (numsA.length > 0 && numsB.length > 0) {
        const setB = new Set(numsB);
        const anyNumMatch = numsA.some(n => setB.has(n));
        if (!anyNumMatch) return Math.min(Math.max(levSim, collSim, tokenSim), 0.49);
      }

      return Math.max(levSim, collSim, tokenSim);
    }

    function findStudentMatch(novaName, moodleStudents) {
      const key = norm(novaName);
      let best = null, bestSim = 0;
      for (const s of moodleStudents) {
        const mKey = norm(s.name);
        if (mKey === key) return { student: s, type: 'exact' };
        const sim = nameSimilarity(key, mKey);
        if (sim > bestSim) { bestSim = sim; best = s; }
      }
      // ≥95% treated as a confident match; 75–94% flagged as fuzzy (⚠ in preview)
      if (bestSim >= 0.95) return { student: best, type: 'exact' };
      if (bestSim >= 0.75) return { student: best, type: 'fuzzy', sim: bestSim };
      return null;
    }

    // ── Extract a flat activities map from payload (handles single and multi) ──
    function getActivities(payload) {
      if (payload.version === 'multi' && payload.activities) {
        return payload.activities; // { [activityLabel]: [{name, normalizedName, grade}] }
      }
      // Legacy single-activity format
      return { [payload.activity]: payload.students };
    }

    // ── Find the best-matching Moodle activity for a given Nova row label ─────
    function matchActivity(rowLabel, activities) {
      const keys = Object.keys(activities);
      if (!keys.length) return null;

      const normRow = norm(rowLabel);

      // 1. Exact match
      for (const key of keys) {
        if (norm(key) === normRow) return key;
      }

      // 2. One label starts with the other (handles truncated Nova labels)
      for (const key of keys) {
        const normKey = norm(key);
        if (normKey.startsWith(normRow) || normRow.startsWith(normKey)) return key;
      }

      // 3. Similarity scoring
      let bestKey = null, bestSim = 0;
      for (const key of keys) {
        const normKey = norm(key);
        const sim = nameSimilarity(normRow, normKey);
        if (sim > bestSim) { bestSim = sim; bestKey = key; }
      }
      if (bestSim >= 0.6) return bestKey;

      return null;
    }

    // ── Per-course activity resolver ──────────────────────────────────────────
    // Checks the Options-page courseMappings for an explicit Nova-row → Moodle-column
    // override before falling back to automatic name matching.
    // courseMappings format: { "Course Name": { "Nova Row": "Moodle Column" } }
    function resolveActivityForRow(course, novaRow, activities) {
      const mappings = cfg.courseMappings || {};
      if (course) {
        const courseKey = Object.keys(mappings).find(k =>
          course.toLowerCase().includes(k.toLowerCase()) ||
          k.toLowerCase().includes(course.toLowerCase())
        );
        if (courseKey) {
          const rowMap = mappings[courseKey];
          const rowKey = Object.keys(rowMap).find(k => norm(k) === norm(novaRow));
          if (rowKey) {
            const targetCol = rowMap[rowKey];
            const found = Object.keys(activities).find(k => norm(k) === norm(targetCol));
            if (found) return found;
          }
        }
      }
      return matchActivity(novaRow, activities);
    }

    function parseTable() {
      const tables = document.querySelectorAll(SEL.table);
      let table = null;
      for (const t of tables) {
        if (!table || t.rows[0]?.cells.length > table.rows[0]?.cells.length)
          table = t;
      }
      if (!table) return null;
      const rows = Array.from(table.rows);
      if (rows.length < 2) return null;

      const headerCells = Array.from(rows[0].cells);
      const studentCols = [];
      for (let i = SEL.fixedColCount; i < headerCells.length; i++) {
        const name = headerCells[i].textContent.trim();
        if (name) studentCols.push({ name, colIndex: i, normalizedName: norm(name) });
      }

      const assessmentRows = [];
      for (let r = 1; r < rows.length; r++) {
        const cells = Array.from(rows[r].cells);
        if (cells.length < SEL.fixedColCount) continue;
        const course = cells[0]?.textContent.trim() || '';
        const assessment = cells[SEL.assessmentCell]?.textContent.trim() || '';
        const type = cells[2]?.textContent.trim() || '';
        if (!assessment) continue;
        if (/\blab\s+(?:activity|assignment)\b/i.test(assessment)) continue;
        assessmentRows.push({ rowIndex: r, row: rows[r], course, assessment, type, cells });
      }
      return { table, studentCols, assessmentRows };
    }

    function populateRowSelector(assessmentRows, studentCols) {
      const sel = document.getElementById('mns-row-select');
      sel.innerHTML = '<option value="">— pick Nova assessment row to preview —</option>' +
        assessmentRows.map((a, i) =>
          `<option value="${i}">${a.course ? a.course + ' › ' : ''}${a.assessment}${a.type ? ' (' + a.type + ')' : ''}</option>`
        ).join('');
      document.getElementById('mns-preview-btn').disabled = false;
      document.getElementById('mns-fill-all-btn').disabled = false;

      const stuSel = document.getElementById('mns-stu-select');
      stuSel.innerHTML = '<option value="">— student —</option>' +
        studentCols.map((s, i) => `<option value="${i}">${s.name}</option>`).join('');
      document.getElementById('mns-fill-stu-btn').disabled = false;
      document.getElementById('mns-clear-stu-btn').disabled = false;
      document.getElementById('mns-fill-class-btn').disabled = false;
      document.getElementById('mns-clear-class-btn').disabled = false;
    }

    function buildMatches(assessmentRow, studentCols, moodleStudents) {
      return studentCols.map(col => {
        const input = assessmentRow.cells[col.colIndex]?.querySelector(SEL.gradeInput) || null;
        const match = findStudentMatch(col.name, moodleStudents);
        return { novaName: col.name, colIndex: col.colIndex, input, match };
      });
    }

    // ── Undo stack — stores backups of overwritten input values ──────────────
    let undoStack = [];

    function showUndoBtn(count) {
      const btn = document.getElementById('mns-undo-btn');
      btn.style.display = 'inline-block';
      btn.textContent = `↩ Undo (${count})`;
    }

    function hideUndoBtn() {
      const btn = document.getElementById('mns-undo-btn');
      btn.style.display = 'none';
      undoStack = [];
    }

    function setInputValue(input, newValue, skipExisting) {
      const previousValue = input.value.trim();
      if (skipExisting && previousValue !== '') return false;
      undoStack.push({ input, previousValue });
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter ? setter.call(input, newValue) : (input.value = newValue);
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      input.classList.add('mns-filled');
      return true;
    }

    function fillRow(matches, skipExisting) {
      let filled = 0, skippedExisting = 0, skippedNoGrade = 0, noInput = 0;
      matches.forEach(m => {
        if (!m.match) return;
        const grade = m.match.student.grade;
        if (!grade) { skippedNoGrade++; return; }
        if (!m.input) { noInput++; return; }
        const wrote = setInputValue(m.input, grade, skipExisting);
        if (wrote) filled++;
        else skippedExisting++;
      });
      return {
        filled, skippedExisting, skippedNoGrade, noInput,
        unmatched: matches.filter(m => !m.match).length,
      };
    }

    // ── Clear a single input (backs up to undo stack) ─────────────────────────
    function clearInputVal(input) {
      const prev = input.value.trim();
      if (!prev) return false;
      undoStack.push({ input, previousValue: prev });
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter ? setter.call(input, '') : (input.value = '');
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      input.classList.remove('mns-filled');
      return true;
    }

    // ── Find the best Nova assessment row for a Moodle activity label ─────────
    function matchRow(actKey, assessmentRows) {
      const normAct = norm(actKey);
      // 1. Exact match
      let found = assessmentRows.find(r => norm(r.assessment) === normAct);
      if (found) return found;
      // 2. Prefix match (handles truncated Nova labels)
      found = assessmentRows.find(r => {
        const nr = norm(r.assessment);
        return nr.startsWith(normAct) || normAct.startsWith(nr);
      });
      if (found) return found;
      // 3. Similarity scoring — uses number-aware nameSimilarity so
      //    "Lesson 1 Quiz" (Moodle) scores 1.0 against "Quiz 1" (Nova)
      //    because both tokens "quiz" and "1" appear in the longer label.
      let bestRow = null, bestSim = 0;
      for (const r of assessmentRows) {
        const sim = nameSimilarity(normAct, norm(r.assessment));
        if (sim > bestSim) { bestSim = sim; bestRow = r; }
      }
      if (bestSim >= 0.6) return bestRow;
      return null;
    }

    // Restore collapsed state from previous session
    if (await mnsGetValue('mns_nova_bar_min', false)) {
      bar.classList.add('mns-minimized');
      document.getElementById('mns-min-btn').textContent = '▼ MNS';
    }

    document.getElementById('mns-min-btn').addEventListener('click', () => {
      const minimized = bar.classList.toggle('mns-minimized');
      document.getElementById('mns-min-btn').textContent = minimized ? '▼ MNS' : '▲ Hide';
      mnsSetValue('mns_nova_bar_min', minimized);
    });

    // ── Undo button ───────────────────────────────────────────────────────────
    document.getElementById('mns-undo-btn').addEventListener('click', () => {
      if (!undoStack.length) { flash('Nothing to undo.', '#888'); return; }
      let restored = 0;
      for (const { input, previousValue } of undoStack) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter ? setter.call(input, previousValue) : (input.value = previousValue);
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        input.classList.remove('mns-filled');
        restored++;
      }
      flash(`↩ Undone — restored ${restored} cells to previous values.`, '#7a5500', 8000);
      console.info(`[MNS] Undo: restored ${restored} cells.`);
      hideUndoBtn();
    });

    // ── Shared: resolve assessment row + activity, open confirm panel ─────────
    function resolveAndOpen(assessmentRow, activities, onOpen) {
      const actKeys = Object.keys(activities);

      let autoKey;
      let sortedKeys = actKeys;

      if (actKeys.length === 1) {
        autoKey = actKeys[0];
      } else {
        const normRow = norm(assessmentRow.assessment);

        const scored = actKeys
          .map(k => ({ key: k, nk: norm(k), sim: nameSimilarity(normRow, norm(k)) }))
          .sort((a, b) => b.sim - a.sim);
        sortedKeys = scored.map(e => e.key);

        // Course-specific mapping takes priority over similarity scoring
        const mappedKey = resolveActivityForRow(assessmentRow.course, assessmentRow.assessment, activities);
        if (mappedKey) {
          autoKey = mappedKey;
        } else {
          const exact  = scored.find(e => e.nk === normRow);
          const prefix = !exact && scored.find(e => e.nk.startsWith(normRow) || normRow.startsWith(e.nk));
          autoKey = exact ? exact.key : prefix ? prefix.key : scored[0].key;
        }

        console.group(`[MNS] Preview match for "${assessmentRow.assessment}" (norm="${normRow}")`);
        scored.forEach(e => console.log(`  ${e.sim.toFixed(3)}  "${e.key}"  (norm="${e.nk}")`));
        console.log(`→ autoKey = "${autoKey}"  [${mappedKey ? 'course-mapping' : scored.find(e=>e.nk===normRow) ? 'exact' : scored.find(e=>e.nk.startsWith(normRow)||normRow.startsWith(e.nk)) ? 'prefix' : 'best-sim'}]`);
        console.groupEnd();
      }

      const pickerHtml = actKeys.length > 1
        ? `<div style="padding:6px 12px;background:#f0f8ff;border-bottom:1px solid #b3d9f7;font-size:12px">
            <label style="font-weight:bold;display:block;margin-bottom:3px">Moodle activity to use:</label>
            <select id="mns-act-picker" style="width:100%;padding:4px 6px;font-size:12px;border:1px solid #aaa;border-radius:3px">
              ${sortedKeys.map(k => `<option value="${k}" ${k === autoKey ? 'selected' : ''}>${k}</option>`).join('')}
            </select>
          </div>`
        : `<div style="padding:4px 12px 6px;font-size:11px;color:#555;background:#f5f5f5;border-bottom:1px solid #ddd">
             Moodle activity: <b>${autoKey}</b>
           </div>`;

      onOpen(autoKey, pickerHtml);
    }

    function getSelectedActivity(actKeys, autoKey) {
      const picker = document.getElementById('mns-act-picker');
      return picker ? picker.value : autoKey;
    }

    async function runFill(assessmentRow, rowLabel, activities, autoKey, skipExisting) {
      const actKey = getSelectedActivity(Object.keys(activities), autoKey);
      const matches = buildMatches(assessmentRow, parsed_studentCols_cache, activities[actKey]);
      hideUndoBtn();

      const tableEl = assessmentRow.row.closest('table');
      const colIndices = parsed_studentCols_cache.map(c => c.colIndex);
      // Observer starts BEFORE fill so synchronous Score: mutations are captured
      const { promise: settlePromise, scoreRow } = createScoreSettleWatcher(tableEl);

      // Phase 1: fill grade cells → bar 0 → 85%
      mnsProgress.show(`Filling "${rowLabel}"…`);
      const result = await fillRowAsync(matches, skipExisting, done => {
        mnsProgressSetPct(Math.round((done / matches.length) * 85), `${done} / ${matches.length}`);
      });

      // Phase 2: smooth RAF animation 85 → 99%; only hits 100% when observer quiesces
      document.getElementById('mns-progress-label').textContent = 'Calculating scores…';
      const cancelAnim = animateBar(85, 99, 5000, pct => mnsProgressSetPct(pct));

      await settlePromise;
      cancelAnim();
      mnsProgressSetPct(100, '✓ Done');
      await new Promise(r => setTimeout(r, 300));
      mnsProgress.hide();

      if (result.filled > 0) showUndoBtn(result.filled);
      highlightEmptyCells();

      const auditLog = [];
      matches.forEach(m => {
        if (!m.match || !m.match.student.grade || !m.input) return;
        auditLog.push({
          novaRow: assessmentRow.assessment, moodleActivity: actKey,
          novaStudent: m.novaName, moodleStudent: m.match.student.name,
          matchType: m.match.type, grade: m.match.student.grade,
        });
      });
      if (auditLog.length) {
        console.info('[MNS] ── FILL AUDIT LOG ──────────────────────────────────────');
        console.table(auditLog);
        console.info('[MNS] ── END AUDIT LOG ──────────────────────────────────────');
      }
      mnsSummaryDialog(result, rowLabel);
      if (result.unmatched)
        console.warn('[MNS] Unmatched students:', matches.filter(m => !m.match).map(m => m.novaName));
      return { matches, actKey };
    }

    // Cache for studentCols across async calls
    let parsed_studentCols_cache = [];

    // ── Shared: get & validate row selection ─────────────────────────────────
    async function getSelectedRow() {
      const stored = await mnsGetValue(STORAGE_KEY, null);
      if (!stored) { flash('⚠ No captured Moodle grades — Capture on Moodle first.', '#b00', 0); return null; }
      const payload = JSON.parse(stored);
      const parsed = parseTable();
      if (!parsed) { flash('⚠ Could not parse Nova table. Check console (F12).', '#b00', 0); return null; }
      parsed_studentCols_cache = parsed.studentCols;

      const sel = document.getElementById('mns-row-select');
      const rowIdx = parseInt(sel.value, 10);
      if (isNaN(rowIdx)) { flash('⚠ Select an assessment row from the dropdown first.', '#b00'); return null; }

      const assessmentRow = parsed.assessmentRows[rowIdx];
      const rowLabel = `${assessmentRow.course ? assessmentRow.course + ' › ' : ''}${assessmentRow.assessment}`;
      const activities = getActivities(payload);
      return { assessmentRow, rowLabel, activities, parsed };
    }

    // ── Preview ───────────────────────────────────────────────────────────────
    document.getElementById('mns-preview-btn').addEventListener('click', async () => {
      const ctx = await getSelectedRow();
      if (!ctx) return;
      const { assessmentRow, rowLabel, activities } = ctx;

      resolveAndOpen(assessmentRow, activities, (autoKey, pickerHtml) => {
        const actKey = autoKey;
        const matches = buildMatches(assessmentRow, parsed_studentCols_cache, activities[actKey]);
        const matched = matches.filter(m => m.match).length;
        const alreadyFilled = matches.filter(m => m.input && m.input.value.trim() !== '').length;

        const rows = matches.map(m => {
          const existing = m.input ? m.input.value.trim() : '';
          const cls  = !m.match ? 'mns-no' : m.match.type === 'fuzzy' ? 'mns-fuz' : 'mns-ok';
          const icon = !m.match ? '❌' : m.match.type === 'fuzzy' ? '⚠' : '✓';
          const grade = m.match ? (m.match.student.grade || '—') : '—';
          const mName = m.match ? m.match.student.name : 'Not found';
          const existingNote = existing ? `<small style="color:#b05000"> (has: ${existing})</small>` : '';
          return `<tr class="${cls}"><td>${icon}</td><td>${m.novaName}${existingNote}</td><td>${mName}</td><td><b>${grade}</b></td></tr>`;
        }).join('');

        panel.innerHTML = `
          <div class="mns-ph">
            <span>Preview: ${rowLabel} &nbsp;(${matched}/${matches.length} matched)</span>
            <span class="mns-px" id="mns-close-panel">✕</span>
          </div>
          ${pickerHtml}
          <div style="padding:6px 12px;background:#fff8e1;border-bottom:1px solid #ffe082;font-size:11px;color:#555;display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="mns-skip-existing" checked>
            <label for="mns-skip-existing" style="cursor:pointer">
              Skip cells that already have a grade
              ${alreadyFilled ? `<b style="color:#b05000">(${alreadyFilled} filled)</b>` : ''}
            </label>
          </div>
          <table class="mns-tbl">
            <thead><tr><th></th><th>Nova Student</th><th>Moodle Match</th><th>Grade</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <button id="mns-go" style="background:#2a7a2a">✓ Fill ${matched} grade(s) into this row</button>
        `;
        panel.style.display = 'block';
        assessmentRow.row.classList.add('mns-hl');

        const pickerEl = document.getElementById('mns-act-picker');
        if (pickerEl) {
          pickerEl.value = autoKey;
          console.log(`[MNS] picker.value set to "${pickerEl.value}" (wanted "${autoKey}")`);
        }

        document.getElementById('mns-close-panel').onclick = () => {
          panel.style.display = 'none';
          assessmentRow.row.classList.remove('mns-hl');
        };

        if (Object.keys(activities).length > 1) {
          document.getElementById('mns-act-picker')?.addEventListener('change', (e) => {
            const newKey = e.target.value;
            const newMatches = buildMatches(assessmentRow, parsed_studentCols_cache, activities[newKey]);
            const tbody = panel.querySelector('tbody');
            tbody.innerHTML = newMatches.map(m => {
              const existing = m.input ? m.input.value.trim() : '';
              const cls  = !m.match ? 'mns-no' : m.match.type === 'fuzzy' ? 'mns-fuz' : 'mns-ok';
              const icon = !m.match ? '❌' : m.match.type === 'fuzzy' ? '⚠' : '✓';
              const grade = m.match ? (m.match.student.grade || '—') : '—';
              const mName = m.match ? m.match.student.name : 'Not found';
              const existingNote = existing ? `<small style="color:#b05000"> (has: ${existing})</small>` : '';
              return `<tr class="${cls}"><td>${icon}</td><td>${m.novaName}${existingNote}</td><td>${mName}</td><td><b>${grade}</b></td></tr>`;
            }).join('');
            const newMatched = newMatches.filter(m => m.match).length;
            document.getElementById('mns-go').textContent = `✓ Fill ${newMatched} grade(s) into this row`;
          });
        }

        document.getElementById('mns-go').onclick = () => {
          const skipExisting = document.getElementById('mns-skip-existing').checked;
          panel.style.display = 'none';
          assessmentRow.row.classList.remove('mns-hl');
          runFill(assessmentRow, rowLabel, activities, autoKey, skipExisting);
        };
      });
    });

    // ── Fill Now ──────────────────────────────────────────────────────────────
    document.getElementById('mns-fill-all-btn').addEventListener('click', async () => {
      const ctx = await getSelectedRow();
      if (!ctx) return;
      const { assessmentRow, rowLabel, activities } = ctx;

      resolveAndOpen(assessmentRow, activities, (autoKey, pickerHtml) => {
        const tempMatches = buildMatches(assessmentRow, parsed_studentCols_cache, activities[autoKey]);
        const wouldFill   = tempMatches.filter(m => m.match && m.match.student.grade && m.input).length;
        const alreadyFilled = tempMatches.filter(m => m.input && m.input.value.trim() !== '').length;

        panel.innerHTML = `
          <div class="mns-ph">
            <span>Fill Now — Confirm</span>
            <span class="mns-px" id="mns-close-panel">✕</span>
          </div>
          ${pickerHtml}
          <div style="padding:10px 14px;font-size:13px;line-height:1.6">
            <b>Nova row:</b> ${rowLabel}<br>
            <b>Students to fill:</b> ${wouldFill}
            ${alreadyFilled ? `<br><span style="color:#b05000">⚠ ${alreadyFilled} cells already have a grade</span>` : ''}
          </div>
          <div style="padding:6px 14px;background:#fff8e1;border-top:1px solid #ffe082;border-bottom:1px solid #ffe082;font-size:11px;color:#555">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" id="mns-fn-skip-existing" checked>
              Skip cells that already have a grade (recommended)
            </label>
          </div>
          <button id="mns-go" style="background:#c0392b">✓ Fill ${wouldFill} grades into "${assessmentRow.assessment}"</button>
        `;
        panel.style.display = 'block';
        assessmentRow.row.classList.add('mns-hl');

        document.getElementById('mns-close-panel').onclick = () => {
          panel.style.display = 'none';
          assessmentRow.row.classList.remove('mns-hl');
        };

        document.getElementById('mns-go').onclick = async () => {
          const skipExisting = document.getElementById('mns-fn-skip-existing').checked;
          panel.style.display = 'none';
          assessmentRow.row.classList.remove('mns-hl');
          await runFill(assessmentRow, rowLabel, activities, autoKey, skipExisting);
        };
      });
    });

    // ── Fill Student ──────────────────────────────────────────────────────────
    document.getElementById('mns-fill-stu-btn').addEventListener('click', async () => {
      const stored = await mnsGetValue(STORAGE_KEY, null);
      if (!stored) { flash('⚠ No captured Moodle grades — Capture on Moodle first.', '#b00', 0); return; }
      const stuSel = document.getElementById('mns-stu-select');
      const stuIdx = parseInt(stuSel.value, 10);
      if (isNaN(stuIdx)) { flash('⚠ Select a student from the student dropdown first.', '#b00'); return; }

      const payload = JSON.parse(stored);
      const parsed = parseTable();
      if (!parsed) { flash('⚠ Could not parse Nova table.', '#b00', 0); return; }
      parsed_studentCols_cache = parsed.studentCols;

      const studentCol = parsed.studentCols[stuIdx];
      const activities = getActivities(payload);

      const mappings = parsed.assessmentRows.map((assessmentRow, rowIdx) => {
        const actKey = matchActivity(assessmentRow.assessment, activities);
        const studentMatch = actKey ? findStudentMatch(studentCol.name, activities[actKey]) : null;
        const grade = studentMatch?.student.grade || '';
        const input = assessmentRow.cells[studentCol.colIndex]?.querySelector(SEL.gradeInput);
        const existing = input?.value.trim() || '';
        return { assessmentRow, rowIdx, actKey, grade, input, existing };
      }).filter(m => m.actKey);

      const toFill = mappings.filter(m => m.grade && m.input).length;
      const noGrade = mappings.filter(m => m.actKey && !m.grade).length;

      const tableRows = mappings.map(m => `
        <tr style="background:${m.grade ? '#f0fff0' : '#fffbe6'}">
          <td style="padding:3px 8px">${m.assessmentRow.course ? m.assessmentRow.course + ' › ' : ''}${m.assessmentRow.assessment}</td>
          <td style="padding:3px 8px;color:#555">${m.actKey}</td>
          <td style="padding:3px 8px;text-align:center">
            ${m.existing ? `<span style="color:#b05000;font-size:10px">${m.existing} → </span>` : ''}<b>${m.grade || '—'}</b>
          </td>
        </tr>`).join('');

      panel.innerHTML = `
        <div class="mns-ph">
          <span>Fill Student: ${studentCol.name} &nbsp;(${toFill} grades)</span>
          <span class="mns-px" id="mns-close-panel">✕</span>
        </div>
        <div style="padding:6px 12px;background:#fff8e1;border-bottom:1px solid #ffe082;font-size:11px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="mns-fs-skip" checked>Skip cells that already have a grade
          </label>
        </div>
        <table class="mns-tbl" style="font-size:11px">
          <thead><tr><th>Nova Row</th><th>Moodle Activity</th><th>Grade</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        ${noGrade ? `<div style="padding:4px 12px;font-size:10px;color:#888">⚠ ${noGrade} matched rows have no grade for this student in Moodle.</div>` : ''}
        <button id="mns-go" style="background:#2a7a2a">✓ Fill ${toFill} grade(s) for ${studentCol.name}</button>
      `;
      panel.style.display = 'block';
      document.getElementById('mns-close-panel').onclick = () => { panel.style.display = 'none'; };

      document.getElementById('mns-go').onclick = async () => {
        const skipExisting = document.getElementById('mns-fs-skip').checked;
        panel.style.display = 'none';
        hideUndoBtn();

        const stuTableEl = parsed.assessmentRows[0]?.row.closest('table');
        const colIndices = [studentCol.colIndex];
        const { promise: settlePromise, scoreRow } = createScoreSettleWatcher(stuTableEl);

        // Phase 1: 0 → 85%
        mnsProgress.show(`Filling grades for ${studentCol.name}…`);
        let filled = 0, skippedExisting = 0, processed = 0;
        for (const m of mappings) {
          if (!m.grade || !m.input) { processed++; }
          else { const wrote = setInputValue(m.input, m.grade, skipExisting); if (wrote) filled++; else skippedExisting++; processed++; }
          mnsProgressSetPct(Math.round((processed / mappings.length) * 85), `${processed} / ${mappings.length}`);
          if (processed % 4 === 0) await new Promise(r => setTimeout(r, 0));
        }

        // Phase 2: smooth RAF animation 85 → 99%; only hits 100% when observer quiesces
        document.getElementById('mns-progress-label').textContent = 'Calculating scores…';
        const cancelAnim = animateBar(85, 99, 5000, pct => mnsProgressSetPct(pct));

        await settlePromise;
        cancelAnim();
        mnsProgressSetPct(100, '✓ Done');
        await new Promise(r => setTimeout(r, 300));
        mnsProgress.hide();

        if (filled > 0) showUndoBtn(filled);
        highlightEmptyCells();
        mnsSummaryDialog({ filled, skippedExisting, skippedNoGrade: mappings.filter(m => m.actKey && !m.grade).length, unmatched: 0 }, studentCol.name);
      };
    });

    // ── Clear Student ─────────────────────────────────────────────────────────
    document.getElementById('mns-clear-stu-btn').addEventListener('click', () => {
      const stuSel = document.getElementById('mns-stu-select');
      const stuIdx = parseInt(stuSel.value, 10);
      if (isNaN(stuIdx)) { flash('⚠ Select a student from the dropdown first.', '#b00'); return; }

      const parsed = parseTable();
      if (!parsed) { flash('⚠ Could not parse Nova table.', '#b00', 0); return; }
      const studentCol = parsed.studentCols[stuIdx];

      const inputs = parsed.assessmentRows
        .map(r => r.cells[studentCol.colIndex]?.querySelector(SEL.gradeInput))
        .filter(inp => inp && inp.value.trim() !== '');

      panel.innerHTML = `
        <div class="mns-ph" style="background:#c0392b">
          <span>Clear Student: ${studentCol.name}</span>
          <span class="mns-px" id="mns-close-panel">✕</span>
        </div>
        <div style="padding:14px;font-size:13px;line-height:1.8">
          <b>${inputs.length}</b> grade cell(s) will be cleared for <b>${studentCol.name}</b>.<br>
          <span style="color:#c0392b;font-size:11px">⚠ Nova auto-saves — a page refresh will NOT undo this.</span><br>
          <span style="font-size:11px;color:#2a7a2a">↩ Undo button will appear so you can restore within this session.</span>
        </div>
        <button id="mns-go" style="background:#c0392b">✕ Clear ${inputs.length} cell(s) for ${studentCol.name}</button>
      `;
      panel.style.display = 'block';
      document.getElementById('mns-close-panel').onclick = () => { panel.style.display = 'none'; };
      document.getElementById('mns-go').onclick = () => {
        hideUndoBtn();
        let cleared = 0;
        for (const inp of inputs) { if (clearInputVal(inp)) cleared++; }
        panel.style.display = 'none';
        if (cleared > 0) showUndoBtn(cleared);
        flash(`↩ Cleared ${cleared} cell(s) for ${studentCol.name}. Use ↩ Undo to restore.`, '#7a5500', 10000);
      };
    });

    // ── Fill All (entire class) ───────────────────────────────────────────────
    document.getElementById('mns-fill-class-btn').addEventListener('click', async () => {
      const stored = await mnsGetValue(STORAGE_KEY, null);
      if (!stored) { flash('⚠ No captured Moodle grades — Capture on Moodle first.', '#b00', 0); return; }

      const payload = JSON.parse(stored);
      const parsed = parseTable();
      if (!parsed) { flash('⚠ Could not parse Nova table.', '#b00', 0); return; }
      parsed_studentCols_cache = parsed.studentCols;

      const activities = getActivities(payload);
      const actKeys = Object.keys(activities);

      // Nova-row-centric: for each Nova row, resolve the best Moodle activity
      // using per-course mapping (if configured) then falling back to auto-match.
      const mappings = parsed.assessmentRows.map((row, rowIdx) => {
        const actKey = resolveActivityForRow(row.course, row.assessment, activities);
        const gradesCount = actKey ? activities[actKey].filter(s => s.grade).length : 0;
        return { rowIdx, assessmentRow: row, actKey, gradesCount };
      });
      const matchedCount = mappings.filter(m => m.actKey).length;
      const totalGrades = mappings.reduce((sum, m) => sum + m.gradesCount, 0);

      const actOpts = selectedKey => [
        '<option value="">— skip —</option>',
        ...actKeys.map(k => `<option value="${k}" ${k === selectedKey ? 'selected' : ''}>${k}</option>`)
      ].join('');

      panel.innerHTML = `
        <div class="mns-ph">
          <span>Fill All — ${matchedCount}/${parsed.assessmentRows.length} rows matched</span>
          <span class="mns-px" id="mns-close-panel">✕</span>
        </div>
        <div style="padding:6px 14px;background:#f0f8ff;border-bottom:1px solid #b3d9f7;font-size:11px">
          Up to <b>${totalGrades}</b> grade entries across <b>${matchedCount}</b> rows.
          ${matchedCount < parsed.assessmentRows.length ? ` <span style="color:#b05000">⚠ ${parsed.assessmentRows.length - matchedCount} rows unmatched — adjust dropdowns or leave as — skip —.</span>` : ''}
        </div>
        <div style="padding:6px 12px;background:#fff8e1;border-bottom:1px solid #ffe082;font-size:11px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" id="mns-fa-skip" checked>Skip cells that already have a grade (recommended)
          </label>
        </div>
        <table class="mns-tbl" style="font-size:11px">
          <thead><tr><th>Nova Row</th><th>Moodle Activity</th><th># Grades</th></tr></thead>
          <tbody>${mappings.map(m => `
            <tr style="background:${m.actKey ? '#f0fff0' : '#fff0f0'}">
              <td style="padding:3px 6px">${m.assessmentRow.course ? m.assessmentRow.course + ' › ' : ''}${m.assessmentRow.assessment}</td>
              <td style="padding:3px 6px">
                <select data-ri="${m.rowIdx}" class="mns-act-map-sel" style="font-size:11px;width:100%;padding:2px">
                  ${actOpts(m.actKey)}
                </select>
              </td>
              <td style="padding:3px 6px;text-align:center">${m.actKey ? m.gradesCount : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <button id="mns-go" style="background:#005f99">✓ Fill All Matched Activities</button>
      `;
      panel.style.display = 'block';
      document.getElementById('mns-close-panel').onclick = () => { panel.style.display = 'none'; };

      document.getElementById('mns-go').onclick = async () => {
        const skipExisting = document.getElementById('mns-fa-skip').checked;

        // Capture row→activity pairs BEFORE closing the panel
        const rowsToFill = [];
        panel.querySelectorAll('.mns-act-map-sel').forEach(selEl => {
          const rowIdx = parseInt(selEl.dataset.ri, 10);
          const actKey = selEl.value;
          if (!actKey) return;
          const assessmentRow = parsed.assessmentRows[rowIdx];
          const matches = buildMatches(assessmentRow, parsed.studentCols, activities[actKey]);
          rowsToFill.push({ assessmentRow, actKey, matches });
        });

        panel.style.display = 'none';
        hideUndoBtn();

        const faTableEl = rowsToFill[0]?.assessmentRow.row.closest('table');
        const colIndices = parsed.studentCols.map(c => c.colIndex);
        // Observer starts BEFORE any fill so synchronous Score: mutations are captured
        const { promise: settlePromise, scoreRow } = createScoreSettleWatcher(faTableEl);

        const totalCells = rowsToFill.reduce((s, r) => s + r.matches.length, 0);
        // Phase 1: fill all rows → bar 0 → 85%
        mnsProgress.show(`Filling ${rowsToFill.length} rows…`);

        let totalFilled = 0, totalSkipExist = 0, totalSkipNoGrade = 0, totalUnmatched = 0;
        let cellsDone = 0;

        for (let i = 0; i < rowsToFill.length; i++) {
          const { assessmentRow, actKey, matches } = rowsToFill[i];
          document.getElementById('mns-progress-label').textContent =
            `Row ${i + 1}/${rowsToFill.length}: ${assessmentRow.assessment}…`;
          const result = await fillRowAsync(matches, skipExisting, done => {
            mnsProgressSetPct(Math.round(((cellsDone + done) / totalCells) * 85), `${cellsDone + done} / ${totalCells}`);
          });
          cellsDone += matches.length;
          totalFilled      += result.filled;
          totalSkipExist   += result.skippedExisting;
          totalSkipNoGrade += result.skippedNoGrade;
          totalUnmatched   += result.unmatched;
        }

        // Phase 2: smooth RAF animation 85 → 99%; only hits 100% when observer quiesces
        document.getElementById('mns-progress-label').textContent = 'Calculating scores…';
        const cancelAnim = animateBar(85, 99, 5000, pct => mnsProgressSetPct(pct));

        await settlePromise;
        cancelAnim();
        mnsProgressSetPct(100, '✓ Done');
        await new Promise(r => setTimeout(r, 300));
        mnsProgress.hide();

        if (totalFilled > 0) showUndoBtn(totalFilled);
        highlightEmptyCells();
        mnsSummaryDialog(
          { filled: totalFilled, skippedExisting: totalSkipExist, skippedNoGrade: totalSkipNoGrade, unmatched: totalUnmatched },
          `Fill All (${rowsToFill.length} rows)`
        );
      };
    });

    // ── Clear All (entire class) ──────────────────────────────────────────────
    document.getElementById('mns-clear-class-btn').addEventListener('click', () => {
      const parsed = parseTable();
      if (!parsed) { flash('⚠ Could not parse Nova table.', '#b00', 0); return; }

      const allInputs = [];
      for (const assessmentRow of parsed.assessmentRows) {
        for (const studentCol of parsed.studentCols) {
          const inp = assessmentRow.cells[studentCol.colIndex]?.querySelector(SEL.gradeInput);
          if (inp && inp.value.trim() !== '') allInputs.push(inp);
        }
      }

      panel.innerHTML = `
        <div class="mns-ph" style="background:#c0392b">
          <span>Clear All Grades — Confirmation</span>
          <span class="mns-px" id="mns-close-panel">✕</span>
        </div>
        <div style="padding:14px;font-size:13px;line-height:1.8">
          <b style="color:#c0392b">⚠ This will clear ALL ${allInputs.length} filled grade cells across all students and rows.</b><br>
          <span style="font-size:11px;color:#555">Nova auto-saves — a page refresh will NOT undo this.</span><br>
          <span style="font-size:11px;color:#2a7a2a">↩ Undo button will appear so you can restore within this session.</span>
        </div>
        <button id="mns-go" style="background:#c0392b">✕ Clear All ${allInputs.length} grade cells</button>
      `;
      panel.style.display = 'block';
      document.getElementById('mns-close-panel').onclick = () => { panel.style.display = 'none'; };
      document.getElementById('mns-go').onclick = () => {
        hideUndoBtn();
        let cleared = 0;
        for (const inp of allInputs) { if (clearInputVal(inp)) cleared++; }
        panel.style.display = 'none';
        if (cleared > 0) showUndoBtn(cleared);
        flash(`↩ Cleared ${cleared} grade cells. Use ↩ Undo to restore within this session.`, '#7a5500', 12000);
      };
    });

    // ── Init ──────────────────────────────────────────────────────────────────
    async function init() {
      const stored = await mnsGetValue(STORAGE_KEY, null);
      if (stored) {
        try {
          const d = JSON.parse(stored);
          const mins = Math.round((Date.now() - new Date(d.capturedAt).getTime()) / 60000);
          if (d.version === 'multi') {
            const actCount = Object.keys(d.activities).length;
            document.getElementById('mns-cap-info').textContent =
              `${actCount} activities captured · ${mins}m ago`;
          } else {
            document.getElementById('mns-cap-info').textContent =
              `"${d.activity}" · ${d.students.length} students · ${mins}m ago`;
          }
        } catch (_) {}
      }
      setTimeout(() => {
        const parsed = parseTable();
        if (!parsed) {
          console.warn('[MNS] Could not parse Nova table. Tables found:', document.querySelectorAll('table').length);
          return;
        }
        console.info(`[MNS] Nova parsed: ${parsed.studentCols.length} students, ${parsed.assessmentRows.length} assessment rows`);
        populateRowSelector(parsed.assessmentRows, parsed.studentCols);
      }, 800);
    }

    init();
  }

})();
