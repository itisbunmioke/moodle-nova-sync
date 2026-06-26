// @ts-nocheck
// Load saved settings into the form on page open
chrome.storage.sync.get({
  moodleHost:     'students.willisonline.ca',
  novaHost:       'nova.williscollege.ca',
  fixedColCount:  5,
  assessmentCell: 1,
  courseMappings: {},
}, (cfg) => {
  document.getElementById('moodleHost').value     = cfg.moodleHost;
  document.getElementById('novaHost').value       = cfg.novaHost;
  document.getElementById('fixedColCount').value  = cfg.fixedColCount;
  document.getElementById('assessmentCell').value = cfg.assessmentCell;
  document.getElementById('courseMappings').value =
    Object.keys(cfg.courseMappings).length ? JSON.stringify(cfg.courseMappings, null, 2) : '';
});

// Save settings when the button is clicked
document.getElementById('save').addEventListener('click', () => {
  const moodleHost     = document.getElementById('moodleHost').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const novaHost       = document.getElementById('novaHost').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const fixedColCount  = parseInt(document.getElementById('fixedColCount').value, 10);
  const assessmentCell = parseInt(document.getElementById('assessmentCell').value, 10);
  const mappingsRaw    = document.getElementById('courseMappings').value.trim();

  const status = document.getElementById('status');

  if (!moodleHost || !novaHost) {
    status.textContent = '⚠ Please fill in both the Moodle and Nova addresses.';
    status.className = 'err';
    status.style.display = 'block';
    return;
  }
  if (isNaN(fixedColCount) || isNaN(assessmentCell)) {
    status.textContent = '⚠ Column count and cell index must be numbers.';
    status.className = 'err';
    status.style.display = 'block';
    return;
  }

  let courseMappings = {};
  if (mappingsRaw && mappingsRaw !== '{}') {
    try {
      courseMappings = JSON.parse(mappingsRaw);
      if (typeof courseMappings !== 'object' || Array.isArray(courseMappings)) throw new Error();
    } catch (_) {
      status.textContent = '⚠ Course Mappings is not valid JSON. Check the format and try again.';
      status.className = 'err';
      status.style.display = 'block';
      return;
    }
  }

  chrome.storage.sync.set({ moodleHost, novaHost, fixedColCount, assessmentCell, courseMappings }, () => {
    status.textContent = '✓ Settings saved! Reload your Moodle and Nova tabs for changes to take effect.';
    status.className = 'ok';
    status.style.display = 'block';
    document.getElementById('moodleHost').value = moodleHost;
    document.getElementById('novaHost').value   = novaHost;
    document.getElementById('courseMappings').value =
      Object.keys(courseMappings).length ? JSON.stringify(courseMappings, null, 2) : '';
  });
});
