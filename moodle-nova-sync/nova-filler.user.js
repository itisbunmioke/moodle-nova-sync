// ==UserScript==
// @name         Nova Grade Filler ← Moodle Sync
// @namespace    moodle-nova-sync
// @version      2.0.0
// @description  Auto-fills Nova grade entry table (students=columns, assessments=rows) from Moodle capture
// @author       moodle-nova-sync
// @match        *://nova.williscollege.ca/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIGURATION
  // Nova's table: students are COLUMN headers, assessments are ROWS.
  //
  // Update these selectors if Nova's HTML changes.
  // Use F12 → Inspector to verify.
  // ─────────────────────────────────────────────────────────────────────────────
  const SEL = {
    // The main marks/grade table
    table: 'table',

    // Header row that contains student names as column headers
    // Nova shows: Course | Assessment | Type | Weight | Total | [Student names...]
    headerRow: 'thead tr, tr:first-child',

    // Within the header row: cells that contain student names
    // (we skip the first 5 fixed columns: Course, Assessment, Type, Weight, Total Points)
    fixedColCount: 5,

    // Each data row (one per assessment)
    dataRow: 'tbody tr, tr:not(:first-child)',

    // Within a data row: cell that shows the Assessment name (column index 1, 0-based)
    assessmentCell: 1, // 0=Course, 1=Assessment, 2=Type, 3=Weight, 4=TotalPoints

    // Within a data row: the input field inside a student's grade cell
    gradeInput: 'input',

    // Fuzzy match tolerance (Levenshtein distance) for name matching
    fuzzyTolerance: 2,
  };
  // ─────────────────────────────────────────────────────────────────────────────

  GM_addStyle(`
    #mns-bar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      background: #005f99; color: #fff; font-family: sans-serif;
      padding: 6px 14px; display: flex; align-items: center; gap: 10px;
      box-shadow: 0 2px 8px rgba(0,0,0,.35); font-size: 13px;
    }
    #mns-bar select {
      flex: 1; max-width: 320px; padding: 4px 8px; border-radius: 4px;
      border: none; font-size: 13px; background: #fff; color: #333;
    }
    #mns-bar .mns-btn {
      padding: 5px 14px; background: #fff; color: #005f99;
      font-weight: bold; border: none; border-radius: 4px;
      cursor: pointer; font-size: 13px; white-space: nowrap;
    }
    #mns-bar .mns-btn:hover { background: #d6eeff; }
    #mns-bar .mns-btn:disabled { background: #ccc; color: #888; cursor: not-allowed; }
    #mns-msg {
      position: fixed; top: 40px; right: 14px; z-index: 99999;
      padding: 6px 14px; border-radius: 4px; font-size: 12px;
      color: #fff; font-family: sans-serif; display: none; max-width: 340px;
    }
    body { padding-top: 38px !important; }

    /* Preview panel */
    #mns-panel {
      position: fixed; top: 44px; right: 14px; z-index: 99999;
      width: 380px; max-height: 480px; overflow-y: auto;
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
      background: #2a7a2a; color: #fff; font-weight: bold; font-size: 13px;
      border: none; border-radius: 4px; cursor: pointer;
    }
    #mns-go:hover { background: #1a5a1a; }
    .mns-hl { outline: 2px solid #e65c00 !important; background: #fff3e0 !important; }
    .mns-filled { background: #d4f5d4 !important; }
  `);

  // ── Build toolbar ─────────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.id = 'mns-bar';
  bar.innerHTML = `
    <span style="font-weight:bold;white-space:nowrap">⬇ Nova Sync</span>
    <select id="mns-row-select"><option value="">— select assessment row —</option></select>
    <button class="mns-btn" id="mns-preview-btn" disabled>Preview</button>
    <button class="mns-btn" id="mns-fill-all-btn" disabled title="Fill all assessment rows automatically">Fill All</button>
    <span id="mns-cap-info" style="font-size:11px;opacity:.8"></span>
  `;
  document.body.prepend(bar);

  const msgEl = document.createElement('div');
  msgEl.id = 'mns-msg';
  document.body.appendChild(msgEl);

  const panel = document.createElement('div');
  panel.id = 'mns-panel';
  document.body.appendChild(panel);

  function flash(text, color = '#2a7a2a', ms = 6000) {
    msgEl.textContent = text;
    msgEl.style.background = color;
    msgEl.style.display = 'block';
    clearTimeout(flash._t);
    flash._t = setTimeout(() => (msgEl.style.display = 'none'), ms);
  }

  // ── Name normalisation + fuzzy match ─────────────────────────────────────────
  function norm(raw) {
    const s = raw.replace(/\s+/g, ' ').trim();
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

  function findMatch(novaName, moodleStudents) {
    const key = norm(novaName);
    const exact = moodleStudents.find(s => s.normalizedName === key);
    if (exact) return { student: exact, type: 'exact' };
    let best = null, bestD = Infinity;
    for (const s of moodleStudents) {
      const d = levenshtein(key, s.normalizedName);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (bestD <= SEL.fuzzyTolerance) return { student: best, type: 'fuzzy', d: bestD };
    return null;
  }

  // ── Parse Nova's table structure ──────────────────────────────────────────────
  function parseTable() {
    // Find the main table
    const tables = document.querySelectorAll(SEL.table);
    let table = null;
    for (const t of tables) {
      // Pick the table that has the most columns (likely the marks grid)
      if (!table || t.rows[0]?.cells.length > table.rows[0]?.cells.length) {
        table = t;
      }
    }
    if (!table) return null;

    const rows = Array.from(table.rows);
    if (rows.length < 2) return null;

    // Header row: find the row that has the most cells AND contains student-like names
    // Nova layout: [Course, Assessment, Type, Weight, Total Points, Student1, Student2, ...]
    const headerRow = rows[0];
    const headerCells = Array.from(headerRow.cells);

    // Extract student names (skip first SEL.fixedColCount columns)
    const studentCols = [];
    for (let i = SEL.fixedColCount; i < headerCells.length; i++) {
      const name = headerCells[i].textContent.trim();
      if (name) studentCols.push({ name, colIndex: i, normalizedName: norm(name) });
    }

    // Extract assessment rows (skip header row)
    const assessmentRows = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = Array.from(rows[r].cells);
      if (cells.length < SEL.fixedColCount) continue;
      const course = cells[0]?.textContent.trim() || '';
      const assessment = cells[SEL.assessmentCell]?.textContent.trim() || '';
      const type = cells[2]?.textContent.trim() || '';
      if (!assessment) continue;
      assessmentRows.push({ rowIndex: r, row: rows[r], course, assessment, type, cells });
    }

    return { table, studentCols, assessmentRows };
  }

  // ── Populate assessment row selector ─────────────────────────────────────────
  function populateRowSelector(assessmentRows) {
    const sel = document.getElementById('mns-row-select');
    sel.innerHTML = '<option value="">— pick Nova assessment row to fill —</option>' +
      assessmentRows.map((a, i) =>
        `<option value="${i}">${a.course ? a.course + ' › ' : ''}${a.assessment} (${a.type})</option>`
      ).join('');
    document.getElementById('mns-preview-btn').disabled = false;
    document.getElementById('mns-fill-all-btn').disabled = false;
  }

  // ── Build match list for a single assessment row ──────────────────────────────
  function buildMatches(assessmentRow, studentCols, moodleStudents) {
    return studentCols.map(col => {
      const input = assessmentRow.cells[col.colIndex]?.querySelector(SEL.gradeInput) || null;
      const match = findMatch(col.name, moodleStudents);
      return { novaName: col.name, colIndex: col.colIndex, input, match };
    });
  }

  // ── Render preview panel ──────────────────────────────────────────────────────
  function showPreview(matches, rowLabel, onConfirm) {
    const rows = matches.map(m => {
      const cls = !m.match ? 'mns-no' : m.match.type === 'fuzzy' ? 'mns-fuz' : 'mns-ok';
      const icon = !m.match ? '❌' : m.match.type === 'fuzzy' ? '⚠' : '✓';
      const grade = m.match ? (m.match.student.grade || '—') : '—';
      const mName = m.match ? m.match.student.name : 'Not found';
      return `<tr class="${cls}"><td>${icon}</td><td>${m.novaName}</td><td>${mName}</td><td><b>${grade}</b></td></tr>`;
    }).join('');

    const matched = matches.filter(m => m.match).length;
    panel.innerHTML = `
      <div class="mns-ph">
        <span>Preview: ${rowLabel} &nbsp;(${matched}/${matches.length} matched)</span>
        <span class="mns-px" id="mns-close-panel">✕</span>
      </div>
      <table class="mns-tbl">
        <thead><tr><th></th><th>Nova Student</th><th>Moodle Match</th><th>Grade</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <button id="mns-go">✓ Fill ${matched} grade(s) into this row</button>
    `;
    panel.style.display = 'block';
    document.getElementById('mns-close-panel').onclick = () => (panel.style.display = 'none');
    document.getElementById('mns-go').onclick = () => { panel.style.display = 'none'; onConfirm(); };
  }

  // ── Fire native input events (works with React/Vue/Angular) ──────────────────
  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter ? setter.call(input, value) : (input.value = value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    input.classList.add('mns-filled');
  }

  // ── Fill a single assessment row ──────────────────────────────────────────────
  function fillRow(matches) {
    let filled = 0, skipped = 0, noInput = 0;
    matches.forEach(m => {
      if (!m.match) return;
      const grade = m.match.student.grade;
      if (!grade) { skipped++; return; }
      if (!m.input) { noInput++; return; }
      setInputValue(m.input, grade);
      filled++;
    });
    return { filled, skipped, noInput, unmatched: matches.filter(m => !m.match).length };
  }

  // ── Preview button ────────────────────────────────────────────────────────────
  document.getElementById('mns-preview-btn').addEventListener('click', async () => {
    const stored = await GM_getValue('mns_grades', null);
    if (!stored) { flash('⚠ No captured Moodle grades — open Moodle tab and click Capture first.', '#b00', 0); return; }

    const payload = JSON.parse(stored);
    const parsed = parseTable();
    if (!parsed) { flash('⚠ Could not parse Nova table. Check console (F12).', '#b00', 0); return; }

    const sel = document.getElementById('mns-row-select');
    const rowIdx = parseInt(sel.value, 10);
    if (isNaN(rowIdx)) { flash('⚠ Select an assessment row first.', '#b00'); return; }

    const assessmentRow = parsed.assessmentRows[rowIdx];
    const rowLabel = `${assessmentRow.course ? assessmentRow.course + ' › ' : ''}${assessmentRow.assessment}`;
    assessmentRow.row.classList.add('mns-hl');

    const matches = buildMatches(assessmentRow, parsed.studentCols, payload.students);

    showPreview(matches, rowLabel, () => {
      assessmentRow.row.classList.remove('mns-hl');
      const result = fillRow(matches);
      flash(
        `✓ Filled ${result.filled} grades in "${rowLabel}"` +
        (result.unmatched ? ` · ⚠ ${result.unmatched} unmatched` : '') +
        (result.noInput ? ` · ${result.noInput} had no input field` : ''),
        result.filled > 0 ? '#2a7a2a' : '#b00', 8000
      );
      if (result.unmatched) {
        const unmatched = matches.filter(m => !m.match).map(m => m.novaName);
        console.warn('[MNS] Unmatched students:', unmatched);
      }
      GM_notification({ title: 'Nova Fill Done', text: `${result.filled} grades filled in "${rowLabel}"`, timeout: 4000 });
    });
  });

  // ── Fill All button — fills every assessment row that has a matching Moodle grade ──
  document.getElementById('mns-fill-all-btn').addEventListener('click', async () => {
    const stored = await GM_getValue('mns_grades', null);
    if (!stored) { flash('⚠ No captured grades. Run Capture on Moodle first.', '#b00', 0); return; }

    const payload = JSON.parse(stored);
    const parsed = parseTable();
    if (!parsed) { flash('⚠ Could not parse Nova table. Check console (F12).', '#b00', 0); return; }

    let totalFilled = 0;
    for (const ar of parsed.assessmentRows) {
      const matches = buildMatches(ar, parsed.studentCols, payload.students);
      const hasGrades = matches.some(m => m.match && m.match.student.grade);
      if (!hasGrades) continue;
      const result = fillRow(matches);
      totalFilled += result.filled;
    }

    flash(
      totalFilled > 0
        ? `✓ Fill All complete — ${totalFilled} cells filled across all assessment rows`
        : '⚠ Fill All found no matching grades to fill. Check activity name in dropdown.',
      totalFilled > 0 ? '#2a7a2a' : '#b00', 8000
    );
    GM_notification({ title: 'Nova Fill All Done', text: `${totalFilled} cells filled`, timeout: 4000 });
    console.info('[MNS] Fill All complete. Filled:', totalFilled);
  });

  // ── Init on page load ─────────────────────────────────────────────────────────
  async function init() {
    const stored = await GM_getValue('mns_grades', null);
    if (stored) {
      try {
        const d = JSON.parse(stored);
        const mins = Math.round((Date.now() - new Date(d.capturedAt).getTime()) / 60000);
        document.getElementById('mns-cap-info').textContent =
          `${d.students.length} students from "${d.activity}" · ${mins}m ago`;
      } catch (_) { /* ignore */ }
    }

    // Wait for table to render then parse
    setTimeout(() => {
      const parsed = parseTable();
      if (!parsed) {
        console.warn('[MNS] Could not parse Nova table on init. Tables found:', document.querySelectorAll('table').length);
        document.querySelectorAll('table').forEach((t, i) =>
          console.warn(`[MNS] Table ${i}: ${t.rows.length} rows × ${t.rows[0]?.cells.length} cols`));
        return;
      }
      console.info(`[MNS] Nova table parsed: ${parsed.studentCols.length} students, ${parsed.assessmentRows.length} assessment rows`);
      console.info('[MNS] Students detected:', parsed.studentCols.map(s => s.name));
      populateRowSelector(parsed.assessmentRows);
    }, 800);
  }

  init();

})();
