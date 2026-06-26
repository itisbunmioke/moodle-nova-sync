# Moodle → Nova Grade Sync — Chrome / Edge Extension

**Version:** 4.6.0
**Author:** Bunmi Oke (Work: bunmi.oke@williscollege.ca; Personal: itisbunmioke@gmail.com)
**Purpose:** Eliminates manual copy-paste of grades from Moodle's gradebook into the Nova student information system. Instructors capture grades in one click on Moodle and fill them in one click on Nova.

---

## Table of Contents

1. [How It Works](#1-how-it-works)
2. [What the Extension Does and Does Not Do](#2-what-the-extension-does-and-does-not-do)
3. [File Structure](#3-file-structure)
4. [Individual Installation (Per-User)](#4-individual-installation-per-user)
5. [Centrally Managed Installation (IT Department)](#5-centrally-managed-installation-it-department)
6. [First-Time Configuration](#6-first-time-configuration)
7. [Advanced Configuration (Nova Table Layout)](#7-advanced-configuration-nova-table-layout)
8. [Instructor Workflow](#8-instructor-workflow)
9. [Troubleshooting](#9-troubleshooting)
10. [Updating the Extension](#10-updating-the-extension)
11. [Security Notes](#11-security-notes)

---

## 1. How It Works

The extension injects a thin control bar into two pages:

- **Moodle gradebook** — an orange bar at the top of the page. The instructor selects which graded activity to capture and clicks **Capture** (or **Capture All** to capture every activity at once). The grades are saved locally in the browser.

- **Nova grade-entry page** — a blue bar at the top of the page. The instructor clicks **Preview** next to any row to verify the match, then clicks **Fill** to populate the grade input fields. A confirmation count is shown before any data is submitted.

No data leaves the browser. No server, no external API, no network traffic is created by the extension itself.

```
[Moodle gradebook]                        [Nova grade-entry page]
  Orange bar                                  Blue bar
  ├─ Select activity dropdown                 ├─ Preview button → shows grade panel
  ├─ Capture (selected activity)              ├─ Fill button → populates input fields
  └─ Capture All (all activities)             └─ Matches students by name (fuzzy)
         │                                               ▲
         └──────── chrome.storage.local ────────────────┘
                   (browser-local only)
```

---

## 2. What the Extension Does and Does Not Do

| Does | Does Not |
|------|----------|
| Read grade values from the Moodle gradebook DOM | Send any data to external servers |
| Store grades locally in the browser (chrome.storage.local) | Access or modify the Moodle database |
| Fill grade input fields on the Nova page | Submit or save grades in Nova automatically |
| Match students by name with fuzzy logic | Log in, authenticate, or store credentials |
| Run only on configured Moodle and Nova hostnames | Run on any other website |
| Persist UI state (collapsed/expanded bars) | Alter any page content beyond its own injected UI |
| Auto-match "Lesson N Quiz" (Moodle) to "Quiz N" (Nova) in Fill All | Capture or fill Lab Activities or Lab Assignments (excluded as non-graded) |

**The instructor always reviews and submits grades manually in Nova.** The extension only pre-fills the input fields.

> **Excluded activity types:** Lab Activities and Lab Assignments are automatically filtered out on both Moodle and Nova — they will not appear in the activity dropdown, be included in a Capture All, or show up in the Fill All preview.

---

## 3. File Structure

```
moodle-nova-sync-extension/
├── manifest.json       MV3 extension manifest (permissions, entry points)
├── content.js          Main logic — runs on Moodle and Nova pages only
├── options.html        Settings UI — hostname and table layout configuration
├── options.js          Saves/loads settings to chrome.storage.sync
└── icons/
    ├── icon16.png      Toolbar icon (16 × 16 px)
    ├── icon48.png      Extensions page icon (48 × 48 px)
    └── icon128.png     Chrome Web Store / install dialog icon (128 × 128 px)
```

---

## 4. Individual Installation (Per-User)

This method is for instructors installing the extension themselves, or for IT to guide individual users.

### Step 1 — Get the extension files

Obtain the `moodle-nova-sync-extension` folder from the shared drive or from whoever distributed it. Keep the entire folder intact — do not rename or move files within it.

### Step 2 — Open the Extensions page

- **Chrome:** address bar → `chrome://extensions`
- **Edge:** address bar → `edge://extensions`

### Step 3 — Enable Developer Mode

Look for the **Developer mode** toggle:
- Chrome: top-right corner of the Extensions page
- Edge: left sidebar of the Extensions page

Turn it **on**.

### Step 4 — Load the extension

Click **Load unpacked** and select the `moodle-nova-sync-extension` folder.

The extension appears in the list with the name **"Moodle → Nova Grade Sync"**. Pin it to the toolbar by clicking the puzzle-piece icon and then the pin icon next to the extension name.

### Step 5 — Configure hostnames

Right-click the extension icon → **Options** (or click the extension and choose Options).

Enter your college's:
- **Moodle address** — the hostname only, e.g. `moodle.yourcollege.edu` (no `https://`, no trailing slash)
- **Nova address** — e.g. `nova.yourcollege.edu`

Click **Save Settings**.

### Step 6 — Reload Moodle and Nova tabs

Close and reopen (or press F5 on) any existing Moodle or Nova tabs. The coloured bars will appear.

---

## 5. Centrally Managed Installation (IT Department)

For college-wide rollout, IT can deploy and lock the extension without requiring instructors to use Developer Mode, and without publishing to the Chrome Web Store.

### Option A — Group Policy (Windows, recommended for domain-joined machines)

Chrome and Edge both support extension deployment via Windows Group Policy. This method silently installs the extension for all users, keeps it updated centrally, and does not require Developer Mode on end-user machines.

**Overview of steps:**

1. **Package the extension** to get a stable extension ID:
   - On any Chrome install with Developer Mode on: `chrome://extensions` → **Pack extension** → browse to the `moodle-nova-sync-extension` folder → **Pack Extension**.
   - Chrome produces `moodle-nova-sync-extension.crx` and a `.pem` private key file.
   - The extension ID (a 32-character string shown on the extensions page after loading) is derived from the `.pem` key. **Store the `.pem` file securely** — it is required for all future updates to keep the same ID.

2. **Host the `.crx` on an internal server** (any web server or file share accessible to managed machines), e.g.:
   ```
   https://tools.yourcollege.internal/extensions/moodle-nova-sync.crx
   ```

3. **Configure the Chrome/Edge Group Policy** via Group Policy Management Console (GPMC) or Intune:
   - Policy path (Chrome): `Computer Configuration → Administrative Templates → Google → Google Chrome → Extensions → Configure the list of force-installed apps and extensions`
   - Policy path (Edge): equivalent under `Microsoft Edge → Extensions`
   - Entry format: `<extensionID>;<update_URL>`
   - The `update_URL` points to an **update manifest XML** (a small XML file on your server that tells Chrome where to download the `.crx`). See the [Chrome Enterprise documentation](https://support.google.com/chrome/a/answer/187202) for the exact XML format.

4. **Set default options via Group Policy (optional):** The extension reads hostnames from `chrome.storage.sync`. To pre-configure these for all users without them needing to visit the Options page, a managed storage policy can be used. Contact the extension author for the managed storage schema if needed.

5. **Result:** On next Group Policy refresh, Chrome/Edge silently installs the extension. No Developer Mode required. Users cannot remove it while the policy is active.

### Option B — Shared `.crx` file (no domain GPO)

If machines are not domain-joined, IT can distribute the `.crx` file via email, intranet, or shared drive:

1. Pack the extension as above to get a `.crx` file.
2. Share the `.crx` file with instructors.
3. Instructors install it by dragging the `.crx` onto `chrome://extensions` (Developer Mode must be on for this method).

> **Note:** Chrome may show a warning that the extension is not from the Web Store. This is expected for sideloaded `.crx` files. The warning is cosmetic; the extension functions normally.

### Option C — Chrome Web Store (public or unlisted)

For the simplest instructor experience with no Developer Mode requirement:

1. Create a Google Developer account at `chrome.google.com/webstore/developer` (one-time $5 USD fee).
2. Zip the `moodle-nova-sync-extension` folder and upload it via the developer dashboard.
3. Publish as **unlisted** (accessible only via direct link) or **private** (restricted to your Google Workspace domain).
4. Share the Store link with instructors — they install it like any other extension, no Developer Mode needed.

For **private/domain-restricted** publishing: link the Chrome Web Store developer account to your Google Workspace domain. Under the publishing settings, choose to restrict visibility to your domain only. Users on college Google accounts will see the extension in the Web Store.

---

## 6. First-Time Configuration

Open the extension Options page (right-click extension icon → Options):

| Field | Description | Example |
|-------|-------------|---------|
| Moodle address | Hostname of your Moodle server | `students.willisonline.ca` |
| Nova address | Hostname of your Nova server | `nova.williscollege.ca` |

Do not include `https://` or any path — hostname only.

Click **Save Settings**. The confirmation banner confirms the save. Reload any open Moodle and Nova tabs.

---

## 7. Advanced Configuration (Nova Table Layout)

These settings only need to change if grades are not being detected correctly on Nova. The defaults match Willis College's Nova installation.

| Field | Default | Meaning |
|-------|---------|---------|
| Fixed column count | `5` | Number of non-student columns before the student columns in Nova's grade table |
| Assessment name column index | `1` | Which column (zero-indexed) holds the assessment/row name |

If the Nova page layout changes after a Nova software update and grades stop filling, adjust these values. Open the Nova grade-entry page → press F12 → Elements tab → inspect the grade table structure to count columns.

---

## 7a. Course Mappings (Per-Course Grade Groupings)

Some courses group multiple Moodle activities into a single Nova row. For example, Moodle Assignments 1–6 may be averaged into a single "Assignment 1 total" column in Moodle, which maps to "Assignment 1" in Nova. The tool captures these pre-computed total/average columns automatically — you only need to tell it which Moodle column name to use for each Nova row, per course.

**Courses that use 1:1 name matching do not need an entry here.** Leave them out entirely.

### Format

In the Options page **Course Mappings** field, enter a JSON object where:
- Each top-level key is the Nova course name (partial match, case-insensitive)
- Each value is an object mapping Nova row names → Moodle column names

```json
{
  "Introduction to Computing": {
    "Assignment 1": "Assignment 1 total",
    "Assignment 2": "Assignment 2 total",
    "Quiz 1": "Quiz 1 total",
    "Quiz 2": "Quiz 2 total"
  },
  "Another Course Name": {
    "Assignment 1": "Assignment 1 total"
  }
}
```

The Moodle column name must match exactly what appears in Moodle's gradebook header (the tool does a case-insensitive exact match).

### How to find the exact Moodle column name

1. Open Moodle → navigate to the gradebook for the course
2. Look at the column headers in the grading table
3. The pre-computed average column is usually labelled **"[Activity type] [N] total"**, e.g. `Assignment 1 total`, `Quiz 2 total`
4. Copy that label exactly into the mapping JSON value

### What changes with a mapping defined

- **Preview panel**: the "Moodle activity to use" dropdown auto-selects the mapped column instead of the closest name match
- **Fill All**: each Nova row is pre-matched to its mapped Moodle column; the dropdown is pre-selected but can still be overridden manually
- **Capture All**: captures all gradebook columns (including total columns) — the mapping controls which one gets used on the Nova side

---

## 8. Instructor Workflow

### Capturing grades from Moodle

1. Navigate to the Moodle gradebook for the course.
2. The **orange bar** appears at the top. If it is collapsed, click **▼ MNS** to expand it.
3. Use the dropdown to select the activity (quiz, assignment, etc.) whose grades you want to transfer.
4. Click **Capture** to save that activity's grades, or **Capture All** to capture every activity in the gradebook at once.
5. A green confirmation message shows how many students were captured, e.g. `✓ Captured 24 students for "Quiz 3"`.

### Filling grades into Nova

1. Navigate to the Nova grade-entry page for the same course.
2. The **blue bar** appears at the top. If it is collapsed, click **▼ MNS** to expand it.
3. For each row in Nova's table, click **Preview** to open a panel showing which Moodle activity will be used and a preview of the grades.
   - The **"Moodle activity to use"** dropdown in the preview panel auto-selects the best-matching activity. You can change it manually if needed.
4. Click **Fill** (inside the preview panel) to populate the grade fields for that row.
5. A count is shown: `✓ Filled 22 / 24 — 2 unmatched (see console)`. Unmatched students (name could not be found) are listed in the browser console (F12 → Console tab) for manual follow-up.
6. **Review the filled grades visually before submitting in Nova.** The extension does not submit — you do.

### Bar collapse behaviour

Both bars remember their collapsed/expanded state across page refreshes. Collapse them once and they stay collapsed until you click to expand.

---

## 9. Troubleshooting

**The orange or blue bar does not appear.**
- Confirm the Options page has the correct hostname for this site.
- Make sure you saved the settings and reloaded the tab.
- Check that the extension is enabled: `chrome://extensions` → verify the toggle is on.

**"Capture" shows 0 students.**
- The Moodle gradebook page may use different HTML than expected. Press F12 → Console tab → look for any error from `mns-` prefixed messages.
- The extension looks for rows matching `tr[data-uid], tr.user` and name cells matching `th .username, th a, td.cell.c0 a, .userfullname`. If Moodle was updated and these selectors no longer match, contact the extension author to update them.

**"Fill" shows 0 matched / all grades appear blank.**
- Confirm you captured grades from Moodle first (the stored label in the orange bar shows a timestamp and count when data is stored).
- Check that the Nova activity row names roughly correspond to Moodle activity names. The matching is fuzzy but activity names that are completely different will not match.

**A student is not matched.**
- Open F12 → Console tab — unmatched students are listed by name.
- Name differences (middle names, initials, hyphenation) are the most common cause. The extension normalises accents, hyphens, and "Last, First" formats but cannot handle completely different names.
- Grade that student manually in Nova.

**Quiz numbers are matching the wrong quiz (e.g. Quiz 11 matches Lesson 1 Quiz).**
- This was a known issue fixed in v4.6.0. If you are running an earlier version, update to the current version.

**Options page says "Settings saved" but the bar still doesn't appear.**
- The content script reads settings once when the page loads. Reload the Moodle/Nova tab after saving options.

---

## 10. Updating the Extension

### If you have access to the source folder

1. Make code changes in `content.js`, `options.js`, or `options.html` as needed.
2. Increment `"version"` in `manifest.json` (e.g. `"4.6.0"` → `"4.7.0"`).
3. Re-test in Developer Mode by reloading the extension (`chrome://extensions` → click the refresh icon on the extension card).

### Distributing an update via `.crx`

1. Run **Pack extension** again using the **same `.pem` private key file** used originally.
2. Chrome produces a new `.crx` with the same extension ID.
3. Distribute the new `.crx` to users. They drag-and-drop it onto `chrome://extensions` to update.

> If the `.pem` key is lost, a new key (and therefore new extension ID) will be generated. Users would need to uninstall the old extension and install the new one from scratch.

### Via Group Policy

Replace the `.crx` on the hosting server and update the version number in the update manifest XML. Chrome polls for updates and installs the new version automatically.

---

## 11. Security Notes

- **No credentials stored.** The extension does not capture, transmit, or store usernames or passwords.
- **No external communication.** The extension makes no network requests. It reads the page DOM and writes to `chrome.storage.local` (grade data, UI state) and `chrome.storage.sync` (hostname settings). All data stays in the browser.
- **Minimal permissions.** The extension requests only `storage` permission. The `host_permissions: *://*/*` entry is required because the Moodle and Nova hostnames are user-configurable — the extension checks the actual hostname at runtime and immediately exits on any page that is not Moodle or Nova.
- **No code injection from external sources.** The extension contains no remote scripts, no CDN dependencies, and no telemetry.
- **Content Security Policy.** The extension does not override the host page's CSP. All injected elements are created via DOM APIs, not `innerHTML` with external resources.
- **Source is auditable.** The entire extension is three small JavaScript files with no build step, no minification, and no dependencies. IT security staff can read the complete source in under an hour.

For any security questions or to request a formal security review, contact the extension author.

---

*For support, feature requests, or source code updates, contact Bunmi Oke — Work: bunmi.oke@williscollege.ca; Personal: itisbunmioke@gmail.com.*
