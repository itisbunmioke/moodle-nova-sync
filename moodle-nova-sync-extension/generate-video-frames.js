// @ts-nocheck
// Generates 9 video storyboard frames at 1920×1080 (16:9) for Moodle→Nova explainer video.
// Run: node generate-video-frames.js
// Output: video-frames/ folder
// Import PNGs into Canva, PowerPoint, or ScreenPal, add narration from VIDEO_SCRIPT.md.

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'video-frames');
fs.mkdirSync(OUT, { recursive: true });

const W = 1920, H = 1080;

// Brand colours
const BLUE   = '#005f99';
const DKBLUE = '#002d4d';
const ORANGE = '#e65c00';
const GREEN  = '#2a7a2a';
const WHITE  = '#ffffff';
const GOLD   = '#ffd080';

function save(canvas, name) {
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`✓  ${name}  (${(buf.length/1024).toFixed(0)} KB)`);
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function dots(ctx, w, h, alpha) {
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  for (let x=40;x<w;x+=60) for (let y=40;y<h;y+=60) {
    ctx.beginPath(); ctx.arc(x,y,2.5,0,Math.PI*2); ctx.fill();
  }
}

function btn(ctx, x, y, w, h, label, bg, fg) {
  ctx.fillStyle = bg; rr(ctx,x,y,w,h,6); ctx.fill();
  ctx.fillStyle = fg; ctx.font='bold 22px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(label, x+w/2, y+h/2);
}

function sceneLabel(ctx, text) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(ctx,40,H-80,W-80,50,8); ctx.fill();
  ctx.fillStyle = WHITE; ctx.font='18px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(text, W/2, H-55);
}

// ─── Frame 1: Title ───────────────────────────────────────────────────────────
function frame1() {
  const C = createCanvas(W,H), ctx = C.getContext('2d');
  const g = ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0,DKBLUE); g.addColorStop(0.6,BLUE); g.addColorStop(1,'#003355');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  dots(ctx,W,H,0.04);

  // Big icon badge
  const ig = ctx.createLinearGradient(W/2-90,H/2-220,W/2+90,H/2-60);
  ig.addColorStop(0,'#0082cc'); ig.addColorStop(1,'#003561');
  ctx.fillStyle=ig; rr(ctx,W/2-90,H/2-230,180,180,28); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.20)'; ctx.lineWidth=2;
  rr(ctx,W/2-90,H/2-230,180,180,28); ctx.stroke();

  // Grade sheet icon
  ctx.fillStyle='rgba(255,255,255,0.95)';
  ctx.fillRect(W/2-74, H/2-212, 100, 12);
  ctx.fillStyle='rgba(255,255,255,0.65)';
  ctx.fillRect(W/2-74, H/2-194, 72, 9);
  ctx.fillRect(W/2-74, H/2-180, 58, 9);
  ctx.fillRect(W/2-74, H/2-166, 80, 9);
  // Sync arrow on icon
  ctx.fillStyle='rgba(0,25,55,0.60)';
  ctx.beginPath(); ctx.arc(W/2+52, H/2-86, 34, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle='#ff8b28'; ctx.lineWidth=8; ctx.lineCap='round';
  ctx.beginPath(); ctx.arc(W/2+52, H/2-86, 22, Math.PI*0.15, Math.PI*1.82); ctx.stroke();

  // Title
  ctx.fillStyle=WHITE; ctx.font='bold 88px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Moodle → Nova Grade Sync', W/2, H/2+30);

  ctx.fillStyle='rgba(255,255,255,0.72)'; ctx.font='38px Arial';
  ctx.fillText('Transfer grades in seconds — no copy-paste needed', W/2, H/2+110);

  ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.font='24px Arial';
  ctx.fillText('Chrome & Edge Extension  ·  Willis College  ·  v4.6.0', W/2, H/2+168);

  save(C,'frame-01-title.png');
}

// ─── Frame 2: The Problem ─────────────────────────────────────────────────────
function frame2() {
  const C = createCanvas(W,H), ctx = C.getContext('2d');
  ctx.fillStyle='#f5f5f5'; ctx.fillRect(0,0,W,H);

  // Header band
  ctx.fillStyle='#333'; ctx.fillRect(0,0,W,100);
  ctx.fillStyle=WHITE; ctx.font='bold 42px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('The Manual Grading Workflow — Before This Extension', W/2, 50);

  // Pain arrows flow
  const steps = [
    { icon:'📖', label:'Open Moodle', sub:'Navigate to\ngradebook', color:'#666' },
    { icon:'📋', label:'Read grades', sub:'Note each\nstudent name + score', color:'#888' },
    { icon:'✏️', label:'Write them down', sub:'Or take a screenshot\n(and squint)', color:'#888' },
    { icon:'🖥️', label:'Open Nova', sub:'Log in\nfind the course', color:'#666' },
    { icon:'⌨️', label:'Type each grade', sub:'One by one\n24 students × 6 activities', color:'#c62828' },
    { icon:'😰', label:'Hope for no typos', sub:'144 entries\nper grading period', color:'#c62828' },
  ];

  const boxW = 256, boxH = 260, gap = 22;
  const totalW = steps.length * (boxW + gap) - gap;
  const startX = (W - totalW) / 2;

  steps.forEach((s, i) => {
    const x = startX + i*(boxW+gap), y = 148;
    ctx.fillStyle=WHITE; ctx.shadowColor='rgba(0,0,0,0.10)'; ctx.shadowBlur=8;
    rr(ctx,x,y,boxW,boxH,10); ctx.fill();
    ctx.shadowBlur=0;
    if(i>3){ ctx.strokeStyle='#f44336'; ctx.lineWidth=2; rr(ctx,x,y,boxW,boxH,10); ctx.stroke(); }

    ctx.font='52px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(s.icon, x+boxW/2, y+66);

    ctx.font='bold 20px Arial'; ctx.fillStyle='#222';
    ctx.fillText(s.label, x+boxW/2, y+116);

    ctx.font='16px Arial'; ctx.fillStyle=s.color;
    const lines = s.sub.split('\n');
    lines.forEach((l,li) => ctx.fillText(l, x+boxW/2, y+146+li*22));

    // Arrow between boxes
    if(i < steps.length-1) {
      const ax = x+boxW+4, ay = y+boxH/2;
      ctx.fillStyle=i>3?'#f44336':'#999';
      ctx.beginPath();
      ctx.moveTo(ax,ay-10); ctx.lineTo(ax+gap-6,ay); ctx.lineTo(ax,ay+10);
      ctx.closePath(); ctx.fill();
    }
  });

  // Big red result box
  ctx.fillStyle='#ffebee'; rr(ctx,(W-700)/2,444,700,120,10); ctx.fill();
  ctx.strokeStyle='#f44336'; ctx.lineWidth=2; rr(ctx,(W-700)/2,444,700,120,10); ctx.stroke();
  ctx.font='bold 32px Arial'; ctx.fillStyle='#c62828'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Result: 20–30 minutes of error-prone manual entry per grading session', W/2, 504);

  // Time callout
  ctx.fillStyle=WHITE; rr(ctx,(W-560)/2,590,560,80,10); ctx.fill();
  ctx.strokeStyle='#ff9800'; ctx.lineWidth=2; rr(ctx,(W-560)/2,590,560,80,10); ctx.stroke();
  ctx.font='bold 28px Arial'; ctx.fillStyle='#e65c00'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('⏱  Up to 144 manual entries, per grading period', W/2, 630);

  sceneLabel(ctx,'PROBLEM: Manual copy-paste is slow, tedious, and error-prone');
  save(C,'frame-02-problem.png');
}

// ─── Frame 3: The Solution ────────────────────────────────────────────────────
function frame3() {
  const C = createCanvas(W,H), ctx = C.getContext('2d');
  const g = ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0,DKBLUE); g.addColorStop(1,'#003355');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  dots(ctx,W,H,0.035);

  ctx.fillStyle=WHITE; ctx.font='bold 54px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('The Solution — Two Clicks', W/2, 100);

  // Three boxes: Moodle | Storage | Nova
  const boxes = [
    { x:80,  y:200, w:480, h:600, bg:'#4a2d82', label:'Moodle Gradebook', accent:'#e65c00' },
    { x:720, y:200, w:480, h:600, bg:'#1a3a5c', label:'Nova Grade Entry',  accent:'#005f99' },
  ];

  // Moodle box
  ctx.fillStyle='rgba(255,255,255,0.08)'; rr(ctx,80,200,480,600,14); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1.5; rr(ctx,80,200,480,600,14); ctx.stroke();
  ctx.fillStyle='#4a2d82'; rr(ctx,80,200,480,52,14); ctx.fill(); ctx.fillRect(80,236,480,16);
  ctx.fillStyle=WHITE; ctx.font='bold 24px Arial'; ctx.textAlign='center';
  ctx.fillText('Moodle Gradebook', 320, 230);

  // Orange bar in moodle
  ctx.fillStyle=ORANGE; ctx.fillRect(96,268,448,42);
  ctx.fillStyle=WHITE; ctx.font='bold 18px Arial'; ctx.textAlign='left';
  ctx.fillText('📋 Moodle→Nova', 108, 294);
  ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.font='16px Arial';
  ctx.fillText('Assignment 1 total  ▾', 108, 330);
  btn(ctx,400,316,126,30,'Capture',WHITE,ORANGE);

  // Grade table
  const rows=[['James Anderson','78.3'],['Sarah Brown','91.7'],['Michael Chen','67.7'],['Emily Davis','87.7']];
  ctx.font='18px Arial'; ctx.textAlign='left';
  rows.forEach((r,i)=>{
    ctx.fillStyle=i%2===0?'rgba(255,255,255,0.08)':'rgba(255,255,255,0.04)';
    ctx.fillRect(96,376+i*48,448,44);
    ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.fillText(r[0],108,405+i*48);
    ctx.font='bold 18px Arial'; ctx.textAlign='right'; ctx.fillStyle='#ffd080';
    ctx.fillText(r[1],524,405+i*48);
    ctx.font='18px Arial'; ctx.textAlign='left'; ctx.fillStyle='rgba(255,255,255,0.85)';
  });

  ctx.fillStyle='rgba(255,255,255,0.70)'; ctx.font='16px Arial'; ctx.textAlign='center';
  ctx.fillText('Click Capture → grades saved to browser', 320, 620);
  ctx.font='bold 20px Arial'; ctx.fillStyle=GOLD;
  ctx.fillText('✓ 24 students captured', 320, 655);

  // Nova box
  ctx.fillStyle='rgba(255,255,255,0.08)'; rr(ctx,720,200,480,600,14); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1.5; rr(ctx,720,200,480,600,14); ctx.stroke();
  ctx.fillStyle='#1a3a5c'; rr(ctx,720,200,480,52,14); ctx.fill(); ctx.fillRect(720,236,480,16);
  ctx.fillStyle=WHITE; ctx.font='bold 24px Arial'; ctx.textAlign='center';
  ctx.fillText('Nova Grade Entry', 960, 230);

  // Blue bar
  ctx.fillStyle=BLUE; ctx.fillRect(736,268,448,42);
  ctx.fillStyle=WHITE; ctx.font='bold 18px Arial'; ctx.textAlign='left';
  ctx.fillText('⬇ Nova Sync', 748, 287);
  btn(ctx,872,274,100,30,'Preview',WHITE,BLUE);
  btn(ctx,980,274,96,30,'Fill Now',WHITE,BLUE);
  btn(ctx,1084,274,88,30,'Fill All','#fff8d0','#7a5500');

  // Nova table rows with filled cells
  const novaRows=[['Assignment 1','91.7'],['Assignment 2','—'],['Quiz 1','—']];
  novaRows.forEach((r,i)=>{
    ctx.fillStyle=i===0?'rgba(255,255,255,0.14)':'rgba(255,255,255,0.06)';
    ctx.fillRect(736,376+i*60,448,54);
    ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.font='18px Arial'; ctx.textAlign='left';
    ctx.fillText(r[0], 748, 408+i*60);
    if(i===0){
      ctx.fillStyle='#a8f0b8'; rr(ctx,960,382+i*60,180,36,4); ctx.fill();
      ctx.fillStyle='#0a4a1a'; ctx.font='bold 18px Arial'; ctx.textAlign='center';
      ctx.fillText('78.3  91.7  67.7 …', 1050, 404+i*60);
    } else {
      ctx.fillStyle='rgba(255,255,255,0.22)'; rr(ctx,960,382+i*60,180,36,4); ctx.fill();
    }
    ctx.textAlign='left';
  });
  ctx.fillStyle='rgba(255,255,255,0.70)'; ctx.font='16px Arial'; ctx.textAlign='center';
  ctx.fillText('Grades pre-filled — you review &amp; submit', 960, 620);
  ctx.font='bold 20px Arial'; ctx.fillStyle='#a8f0b8';
  ctx.fillText('✓ Fill in one click', 960, 655);

  // Central arrow
  const midX = W/2;
  ctx.fillStyle='rgba(255,255,255,0.12)'; rr(ctx,midX-80,340,160,200,12); ctx.fill();
  ctx.strokeStyle=GOLD; ctx.lineWidth=4; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(midX,380); ctx.lineTo(midX,480); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(midX-18,458); ctx.lineTo(midX,480); ctx.lineTo(midX+18,458); ctx.stroke();
  ctx.fillStyle=GOLD; ctx.font='bold 16px Arial'; ctx.textAlign='center';
  ctx.fillText('browser', midX, 430); ctx.fillText('storage', midX, 452);

  ctx.fillStyle='rgba(255,255,255,0.60)'; ctx.font='18px Arial';
  ctx.fillText('(stays in\nyour browser)', midX, 510);

  sceneLabel(ctx,'SOLUTION: Capture on Moodle → Fill on Nova — data never leaves the browser');
  save(C,'frame-03-solution.png');
}

// ─── Frame 4: Install (Chrome Web Store) ─────────────────────────────────────
function frame4() {
  const C = createCanvas(W,H), ctx = C.getContext('2d');
  ctx.fillStyle='#f0f4f8'; ctx.fillRect(0,0,W,H);

  // Header
  ctx.fillStyle=BLUE; ctx.fillRect(0,0,W,100);
  ctx.fillStyle=WHITE; ctx.font='bold 44px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Installing & Configuring — Quick One-Time Setup', W/2, 50);

  // ── Left column: Chrome Web Store install steps ──────────────────────────
  const steps = [
    { num:'1', title:'Get the link from IT', body:'Your IT department or coordinator\nshares a direct Chrome Web Store link\n(or the extension is listed privately).', accent:'#4a2d82' },
    { num:'2', title:'Click "Add to Chrome"', body:'On the Chrome Web Store page,\nclick the blue "Add to Chrome" button.\n(Edge users: click "Get" or "Add to Edge")', accent:BLUE },
    { num:'3', title:'Confirm the prompt', body:'A dialog asks to confirm permissions.\nClick "Add extension".\nThe icon appears in your toolbar.', accent:BLUE },
    { num:'4', title:'Pin the extension', body:'Click the puzzle-piece icon\nin the toolbar, then click the\npin icon next to this extension.', accent:ORANGE },
  ];

  const bW = 390, bH = 430, gap = 30;
  const totalW = steps.length*(bW+gap)-gap;
  const startX = (W-totalW)/2;

  steps.forEach((s,i) => {
    const x = startX + i*(bW+gap), y = 118;
    ctx.fillStyle=WHITE; ctx.shadowColor='rgba(0,0,0,0.12)'; ctx.shadowBlur=12;
    rr(ctx,x,y,bW,bH,12); ctx.fill(); ctx.shadowBlur=0;

    ctx.fillStyle=s.accent; rr(ctx,x,y,bW,60,12); ctx.fill(); ctx.fillRect(x,y+34,bW,26);
    ctx.fillStyle=WHITE; ctx.font='bold 22px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(s.title, x+bW/2, y+32);

    ctx.fillStyle=s.accent; ctx.font='bold 140px Arial'; ctx.textBaseline='middle';
    ctx.fillText(s.num, x+bW/2, y+210);
    ctx.fillStyle='rgba(255,255,255,0.22)'; ctx.font='bold 150px Arial';
    ctx.fillText(s.num, x+bW/2, y+206);
    ctx.fillStyle=s.accent; ctx.font='bold 140px Arial';
    ctx.fillText(s.num, x+bW/2, y+206);

    ctx.fillStyle='#333'; ctx.font='19px Arial'; ctx.textBaseline='top';
    s.body.split('\n').forEach((l,li) => ctx.fillText(l, x+bW/2, y+320+li*28));

    if(i<steps.length-1){
      const ax=x+bW+4, ay=y+bH/2;
      ctx.fillStyle='#bbb';
      ctx.beginPath(); ctx.moveTo(ax,ay-14); ctx.lineTo(ax+gap-6,ay); ctx.lineTo(ax,ay+14); ctx.closePath(); ctx.fill();
    }
  });

  // ── Bottom: Options page config ───────────────────────────────────────────
  ctx.fillStyle=WHITE; ctx.shadowColor='rgba(0,0,0,0.10)'; ctx.shadowBlur=10;
  rr(ctx,80,590,W-160,150,12); ctx.fill(); ctx.shadowBlur=0;

  // Blue top bar of the "options page" card
  ctx.fillStyle=BLUE; rr(ctx,80,590,W-160,46,12); ctx.fill(); ctx.fillRect(80,614,W-160,22);
  ctx.fillStyle=WHITE; ctx.font='bold 22px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Step 5 of 5 — One-time Configuration: open Options (right-click the extension icon → Options)', W/2, 618);

  // Two hostname fields side by side
  const midW = (W-160-60)/2;
  [[80+16, 'Moodle address', 'students.willisonline.ca'],
   [80+16+midW+28, 'Nova address', 'nova.williscollege.ca']].forEach(([fx, lbl, val]) => {
    ctx.fillStyle='#333'; ctx.font='bold 18px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(lbl, fx, 660);
    ctx.fillStyle='#f0f0f0'; rr(ctx,fx,672,midW,34,4); ctx.fill();
    ctx.strokeStyle='#bbb'; ctx.lineWidth=1; rr(ctx,fx,672,midW,34,4); ctx.stroke();
    ctx.fillStyle='#333'; ctx.font='18px Arial'; ctx.fillText(val, fx+10, 689);
  });

  ctx.fillStyle=GREEN; rr(ctx,W/2-80,672,160,34,5); ctx.fill();
  ctx.fillStyle=WHITE; ctx.font='bold 18px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Save Settings', W/2, 689);

  ctx.fillStyle='#555'; ctx.font='17px Arial'; ctx.textAlign='center';
  ctx.fillText('Then reload any open Moodle and Nova tabs.', W/2, 724);

  sceneLabel(ctx,'INSTALL: Works like any Chrome/Edge extension — no developer mode or technical steps needed');
  save(C,'frame-04-install.png');
}

// ─── Frame 5: Moodle Capture ──────────────────────────────────────────────────
function frame5() {
  const C = createCanvas(W,H), ctx = C.getContext('2d');
  ctx.fillStyle='#f4f4f4'; ctx.fillRect(0,0,W,H);

  // Browser chrome
  ctx.fillStyle='#ddd'; ctx.fillRect(0,0,W,70);
  ctx.fillStyle=WHITE; rr(ctx,10,10,360,38,5); ctx.fill();
  ctx.fillStyle='#555'; ctx.font='16px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('Moodle Gradebook — COMP1000', 22, 29);
  ctx.fillStyle=WHITE; rr(ctx,400,14,W-500,34,4); ctx.fill();
  ctx.fillStyle='#444'; ctx.font='16px Arial';
  ctx.fillText('students.willisonline.ca/grade/report/grader/index.php', 412, 31);

  // Orange bar
  ctx.fillStyle=ORANGE; ctx.fillRect(0,70,W,56);
  ctx.fillStyle=WHITE; ctx.font='bold 20px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('📋 Moodle→Nova', 16, 98);

  // Dropdown
  ctx.fillStyle='rgba(255,255,255,0.20)'; rr(ctx,200,80,380,36,4); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.50)'; ctx.lineWidth=1; rr(ctx,200,80,380,36,4); ctx.stroke();
  ctx.fillStyle=WHITE; ctx.font='18px Arial';
  ctx.fillText('Assignment 1 total  ▾', 212, 98);

  btn(ctx,594,80,130,36,'Capture',WHITE,ORANGE);
  btn(ctx,734,80,158,36,'Capture All','rgba(255,255,255,0.22)',WHITE);

  ctx.fillStyle='rgba(255,255,255,0.88)'; ctx.font='16px Arial';
  ctx.fillText('✓ Stored: "Assignment 1 total" · 24 students · just now', 906, 98);

  // Moodle nav
  ctx.fillStyle='#4a2d82'; ctx.fillRect(0,126,W,52);
  ctx.fillStyle=WHITE; ctx.font='bold 22px Arial'; ctx.textAlign='left';
  ctx.fillText('Willis College Moodle', 20, 152);

  // Grade table header
  ctx.fillStyle='#ebebeb'; ctx.fillRect(0,178,W,36);
  const hdrs=['First name','Last name','Assign 1','Assign 2','Assign 3','Assign 1 total ★','Quiz 1','Quiz 2','Quiz 1 total ★'];
  const cw=[140,140,110,110,110,170,100,100,160];
  let cx=16;
  hdrs.forEach((h,i)=>{
    const isTot=h.includes('★');
    if(isTot){ ctx.fillStyle='#fff0d0'; ctx.fillRect(cx-2,178,cw[i]+4,36); }
    ctx.fillStyle=isTot?'#9a3800':'#333'; ctx.font=isTot?'bold 15px Arial':'15px Arial';
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(h,cx,196); cx+=cw[i];
  });

  const students=[
    ['James','Anderson','78','82','75','78.3','88','90','89.0'],
    ['Sarah','Brown','92','88','95','91.7','94','91','92.5'],
    ['Michael','Chen','65','70','68','67.7','72','75','73.5'],
    ['Emily','Davis','88','85','90','87.7','92','89','90.5'],
    ['Robert','Foster','55','60','58','57.7','65','62','63.5'],
    ['Amanda','Garcia','96','94','98','96.0','97','95','96.0'],
    ['Yusuf','Hassan-Ali','80','78','82','80.0','84','86','85.0'],
    ['Fatima','Ibrahim','90','93','87','90.0','91','94','92.5'],
    ['Derek','Jones','60','64','62','62.0','68','65','66.5'],
    ['Christine','Kim','88','84','90','87.3','86','90','88.0'],
  ];

  students.forEach((row,ri)=>{
    const ry=214+ri*70;
    ctx.fillStyle=ri%2===0?WHITE:'#f7f7f7'; ctx.fillRect(0,ry,W,70);
    ctx.strokeStyle='#e8e8e8'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0,ry+70); ctx.lineTo(W,ry+70); ctx.stroke();

    cx=16;
    row.forEach((cell,ci)=>{
      const isTot=ci===5||ci===8;
      if(isTot){ ctx.fillStyle='#fff0d0'; ctx.fillRect(cx-2,ry,cw[ci]+4,70); }
      ctx.fillStyle=isTot?'#9a3800':'#444';
      ctx.font=isTot?'bold 20px Arial':'18px Arial';
      ctx.textAlign=ci>=2?'right':'left';
      ctx.textBaseline='middle';
      ctx.fillText(cell, ci>=2?cx+cw[ci]-8:cx, ry+35);
      cx+=cw[ci];
    });
  });

  // Callout
  ctx.fillStyle='rgba(230,92,0,0.92)'; rr(ctx,40,H-84,W-80,54,8); ctx.fill();
  ctx.fillStyle=WHITE; ctx.font='bold 22px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Select a column from the dropdown (★ = pre-computed total/average for grouped activities) → Click Capture', W/2, H-57);

  save(C,'frame-05-moodle-capture.png');
}

// ─── Frame 6: Nova + Preview Panel ───────────────────────────────────────────
function frame6() {
  const C = createCanvas(W,H), ctx = C.getContext('2d');
  ctx.fillStyle='#e8e8e8'; ctx.fillRect(0,0,W,H);

  // Browser chrome
  ctx.fillStyle='#ddd'; ctx.fillRect(0,0,W,70);
  ctx.fillStyle=WHITE; rr(ctx,10,10,380,38,5); ctx.fill();
  ctx.fillStyle='#555'; ctx.font='16px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('Nova Grade Entry — COMP1000', 22, 29);
  ctx.fillStyle=WHITE; rr(ctx,420,14,W-520,34,4); ctx.fill();
  ctx.fillStyle='#444'; ctx.font='16px Arial';
  ctx.fillText('nova.williscollege.ca/grades/entry?course=COMP1000', 432, 31);

  // Blue bar
  ctx.fillStyle=BLUE; ctx.fillRect(0,70,W,56);
  ctx.fillStyle=WHITE; ctx.font='bold 20px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('⬇ Nova Sync', 16, 98);

  ctx.fillStyle='rgba(255,255,255,0.18)'; rr(ctx,180,80,220,36,4); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.40)'; ctx.lineWidth=1; rr(ctx,180,80,220,36,4); ctx.stroke();
  ctx.fillStyle=WHITE; ctx.font='18px Arial'; ctx.fillText('Assignment 1  ▾', 192, 98);

  btn(ctx,410,80,110,36,'Preview',WHITE,BLUE);
  btn(ctx,530,80,110,36,'Fill Now',WHITE,BLUE);
  btn(ctx,650,80,100,36,'Fill All','rgba(255,240,80,0.30)',WHITE);

  ctx.fillStyle='rgba(255,255,255,0.80)'; ctx.font='16px Arial';
  ctx.fillText('6 activities · 24 students · 2m ago', 770, 98);

  // Page header
  ctx.fillStyle='#1a3a5c'; ctx.fillRect(0,126,W,52);
  ctx.fillStyle=WHITE; ctx.font='bold 22px Arial'; ctx.textAlign='left';
  ctx.fillText('NOVA Student Information System — Grade Entry', 20, 152);

  // Dimmed background
  ctx.fillStyle='rgba(0,0,0,0.38)'; ctx.fillRect(0,178,W,H-178);

  // Preview panel
  const PW=620, PX=W-PW-30, PY=196;
  ctx.shadowColor='rgba(0,0,0,0.35)'; ctx.shadowBlur=30;
  ctx.fillStyle=WHITE; rr(ctx,PX,PY,PW,720,10); ctx.fill();
  ctx.shadowBlur=0;

  // Panel header
  ctx.fillStyle=BLUE; rr(ctx,PX,PY,PW,54,10); ctx.fill(); ctx.fillRect(PX,PY+28,PW,26);
  ctx.fillStyle=WHITE; ctx.font='bold 22px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('Preview — Assignment 1  (24 students)', PX+18, PY+27);
  ctx.font='26px Arial'; ctx.textAlign='right';
  ctx.fillText('✕', PX+PW-18, PY+27);

  // Activity picker
  ctx.fillStyle='#e8f4ff'; ctx.fillRect(PX,PY+54,PW,66);
  ctx.strokeStyle='#b3d9f7'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(PX,PY+120); ctx.lineTo(PX+PW,PY+120); ctx.stroke();
  ctx.fillStyle='#005f99'; ctx.font='bold 18px Arial'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText('Moodle activity to use:', PX+18, PY+62);
  ctx.fillStyle=WHITE; rr(ctx,PX+18,PY+82,PW-36,30,4); ctx.fill();
  ctx.strokeStyle='#aaa'; ctx.lineWidth=1; rr(ctx,PX+18,PY+82,PW-36,30,4); ctx.stroke();
  ctx.fillStyle='#444'; ctx.font='18px Arial'; ctx.textBaseline='middle';
  ctx.fillText('Assignment 1 total  ▾', PX+28, PY+97);

  // Stats
  ctx.fillStyle='#f5f5f5'; ctx.fillRect(PX,PY+120,PW,36);
  ctx.strokeStyle='#ddd'; ctx.beginPath(); ctx.moveTo(PX,PY+156); ctx.lineTo(PX+PW,PY+156); ctx.stroke();
  ctx.fillStyle='#333'; ctx.font='18px Arial'; ctx.textBaseline='middle';
  ctx.fillText('✓ 22 exact   ⚠ 2 fuzzy match   ✗ 0 unmatched', PX+18, PY+138);

  // Table header
  ctx.fillStyle='#ebebeb'; ctx.fillRect(PX,PY+156,PW,30);
  ctx.strokeStyle='#ddd'; ctx.beginPath(); ctx.moveTo(PX,PY+186); ctx.lineTo(PX+PW,PY+186); ctx.stroke();
  ['','Nova Student','Moodle Match','Grade'].forEach((h,i)=>{
    const xs=[PX+8,PX+44,PX+254,PX+490];
    ctx.fillStyle='#444'; ctx.font='bold 15px Arial'; ctx.textAlign='left';
    ctx.fillText(h,xs[i],PY+171);
  });

  const prows=[
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Anderson, James', m:'James Anderson', g:'78.3'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Brown, Sarah',    m:'Sarah Brown',    g:'91.7'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Chen, Michael',   m:'Michael Chen',   g:'67.7'},
    {ic:'⚠',bg:'#fffbe6',ic_c:'#7a5500',nova:"O'Brien, Fiona", m:"Fiona O Brien",  g:'72.0'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Davis, Emily',    m:'Emily Davis',    g:'87.7'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Foster, Robert',  m:'Robert Foster',  g:'57.7'},
    {ic:'⚠',bg:'#fffbe6',ic_c:'#7a5500',nova:'Hassan-Ali, Y.', m:'Yusuf Hassan Ali',g:'80.0'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Ibrahim, Fatima', m:'Fatima Ibrahim', g:'90.0'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Jones, Derek',    m:'Derek Jones',    g:'62.0'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Kim, Christine',  m:'Christine Kim',  g:'87.3'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Garcia, Amanda',  m:'Amanda Garcia',  g:'96.0'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Lee, Daniel',     m:'Daniel Lee',     g:'74.0'},
  ];
  let py = PY+186;
  prows.forEach(row=>{
    ctx.fillStyle=row.bg; ctx.fillRect(PX,py,PW,36);
    ctx.strokeStyle='#eee'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(PX,py+36); ctx.lineTo(PX+PW,py+36); ctx.stroke();
    ctx.fillStyle=row.ic_c; ctx.font='bold 17px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(row.ic,PX+8,py+18);
    ctx.fillStyle='#333'; ctx.font='17px Arial'; ctx.fillText(row.nova,PX+44,py+18);
    ctx.fillStyle='#666'; ctx.fillText(row.m,PX+254,py+18);
    ctx.fillStyle='#222'; ctx.font='bold 17px Arial'; ctx.fillText(row.g,PX+494,py+18);
    py+=36;
  });

  // Fill button
  ctx.fillStyle=GREEN; rr(ctx,PX+14,py+8,PW-28,46,6); ctx.fill();
  ctx.fillStyle=WHITE; ctx.font='bold 22px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('✓  Fill 22 grades into "Assignment 1"', PX+PW/2, py+31);

  sceneLabel(ctx,'NOVA: Preview shows every match before you commit — green = exact, yellow = fuzzy, check carefully');
  save(C,'frame-06-nova-preview.png');
}

// ─── Frame 7: Review & Submit ─────────────────────────────────────────────────
function frame7() {
  const C = createCanvas(W,H), ctx = C.getContext('2d');
  ctx.fillStyle='#f4f9f4'; ctx.fillRect(0,0,W,H);

  ctx.fillStyle=GREEN; ctx.fillRect(0,0,W,100);
  ctx.fillStyle=WHITE; ctx.font='bold 44px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('After Filling — Review, Then Submit in Nova', W/2, 50);

  // Filled table
  ctx.fillStyle=WHITE; ctx.shadowColor='rgba(0,0,0,0.08)'; ctx.shadowBlur=10;
  rr(ctx,60,120,W-120,480,10); ctx.fill(); ctx.shadowBlur=0;

  // Table header
  ctx.fillStyle='#e0e0e0'; ctx.fillRect(60,120,W-120,36);
  ['Course','Assessment','Type','Max','Weight','Anderson, J','Brown, S','Chen, M','Davis, E','Foster, R'].forEach((h,i)=>{
    const xs=[76,180,338,404,455,544,680,812,944,1076];
    if(i<xs.length){ ctx.fillStyle='#333'; ctx.font='bold 16px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText(h,xs[i],138); }
  });

  const rows=[
    {a:'Assignment 1',t:'Assign',filled:true, scores:['78.3','91.7','67.7','87.7','57.7']},
    {a:'Assignment 2',t:'Assign',filled:false,scores:[]},
    {a:'Quiz 1',      t:'Quiz',  filled:false,scores:[]},
    {a:'Midterm Exam',t:'Exam',  filled:false,scores:[]},
    {a:'Final Exam',  t:'Exam',  filled:false,scores:[]},
  ];

  rows.forEach((row,ri)=>{
    const ry=156+ri*84;
    ctx.fillStyle=row.filled?'#f0fff0':'white'; ctx.fillRect(60,ry,W-120,84);
    if(row.filled){ ctx.strokeStyle='#4caf50'; ctx.lineWidth=2; ctx.strokeRect(61,ry+1,W-122,82); ctx.lineWidth=1; }
    else { ctx.strokeStyle='#f0f0f0'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(60,ry+84); ctx.lineTo(W-60,ry+84); ctx.stroke(); }

    ctx.fillStyle='#333'; ctx.font='18px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText('COMP1000',76,ry+42);
    ctx.font=row.filled?'bold 18px Arial':'18px Arial';
    ctx.fillStyle=row.filled?GREEN:'#333';
    ctx.fillText(row.a,180,ry+42);
    ctx.font='18px Arial'; ctx.fillStyle='#555';
    ctx.fillText(row.t,338,ry+42);
    ctx.fillText('100',404,ry+42);
    ctx.fillText('10%',455,ry+42);

    if(row.filled){
      const xs=[544,680,812,944,1076];
      row.scores.forEach((sc,si)=>{
        ctx.fillStyle='#e8f5e9'; rr(ctx,xs[si]+4,ry+22,120,38,4); ctx.fill();
        ctx.strokeStyle='#4caf50'; ctx.lineWidth=1; rr(ctx,xs[si]+4,ry+22,120,38,4); ctx.stroke();
        ctx.fillStyle='#1a5e20'; ctx.font='bold 20px Arial'; ctx.textAlign='center';
        ctx.fillText(sc,xs[si]+64,ry+42);
        ctx.textAlign='left';
      });
    } else {
      const xs=[544,680,812,944,1076];
      xs.forEach(x=>{ ctx.fillStyle='#f0f0f0'; rr(ctx,x+4,ry+22,120,38,4); ctx.fill(); ctx.strokeStyle='#ccc'; ctx.lineWidth=1; rr(ctx,x+4,ry+22,120,38,4); ctx.stroke(); });
    }
  });

  // Warning + submit callout
  ctx.fillStyle='#fff8e1'; rr(ctx,60,650,700,150,10); ctx.fill();
  ctx.strokeStyle='#ffe082'; ctx.lineWidth=2; rr(ctx,60,650,700,150,10); ctx.stroke();
  ctx.font='36px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('⚠', 120, 725);
  ctx.fillStyle='#7a5500'; ctx.font='bold 24px Arial'; ctx.textAlign='left';
  ctx.fillText('Always review before submitting!', 150, 690);
  ctx.font='20px Arial'; ctx.fillStyle='#5a3800';
  ctx.fillText('The extension fills fields only — it never auto-submits.', 150, 725);
  ctx.fillText('Check grades visually, then click Nova\'s Save button.', 150, 758);
  ctx.fillText('Unmatched students appear in F12 → Console.', 150, 791);

  ctx.fillStyle=GREEN; rr(ctx,800,680,W-880,90,10); ctx.fill();
  ctx.fillStyle=WHITE; ctx.font='bold 28px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Nova Save', W-240, 710);
  ctx.font='20px Arial';
  ctx.fillText('(Nova\'s own button)', W-240, 745);

  ctx.fillStyle='rgba(0,0,0,0.10)'; rr(ctx,800,680,W-880,90,10); ctx.fill();
  ctx.fillStyle=WHITE; ctx.font='bold 28px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Nova Save  →', W-240, 720);

  sceneLabel(ctx,'SUBMIT: The extension fills — you review and save. Always spot-check before clicking Save in Nova.');
  save(C,'frame-07-review-submit.png');
}

// ─── Frame 8: Tips ────────────────────────────────────────────────────────────
function frame8() {
  const C = createCanvas(W,H), ctx = C.getContext('2d');
  const g = ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0,DKBLUE); g.addColorStop(1,BLUE);
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  dots(ctx,W,H,0.035);

  ctx.fillStyle=WHITE; ctx.font='bold 54px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Tips & Things to Know', W/2, 70);

  const cards=[
    {
      icon:'🚫', title:'Lab Activities Excluded Automatically',
      lines:['Lab Activities and Lab Assignments are excluded', 'from Capture and Fill — you never need to', 'manually filter them out.'],
      color:'#ff8b28'
    },
    {
      icon:'⚙️', title:'Per-Course Mappings',
      lines:['If Moodle groups assignments into a "total"', 'column per course, define the mapping in Options', '→ Course Mappings (JSON). Set once, applied always.'],
      color:GOLD
    },
    {
      icon:'💾', title:'Bars Remember Their State',
      lines:['Collapse the orange or blue bar once and it', 'stays collapsed across page refreshes.', 'Click ▼ MNS to expand when needed.'],
      color:'#80d4ff'
    },
    {
      icon:'🔒', title:'100% Private — No External Servers',
      lines:['Grades never leave your browser.', 'No logins, no API keys, no cloud.', 'Data: Moodle DOM → storage → Nova form.'],
      color:'#a8f0b8'
    },
  ];

  const cW=416, cH=360, gap=22;
  const totalW=2*(cW+gap)-gap;
  const startX=(W-totalW)/2;

  cards.forEach((c,i)=>{
    const col=i%2, row=Math.floor(i/2);
    const x=startX+col*(cW+gap), y=130+row*(cH+gap);
    ctx.fillStyle='rgba(255,255,255,0.09)'; rr(ctx,x,y,cW,cH,12); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.16)'; ctx.lineWidth=1.5; rr(ctx,x,y,cW,cH,12); ctx.stroke();

    ctx.font='58px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(c.icon, x+cW/2, y+62);

    ctx.font='bold 26px Arial'; ctx.fillStyle=c.color;
    ctx.fillText(c.title, x+cW/2, y+116);

    ctx.font='20px Arial'; ctx.fillStyle='rgba(255,255,255,0.80)';
    c.lines.forEach((l,li)=>ctx.fillText(l, x+cW/2, y+168+li*32));
  });

  // Bottom strip
  ctx.fillStyle='rgba(255,255,255,0.08)'; ctx.fillRect(0,H-80,W,80);
  ctx.fillStyle='rgba(255,255,255,0.70)'; ctx.font='22px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('For questions or issues: F12 → Console shows detailed logs with "mns-" prefixed messages', W/2, H-40);

  sceneLabel(ctx,'TIPS: Lab exclusion, course mappings, collapsed bars, and privacy');
  save(C,'frame-08-tips.png');
}

// ─── Frame 9: End Card ────────────────────────────────────────────────────────
function frame9() {
  const C = createCanvas(W,H), ctx = C.getContext('2d');
  const g = ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0,DKBLUE); g.addColorStop(0.5,BLUE); g.addColorStop(1,'#003355');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  dots(ctx,W,H,0.04);

  // Large checkmark
  ctx.fillStyle='rgba(42,122,42,0.25)';
  ctx.beginPath(); ctx.arc(W/2,H/2-60,200,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='#4caf50'; ctx.lineWidth=16; ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.beginPath(); ctx.moveTo(W/2-80,H/2-60); ctx.lineTo(W/2-20,H/2+40); ctx.lineTo(W/2+110,H/2-120); ctx.stroke();

  ctx.fillStyle=WHITE; ctx.font='bold 68px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Moodle → Nova Grade Sync', W/2, H/2+180);

  ctx.fillStyle='rgba(255,255,255,0.72)'; ctx.font='32px Arial';
  ctx.fillText('Grades transferred. Time saved. Zero errors.', W/2, H/2+248);

  ctx.fillStyle='rgba(255,255,255,0.50)'; ctx.font='24px Arial';
  ctx.fillText('v4.6.0  ·  Chrome & Edge  ·  Willis College', W/2, H/2+306);

  // Contact box
  ctx.fillStyle='rgba(255,255,255,0.10)'; rr(ctx,(W-700)/2,H/2+340,700,90,10); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.20)'; ctx.lineWidth=1; rr(ctx,(W-700)/2,H/2+340,700,90,10); ctx.stroke();
  ctx.fillStyle=GOLD; ctx.font='bold 22px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Support: Bunmi Oke', W/2, H/2+368);
  ctx.fillStyle='rgba(255,255,255,0.72)'; ctx.font='20px Arial';
  ctx.fillText('bunmi.oke@williscollege.ca  ·  itisbunmioke@gmail.com', W/2, H/2+402);

  save(C,'frame-09-end-card.png');
}

// ─── Run ──────────────────────────────────────────────────────────────────────
frame1(); frame2(); frame3(); frame4(); frame5();
frame6(); frame7(); frame8(); frame9();

console.log('\nAll 9 frames saved to: video-frames/');
console.log('See VIDEO_SCRIPT.md for narration text and assembly instructions.');
