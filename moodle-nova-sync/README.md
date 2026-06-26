# Moodle → Nova Grade Sync

Tampermonkey userscripts that eliminate manual grade entry between Moodle and NOVA.

**How it works:**
1. On Moodle → click **"Capture Grades"** → grades saved in browser storage
2. On Nova → click **"Paste Grades (N)"** → preview table appears → confirm → inputs auto-filled

No API keys, no admin access, no server needed. Runs entirely in the browser.

---

## Requirements

- Access to the remote machine via RustDesk (where Moodle/Nova are open)
- Chrome browser on that remote machine
- [Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) extension installed

---

## Installation (do this on the REMOTE machine via RustDesk)

### Step 1 — Install Tampermonkey
1. Open Chrome on the remote machine
2. Go to the Chrome Web Store: search **"Tampermonkey"**
3. Click **Add to Chrome** → confirm
4. Pin Tampermonkey to the toolbar (puzzle icon → pin)

### Step 2 — Add the Moodle Scraper script
1. Click the Tampermonkey icon → **Dashboard**
2. Click the **+** tab (New Script)
3. Delete all placeholder code
4. Open `moodle-scraper.user.js` from this folder → copy all content → paste into editor
5. **Update the `@match` lines** at the top to your Moodle domain:
   ```
   // @match  *://moodle.yourinstitution.edu/*
   ```
6. Click **File → Save** (or Ctrl+S)

### Step 3 — Add the Nova Filler script
1. Click **+** again in Tampermonkey Dashboard
2. Delete placeholder code
3. Open `nova-filler.user.js` → copy all content → paste
4. **Update the `@match` line** to your Nova domain:
   ```
   // @match  *://nova.yourinstitution.edu/*
   ```
5. Save

---

## Usage

### Capturing grades from Moodle
1. Log in to Moodle → go to a course gradebook  
   (`/grade/report/grader/index.php?id=COURSE_ID`)  
   or an assignment grading table  
   (`/mod/assign/view.php?id=ASSIGN_ID&action=grading`)
2. An orange **"📋 Capture Grades"** button appears top-right
3. Click it → a notification confirms e.g. **"Captured 28 students"**

### Filling grades into Nova
1. Log in to Nova → navigate to the grade entry page for the same cohort
2. A blue **"⬇ Paste Grades (28)"** button appears top-right
3. Click it → a **preview table** pops up showing:
   - ✓ green rows = exact match
   - ⚠ yellow rows = fuzzy match (name spelling slightly different)
   - ❌ red rows = no match found
4. Review the matches → click **"✓ Fill N Grade(s) into Nova"**
5. Inputs turn green as they're filled
6. **Do not submit** until you visually spot-check a few rows

---

## Tuning Selectors

If the button appears but "Capture" / "Fill" finds 0 students, the CSS selectors need updating.

### Finding Moodle selectors
1. Open Moodle gradebook → press **F12** → Elements tab
2. Click the **Inspector picker** (top-left of DevTools) → hover over a student name → note the tag/class
3. Do the same for a grade cell
4. Open `moodle-scraper.user.js` in Tampermonkey editor → update `CONFIG.gradebook`:
   ```js
   const CONFIG = {
     gradebook: {
       rowSelector: 'tr.user',           // ← change this
       nameSelector: 'td.cell.c0 a',     // ← and this
       gradeSelector: 'td.cell.grade',   // ← and this
     },
   };
   ```
5. Save → refresh Moodle → retry

### Finding Nova selectors
1. Open Nova grade entry → press **F12** → Elements
2. Hover over a student name cell → note selector (e.g. `td.studentname`)
3. Hover over the grade input → note selector (e.g. `input.scorefield`)
4. Open `nova-filler.user.js` in Tampermonkey editor → update `CONFIG`:
   ```js
   const CONFIG = {
     rowSelector: 'tr',                      // ← each student row
     nameSelector: 'td.studentname',         // ← student name cell
     gradeInputSelector: 'input.scorefield', // ← grade input
   };
   ```
5. Save → refresh Nova → retry

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Button doesn't appear | Check `@match` URL pattern matches the page URL exactly |
| "No students found" | Update `rowSelector` / `nameSelector` in CONFIG — see Tuning Selectors above |
| Students captured but grade is empty | Moodle gradebook may be in view-only mode; switch to edit mode, or check `gradeSelector` |
| Nova inputs don't stay filled | Nova may use a JS framework that resets values — open browser console and check for errors |
| Names don't match | Check console for unmatched names; increase `fuzzyTolerance` in `nova-filler.user.js` (try `3` or `4`) |

### Useful console commands (F12 → Console on Nova page)
```js
// See what was captured from Moodle:
JSON.parse(await GM.getValue('mns_grades'))
```

---

## Files

```
moodle-nova-sync/
├── moodle-scraper.user.js   — install on remote Chrome via Tampermonkey
├── nova-filler.user.js      — install on remote Chrome via Tampermonkey
└── README.md                — this file
```
