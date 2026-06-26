// ==UserScript==
// @name         Moodle Grade Scraper → Nova Sync
// @namespace    moodle-nova-sync
// @version      2.0.0
// @description  Captures student grades from Moodle grader report and stores them for Nova auto-fill
// @author       moodle-nova-sync
// @match        *://students.willisonline.ca/grade/report/grader/*
// @match        *://students.willisonline.ca/mod/assign/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIGURATION — update selectors here if the page layout changes
  // ─────────────────────────────────────────────────────────────────────────────
  const SEL = {
    // Grader report: the main scrollable table wrapper
    tableWrapper: '.gradeparent, #user-grades, table.generaltable',
    // Each student row (has a data-uid or class "user")
    studentRow: 'tr[data-uid], tr.user',
    // Student name cell within a row
    studentName: 'th .username, th a, td.cell.c0 a, .userfullname',
    // Grade cells in the student row (all columns)
    gradeCell: 'td.cell[class*="grade"], td.grade',
    // Activity header cells in the top header row
    activityHeader: 'tr.heading th, thead tr th',
  };
  // ─────────────────────────────────────────────────────────────────────────────

  GM_addStyle(`
    #mns-bar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      background: #e65c00; color: #fff; font-family: sans-serif;
      padding: 6px 14px; display: flex; align-items: center; gap: 10px;
      box-shadow: 0 2px 8px rgba(0,0,0,.35); font-size: 13px;
    }
    #mns-bar select {
      flex: 1; max-width: 340px; padding: 4px 8px; border-radius: 4px;
      border: none; font-size: 13px; background: #fff; color: #333;
    }
    #mns-bar button {
      padding: 5px 14px; background: #fff; color: #e65c00;
      font-weight: bold; border: none; border-radius: 4px;
      cursor: pointer; font-size: 13px; white-space: nowrap;
    }
    #mns-bar button:hover { background: #ffe8d6; }
    #mns-bar button:disabled { background: #ccc; color: #888; cursor: not-allowed; }
    #mns-msg {
      position: fixed; top: 40px; right: 14px; z-index: 99999;
      padding: 6px 14px; border-radius: 4px; font-family: sans-serif;
      font-size: 12px; color: #fff; display: none; max-width: 320px;
    }
    body { padding-top: 38px !important; }
  `);

  // ── Build top bar ─────────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.id = 'mns-bar';
  bar.innerHTML = `
    <span style="white-space:nowrap;font-weight:bold">📋 Moodle→Nova</span>
    <select id="mns-col-select"><option value="">— detecting columns… —</option></select>
    <button id="mns-capture-btn" disabled>Capture</button>
    <span id="mns-stored-label" style="font-size:11px;opacity:.85"></span>
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

  // ── Name normalisation ────────────────────────────────────────────────────────
  function normalizeName(raw) {
    const s = raw.replace(/\s+/g, ' ').trim();
    if (s.includes(',')) {
      const [last, ...rest] = s.split(',').map(p => p.trim());
      return `${rest.join(' ')} ${last}`.toLowerCase();
    }
    return s.toLowerCase();
  }

  // ── Parse activity columns from the grader report header ─────────────────────
  function parseColumns() {
    // Moodle grader report: activity headers are in <th> cells in thead/header rows
    const headerRows = document.querySelectorAll(SEL.activityHeader);
    const cols = [];
    headerRows.forEach((th, i) => {
      const text = th.textContent.trim();
      if (text && text.length > 1 && !['First name', 'Last name', 'Email'].includes(text)) {
        cols.push({ index: i, label: text });
      }
    });
    return cols;
  }

  // ── Parse student rows and extract grade at a given column index ──────────────
  function parseStudents(colIndex) {
    const students = [];
    const rows = document.querySelectorAll(SEL.studentRow);

    rows.forEach(row => {
      const nameEl = row.querySelector(SEL.studentName);
      if (!nameEl) return;
      const rawName = nameEl.textContent.trim();
      if (!rawName || rawName.length < 2) return;

      // Get all grade cells in this row
      const cells = row.querySelectorAll(SEL.gradeCell);
      let grade = '';
      const targetCell = cells[colIndex] || cells[0];
      if (targetCell) {
        const input = targetCell.querySelector('input');
        const raw = input ? input.value : targetCell.textContent;
        // Extract numeric value; Moodle shows "85.00" or "85.00 (85.00 %)" or "10 (100 %)"
        const match = raw.match(/([\d.]+)/);
        grade = match ? match[1] : raw.trim();
      }

      students.push({ name: rawName, normalizedName: normalizeName(rawName), grade });
    });

    return students;
  }

  // ── Populate the column selector ──────────────────────────────────────────────
  function populateSelector() {
    const select = document.getElementById('mns-col-select');
    const btn = document.getElementById('mns-capture-btn');
    const cols = parseColumns();

    if (!cols.length) {
      select.innerHTML = '<option value="">⚠ No columns detected — check console (F12)</option>';
      console.warn('[MNS] Could not find activity header cells. Page HTML sample:',
        document.querySelector('table')?.outerHTML?.slice(0, 3000));
      return;
    }

    select.innerHTML = cols.map((c, i) =>
      `<option value="${i}">${c.label}</option>`
    ).join('');
    btn.disabled = false;
  }

  // ── Capture button ────────────────────────────────────────────────────────────
  document.getElementById('mns-capture-btn').addEventListener('click', async () => {
    const select = document.getElementById('mns-col-select');
    const colIndex = parseInt(select.value, 10);
    const colLabel = select.options[select.selectedIndex]?.text || 'Unknown';

    const students = parseStudents(colIndex);
    const valid = students.filter(s => s.name);

    if (!valid.length) {
      flash('⚠ No students found. Open F12 console for details.', '#b00');
      console.warn('[MNS] parseStudents returned 0 rows for colIndex', colIndex);
      console.warn('[MNS] Student rows found:', document.querySelectorAll(SEL.studentRow).length);
      return;
    }

    const payload = {
      activity: colLabel,
      students: valid,
      capturedAt: new Date().toISOString(),
      url: window.location.href,
    };

    await GM_setValue('mns_grades', JSON.stringify(payload));

    const withGrades = valid.filter(s => s.grade).length;
    flash(`✓ Captured ${valid.length} students (${withGrades} with grades) from "${colLabel}"`);

    document.getElementById('mns-stored-label').textContent =
      `Last: ${valid.length} students · ${colLabel}`;

    GM_notification({
      title: 'Moodle→Nova: Captured',
      text: `${valid.length} students from "${colLabel}"`,
      timeout: 4000,
    });

    console.info('[MNS] Captured payload:', payload);
  });

  // ── Show last captured label on load ─────────────────────────────────────────
  (async () => {
    const stored = await GM_getValue('mns_grades', null);
    if (stored) {
      try {
        const d = JSON.parse(stored);
        const mins = Math.round((Date.now() - new Date(d.capturedAt).getTime()) / 60000);
        document.getElementById('mns-stored-label').textContent =
          `Last: ${d.students.length} students · ${d.activity} · ${mins}m ago`;
      } catch (_) { /* ignore */ }
    }
    // Populate column selector after a short delay to ensure page table is rendered
    setTimeout(populateSelector, 800);
  })();

})();
