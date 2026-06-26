// ==UserScript==
// @name         Moodle → Nova Grade Sync
// @namespace    moodle-nova-sync
// @version      4.7.0
// @description  Captures grades from Moodle gradebook and pastes them into Nova grade entry. Configure the hostnames below before installing.
// @author       moodle-nova-sync
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/itisbunmioke/moodle-nova-sync/master/moodle-nova-sync/moodle-nova-sync.user.js
// @downloadURL  https://raw.githubusercontent.com/itisbunmioke/moodle-nova-sync/master/moodle-nova-sync/moodle-nova-sync.user.js
// ==/UserScript==
// @ts-nocheck

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════════
  //  CONFIGURATION  ←  The only section you need to edit before installing
  // ════════════════════════════════════════════════════════════════════════════

  // Moodle hostname — the part after https:// in your Moodle gradebook URL.
  // Example: if your Moodle URL is https://moodle.yourcollege.edu/grade/...
  //          set this to  'moodle.yourcollege.edu'
  const MOODLE_HOST = 'students.willisonline.ca';

  // Nova hostname — the part after https:// in your Nova grade-entry URL.
  // Example: 'nova.yourcollege.edu'
  const NOVA_HOST = 'nova.williscollege.ca';

  // Nova table layout — only change these if student columns or assessment
  // names are not detected correctly (see F12 console for warnings).
  //   fixedColCount  : number of non-student columns before student columns start
  //   assessmentCell : 0-based column index that holds the assessment/row name
  const NOVA_TABLE = {
    fixedColCount:  5,   // try 3, 4, or 6 if student columns are not found
    assessmentCell: 1,   // try 0 or 2 if assessment names are read incorrectly
  };

  // Per-course Nova-row → Moodle-column mapping (optional).
  // For courses where Moodle groups multiple activities into a single Nova row,
  // specify which Moodle column holds the pre-computed total/average for each row.
  // Keys are Nova course names (partial, case-insensitive match).
  // Values map Nova row names to the exact Moodle column name to use.
  // Leave as {} if all your courses use 1:1 name matching.
  //
  // Example:
  //   'Introduction to Computing': {
  //     'Assignment 1': 'Assignment 1 total',
  //     'Assignment 2': 'Assignment 2 total',
  //     'Quiz 1':       'Quiz 1 total',
  //     'Quiz 2':       'Quiz 2 total',
  //   },
  const COURSE_MAPPINGS = {
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  END OF CONFIGURATION — do not edit below this line unless you know JS
  // ════════════════════════════════════════════════════════════════════════════

  const IS_MOODLE = location.hostname === MOODLE_HOST;
  const IS_NOVA   = location.hostname === NOVA_HOST;

  // Exit immediately on every other website — no UI or processing is done.
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

    GM_addStyle(`
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

    // Restore collapsed state from previous session (GM_getValue is synchronous)
    if (GM_getValue('mns_moodle_bar_min', false)) {
      bar.classList.add('mns-minimized');
      document.getElementById('mns-min-btn').textContent = '▼ MNS';
    }

    document.getElementById('mns-min-btn').addEventListener('click', () => {
      const minimized = bar.classList.toggle('mns-minimized');
      document.getElementById('mns-min-btn').textContent = minimized ? '▼ MNS' : '▲ Hide';
      GM_setValue('mns_moodle_bar_min', minimized);
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
      // Single-capture stores a single-activity payload (still compatible with Nova Preview)
      const payload = {
        version: 'single',
        activity: colLabel,
        students: valid,
        capturedAt: new Date().toISOString(),
        url: window.location.href,
      };
      await GM_setValue(STORAGE_KEY, JSON.stringify(payload));
      const withGrades = valid.filter(s => s.grade).length;
      flash(`✓ Captured ${valid.length} students (${withGrades} with grades) from "${colLabel}"`);
      document.getElementById('mns-stored-label').textContent =
        `Stored: "${colLabel}" · ${valid.length} students`;
      GM_notification({
        title: 'Moodle→Nova: Captured',
        text: `${valid.length} students from "${colLabel}"`,
        timeout: 4000,
      });
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
        const students = parseStudents(col); // passes { colClass, colIndex, label }
        const valid = students.filter(s => s.name);
        activities[col.label] = valid;
        totalWithGrades += valid.filter(s => s.grade).length;
      }

      const activityCount = Object.keys(activities).length;
      // Count total unique students (use first activity that has students)
      const firstKey = Object.keys(activities)[0];
      const studentCount = firstKey ? activities[firstKey].length : 0;

      const payload = {
        version: 'multi',
        activities,
        capturedAt: new Date().toISOString(),
        url: window.location.href,
      };

      await GM_setValue(STORAGE_KEY, JSON.stringify(payload));

      btnAll.disabled = false;
      btnAll.textContent = 'Capture All';

      flash(`✓ Captured All: ${activityCount} activities, ${studentCount} students, ${totalWithGrades} grade entries`);
      document.getElementById('mns-stored-label').textContent =
        `Stored: ${activityCount} activities · ${studentCount} students`;

      GM_notification({
        title: 'Moodle→Nova: Captured All',
        text: `${activityCount} activities, ${studentCount} students`,
        timeout: 4000,
      });
      console.info('[MNS] Capture All payload:', payload);
    });

    // ── Show stored info on load ──────────────────────────────────────────────
    (async () => {
      const stored = await GM_getValue(STORAGE_KEY, null);
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
      fixedColCount:  NOVA_TABLE.fixedColCount,
      assessmentCell: NOVA_TABLE.assessmentCell,
      gradeInput:     'input',
      fuzzyTolerance: 2,
    };

    GM_addStyle(`
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
        display: none; position: fixed; bottom: 28px; left: 50%;
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
        height: 11px; border-radius: 99px;
        background: rgba(255,255,255,0.14);
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.35); overflow: hidden;
      }
      #mns-progress-fill {
        height: 100%; width: 0%; border-radius: 99px;
        background: linear-gradient(90deg,#ff8c00,#ffd700);
        transition: width 0.10s ease-out;
        box-shadow: 0 0 10px rgba(255,180,0,0.60);
      }
      @keyframes mns-pb-pulse {
        0%, 100% { box-shadow: 0 0 10px rgba(255,180,0,0.60); opacity: 1; }
        50%       { box-shadow: 0 0 26px rgba(255,210,60,0.95); opacity: 0.68; }
      }
      #mns-progress-fill.mns-pb-pulsing {
        animation: mns-pb-pulse 0.95s ease-in-out infinite;
        transition: none;
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
      '<div id="mns-progress-track"><div id="mns-progress-fill"></div></div>' +
      '<div id="mns-progress-count"></div>';
    document.body.appendChild(progressEl);

    const summaryEl = document.createElement('div');
    summaryEl.id = 'mns-summary';
    document.body.appendChild(summaryEl);

    const mnsProgress = {
      show(label, total) {
        document.getElementById('mns-progress-label').textContent = label;
        document.getElementById('mns-progress-fill').style.width = '0%';
        document.getElementById('mns-progress-count').textContent = `0 / ${total}`;
        progressEl.style.display = 'block';
      },
      update(done, total) {
        const pct = total > 0 ? Math.round((done / total) * 100) : 100;
        document.getElementById('mns-progress-fill').style.width = pct + '%';
        document.getElementById('mns-progress-count').textContent = `${done} / ${total}`;
      },
      hide() { progressEl.style.display = 'none'; },
    };

    function mnsSummaryDialog(result, label) {
      const { filled, skippedExisting = 0, skippedNoGrade = 0, unmatched = 0 } = result;
      const titleColor = filled > 0 ? '#7edd8a' : '#ff7070';
      const titleIcon  = filled > 0 ? '✓' : '⚠';
      const titleText  = filled > 0
        ? `${filled} grade${filled !== 1 ? 's' : ''} filled${label ? ' — ' + label : ''}`
        : `No grades filled${label ? ' — ' + label : ''}`;
      const noChangeNote = filled === 0
        ? `<div style="margin-top:11px;padding:9px 12px;background:rgba(255,200,60,0.14);border:1px solid rgba(255,200,60,0.28);border-radius:8px;font-size:12px;color:#ffd08a">No changes were made. Would you like to re-confirm the student's grade(s) from Moodle before filling again?</div>`
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

    // Waits until the Score: row (or the full table as fallback) stops receiving
    // DOM mutations for quiesceMs — meaning Nova's weighted-score calculation has settled.
    function waitForScoreRowToSettle(tableEl, quiesceMs = 700, timeoutMs = 12000) {
      const targetEl = findScoreRow(tableEl) || tableEl;
      return new Promise(resolve => {
        if (!targetEl) { setTimeout(resolve, quiesceMs); return; }
        let timer = setTimeout(() => { observer.disconnect(); resolve(); }, quiesceMs);
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => { observer.disconnect(); resolve(); }, quiesceMs);
        });
        observer.observe(targetEl, { subtree: true, childList: true, characterData: true, attributes: true });
        setTimeout(() => { clearTimeout(timer); observer.disconnect(); resolve(); }, timeoutMs);
      });
    }

    function mnsProgressSettle(label) {
      document.getElementById('mns-progress-label').textContent = label;
      document.getElementById('mns-progress-fill').classList.add('mns-pb-pulsing');
    }

    function mnsProgressDone() {
      document.getElementById('mns-progress-fill').classList.remove('mns-pb-pulsing');
      progressEl.style.display = 'none';
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
      //    cap the score at 0.49 so any exact-number match (scored ≥ 0.5 or 1.0)
      //    always ranks above it.  This covers levSim/collSim paths too, which are
      //    character-level and blind to the numeric-exact requirement above.
      //    e.g. "quiz 11" vs "lesson 1 quiz" → numbers {11} ∩ {1} = ∅ → cap 0.49
      //         "quiz 11" vs "lesson 11 quiz" → {11} ∩ {11} = {11} → no cap → 1.0
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

      // 3. Similarity scoring — same three-strategy function used for student names.
      //    Token overlap correctly handles "Quiz 1" ↔ "Lesson 1 Quiz" (shared tokens
      //    "quiz" and "1" → 100% overlap) while still distinguishing Quiz 1 from Quiz 2.
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
    // Checks COURSE_MAPPINGS for an explicit Nova-row → Moodle-column override
    // before falling back to automatic name matching.
    function resolveActivityForRow(course, novaRow, activities) {
      if (course) {
        const courseKey = Object.keys(COURSE_MAPPINGS).find(k =>
          course.toLowerCase().includes(k.toLowerCase()) ||
          k.toLowerCase().includes(course.toLowerCase())
        );
        if (courseKey) {
          const rowMap = COURSE_MAPPINGS[courseKey];
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
    let undoStack = []; // [{ input, previousValue }]

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
      if (skipExisting && previousValue !== '') return false; // cell already has data
      // Back up before overwriting
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

    // Restore collapsed state from previous session (GM_getValue is synchronous)
    if (GM_getValue('mns_nova_bar_min', false)) {
      bar.classList.add('mns-minimized');
      document.getElementById('mns-min-btn').textContent = '▼ MNS';
    }

    document.getElementById('mns-min-btn').addEventListener('click', () => {
      const minimized = bar.classList.toggle('mns-minimized');
      document.getElementById('mns-min-btn').textContent = minimized ? '▼ MNS' : '▲ Hide';
      GM_setValue('mns_nova_bar_min', minimized);
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

        // Score every Moodle activity against the selected Nova row label,
        // then sort best-first so the dropdown always lists best candidates at top.
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

        // Diagnostic log — open F12 console to verify the match
        console.group(`[MNS] Preview match for "${assessmentRow.assessment}" (norm="${normRow}")`);
        scored.forEach(e => console.log(`  ${e.sim.toFixed(3)}  "${e.key}"  (norm="${e.nk}")`));
        console.log(`→ autoKey = "${autoKey}"  [${mappedKey ? 'course-mapping' : scored.find(e=>e.nk===normRow) ? 'exact' : scored.find(e=>e.nk.startsWith(normRow)||normRow.startsWith(e.nk)) ? 'prefix' : 'best-sim'}]`);
        console.groupEnd();
      }

      // Build activity picker HTML (only shown when >1 activity captured).
      // Options are rendered in scored order so the best match is at the top.
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

      mnsProgress.show(`Filling "${rowLabel}"…`, matches.length);
      const result = await fillRowAsync(matches, skipExisting, done => mnsProgress.update(done, matches.length));
      mnsProgress.update(matches.length, matches.length);

      mnsProgressSettle('Calculating scores…');
      await waitForScoreRowToSettle(assessmentRow.row.closest('table'));
      mnsProgressDone();

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
      GM_notification({ title: 'Nova Fill Done', text: `${result.filled} grades filled`, timeout: 4000 });
      return { matches, actKey };
    }

    // Cache for studentCols across async calls
    let parsed_studentCols_cache = [];

    // ── Shared: get & validate row selection ─────────────────────────────────
    async function getSelectedRow() {
      const stored = await GM_getValue(STORAGE_KEY, null);
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

        // Explicitly set the picker value after DOM insertion — the `selected`
        // attribute in an innerHTML string is not reliably honoured by all browsers.
        const pickerEl = document.getElementById('mns-act-picker');
        if (pickerEl) {
          pickerEl.value = autoKey;
          console.log(`[MNS] picker.value set to "${pickerEl.value}" (wanted "${autoKey}")`);
        }

        document.getElementById('mns-close-panel').onclick = () => {
          panel.style.display = 'none';
          assessmentRow.row.classList.remove('mns-hl');
        };

        // Re-render table when activity picker changes
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
    // Iterates all Nova assessment rows (same direction as Preview) and fills
    // only the selected student's cell in each matched row.
    document.getElementById('mns-fill-stu-btn').addEventListener('click', async () => {
      const stored = await GM_getValue(STORAGE_KEY, null);
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
      const actKeys = Object.keys(activities);

      // Iterate Nova rows → find Moodle activity (same reliable direction as Preview)
      const mappings = parsed.assessmentRows.map((assessmentRow, rowIdx) => {
        const actKey = matchActivity(assessmentRow.assessment, activities);
        const studentMatch = actKey ? findStudentMatch(studentCol.name, activities[actKey]) : null;
        const grade = studentMatch?.student.grade || '';
        const input = assessmentRow.cells[studentCol.colIndex]?.querySelector(SEL.gradeInput);
        const existing = input?.value.trim() || '';
        return { assessmentRow, rowIdx, actKey, grade, input, existing };
      }).filter(m => m.actKey); // skip rows with no matching activity

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

        mnsProgress.show(`Filling grades for ${studentCol.name}…`, mappings.length);
        let filled = 0, skippedExisting = 0, processed = 0;
        for (const m of mappings) {
          if (!m.grade || !m.input) { processed++; mnsProgress.update(processed, mappings.length); continue; }
          const wrote = setInputValue(m.input, m.grade, skipExisting);
          if (wrote) filled++; else skippedExisting++;
          processed++;
          mnsProgress.update(processed, mappings.length);
          if (processed % 4 === 0) await new Promise(r => setTimeout(r, 0));
        }
        mnsProgress.update(mappings.length, mappings.length);

        mnsProgressSettle('Calculating scores…');
        const stuTableEl = parsed.assessmentRows[0]?.row.closest('table');
        await waitForScoreRowToSettle(stuTableEl);
        mnsProgressDone();

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
      const stored = await GM_getValue(STORAGE_KEY, null);
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

        const totalCells = rowsToFill.reduce((s, r) => s + r.matches.length, 0);
        mnsProgress.show(`Filling ${rowsToFill.length} rows…`, totalCells);

        let totalFilled = 0, totalSkipExist = 0, totalSkipNoGrade = 0, totalUnmatched = 0;
        let cellsDone = 0;

        for (let i = 0; i < rowsToFill.length; i++) {
          const { assessmentRow, actKey, matches } = rowsToFill[i];
          document.getElementById('mns-progress-label').textContent =
            `Row ${i + 1}/${rowsToFill.length}: ${assessmentRow.assessment}…`;
          const result = await fillRowAsync(matches, skipExisting, done => {
            mnsProgress.update(cellsDone + done, totalCells);
          });
          cellsDone += matches.length;
          totalFilled      += result.filled;
          totalSkipExist   += result.skippedExisting;
          totalSkipNoGrade += result.skippedNoGrade;
          totalUnmatched   += result.unmatched;
        }

        mnsProgress.update(totalCells, totalCells);

        mnsProgressSettle('Calculating scores…');
        const faTableEl = rowsToFill[0]?.assessmentRow.row.closest('table');
        await waitForScoreRowToSettle(faTableEl);
        mnsProgressDone();

        if (totalFilled > 0) showUndoBtn(totalFilled);
        highlightEmptyCells();
        mnsSummaryDialog(
          { filled: totalFilled, skippedExisting: totalSkipExist, skippedNoGrade: totalSkipNoGrade, unmatched: totalUnmatched },
          `Fill All (${rowsToFill.length} rows)`
        );
        GM_notification({ title: 'Nova Fill All Done', text: `${totalFilled} grades filled`, timeout: 4000 });
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
        GM_notification({ title: 'Nova Clear All Done', text: `${cleared} cells cleared`, timeout: 4000 });
      };
    });

    // ── Init ──────────────────────────────────────────────────────────────────
    async function init() {
      const stored = await GM_getValue(STORAGE_KEY, null);
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
