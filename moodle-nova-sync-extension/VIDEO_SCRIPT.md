# Moodle → Nova Grade Sync — Explainer Video Script

**Target length:** 3–4 minutes  
**Audience:** Instructors at Willis College (non-technical)  
**Tone:** Friendly, clear, professional  
**Frame PNGs:** Run `node generate-video-frames.js` → `video-frames/` folder

---

## Scene 1 — Title (0:00–0:08)

**Visual:** Frame 1 — dark blue background, large logo, title text

**Narration (voice-over):**
> "Moodle to Nova Grade Sync. A browser extension that transfers your grades automatically — no copy-paste, no spreadsheets, no mistakes."

---

## Scene 2 — The Problem (0:08–0:38)

**Visual:** Frame 2 — split screen showing manual workflow pain

**Narration:**
> "Here's a workflow most instructors know too well. You open Moodle. You find the gradebook. You write down — or screenshot — every student's grade. Then you open Nova. And you type them in. One by one. For 24 students. For 6 activities. That's up to 144 entries, per submission period. And if you type one number wrong? You may not catch it until a student raises a concern."

> "There has to be a better way."

---

## Scene 3 — The Solution (0:38–1:00)

**Visual:** Frame 3 — clean flow diagram (Moodle → storage → Nova)

**Narration:**
> "Moodle to Nova Grade Sync solves this in two clicks. The extension adds a small control bar to both your Moodle gradebook and your Nova grade-entry page. You capture grades on Moodle. You fill them on Nova. Everything happens inside your browser — nothing is sent to any external server."

---

## Scene 4 — Install (1:00–1:30)

**Visual:** Frame 4 — step-by-step install instructions

**Narration:**
> "Installing takes less than a minute — it works exactly like any other Chrome or Edge extension. Open the Chrome Web Store link shared with you by your IT department or coordinator. Click 'Add to Chrome' — or 'Add to Edge' if you're using Microsoft Edge. Confirm the prompt, and the extension is installed. You'll see its icon appear in your browser toolbar. Pin it so it's always visible. That's it — no technical steps, no developer settings, no folders to manage."

> "Next, right-click the extension icon and choose Options. Enter two things: your Moodle address — just the part after 'https://', like students dot willisonline dot ca — and your Nova address, like nova dot williscollege dot ca. Click Save Settings, then reload any open Moodle or Nova tabs. You only need to do this once."

---

## Scene 5 — Capture from Moodle (1:30–2:10)

**Visual:** Frame 5 — Moodle gradebook with orange bar highlighted

**Narration:**
> "Now let's transfer some grades. Open your Moodle gradebook. You'll see an orange bar at the top of the page — that's the extension. Open the dropdown and select the grade column you want to transfer. If your course uses grouped activities — where several assignments are averaged into one total — pick the total column, like 'Assignment 1 total'. Then click Capture. The extension reads every student's grade and saves it to your browser."

> "A green confirmation tells you how many students were captured. You can also click Capture All to grab every column at once."

---

## Scene 6 — Preview and Fill (2:10–2:55)

**Visual:** Frame 6 — Nova page with blue bar and Preview panel open

**Narration:**
> "Switch to your Nova grade-entry page. A blue bar appears at the top. For each row in Nova's table, click Preview. A panel slides out showing you exactly which Moodle activity will be used, and a list of every student with their grade. Green rows matched perfectly. Yellow rows used fuzzy matching — double-check those names. Any student the extension couldn't match is listed in red."

> "When you're happy with the preview, click Fill. The grade fields are populated instantly. You can also click Fill All to process every row in one go."

---

## Scene 7 — Review and Submit (2:55–3:18)

**Visual:** Frame 7 — Nova table with filled green cells, Submit button highlighted

**Narration:**
> "The extension never submits grades for you. Once the fields are filled, scroll through Nova's table and do a visual spot-check. When everything looks right, click Nova's Save button as you normally would. Any students the extension couldn't match — usually due to very different name spellings — can be found in the browser console under F12, and entered manually."

---

## Scene 8 — Tips (3:18–3:42)

**Visual:** Frame 8 — three tip cards side by side

**Narration:**
> "A few things worth knowing. First: Lab Activities and Lab Assignments are automatically excluded from both Capture and Fill — you don't need to filter them out manually. Second: if your course has a special mapping — for example, Moodle's 'Assignment 1 total' should always go to Nova's 'Assignment 1' — you can set that up once in the Options page under Course Mappings. Third: the bars on both pages remember whether you've collapsed them, so they stay out of your way once you've set up your workflow."

---

## Scene 9 — End Card (3:42–4:00)

**Visual:** Frame 9 — blue background, name, email, version

**Narration:**
> "Moodle to Nova Grade Sync. Version 4.7.0. For support or questions, contact Bunmi Oke at bunmi dot oke at williscollege dot ca. Happy grading."

---

## Production Notes

| Item | Detail |
|------|--------|
| Resolution | 1920 × 1080 (16:9) |
| Frame rate | 30 fps |
| Background music | Optional: soft ambient/lo-fi (low volume, fade under narration) |
| Fonts | Arial or system sans-serif (matches extension UI) |
| Tools to assemble | Canva, ScreenPal, PowerPoint, DaVinci Resolve, or any screen-recorder |
| Voice recording | Use system mic + Audacity or OBS for clean narration audio |

### Suggested assembly workflow (Canva)
1. Import all 9 frame PNGs as slides
2. Set each slide duration to match the narration segment above
3. Record narration directly in Canva (Mic icon) or import an MP3
4. Export as MP4 (1080p)

### Suggested assembly workflow (PowerPoint)
1. New presentation → Widescreen (16:9)
2. Insert each frame PNG as a full-slide image
3. Add speaker notes for the narration
4. Record slide show with narration (Slide Show → Record)
5. Export → Create a Video → Full HD
