// @ts-nocheck
// Generates Chrome Web Store graphic assets for Moodle → Nova Grade Sync.
// Run once from the extension folder: node generate-store-assets.js
// Output: store-assets/ folder with icon-128.png and 5 screenshots at 1280×800.

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'store-assets');
fs.mkdirSync(OUT, { recursive: true });

// Brand colours
const BLUE   = '#005f99';
const ORANGE = '#e65c00';
const WHITE  = '#ffffff';
const GREEN  = '#2a7a2a';

function hex(h) {
  const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
  return [r,g,b];
}
function rgba(h, a) { const [r,g,b] = hex(h); return `rgba(${r},${g},${b},${a})`; }

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function save(canvas, name) {
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`✓  ${name}  (${(buf.length/1024).toFixed(0)} KB)`);
}

// ─── Utility: draw input field ───────────────────────────────────────────────
function inputField(ctx, x, y, w, h, text, accent) {
  ctx.fillStyle = WHITE;
  rr(ctx, x, y, w, h, 3); ctx.fill();
  ctx.strokeStyle = accent || '#ccc'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#444'; ctx.font = `12px Arial`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x+6, y+h/2);
}

// ─── Utility: pill button ─────────────────────────────────────────────────────
function btn(ctx, x, y, w, h, label, bg, fg) {
  ctx.fillStyle = bg; rr(ctx, x, y, w, h, 4); ctx.fill();
  ctx.fillStyle = fg; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x+w/2, y+h/2);
}

// ─── 1. Icon 128×128 ──────────────────────────────────────────────────────────
function makeIcon() {
  const C = createCanvas(128, 128), ctx = C.getContext('2d');

  // Background
  const g = ctx.createLinearGradient(0,0,128,128);
  g.addColorStop(0,'#0082cc'); g.addColorStop(1,'#003f6e');
  ctx.fillStyle = g; rr(ctx,0,0,128,128,20); ctx.fill();

  // Inner glow circle
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath(); ctx.arc(64,60,46,0,Math.PI*2); ctx.fill();

  // "M" (Moodle)
  ctx.fillStyle = WHITE; ctx.font = 'bold 42px Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('M', 34, 60);

  // Arrow  →
  ctx.strokeStyle = '#ffd080'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(56,60); ctx.lineTo(72,60); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(66,53); ctx.lineTo(73,60); ctx.lineTo(66,67); ctx.stroke();

  // "N" (Nova)
  ctx.fillStyle = '#ffd080'; ctx.font = 'bold 42px Arial';
  ctx.fillText('N', 94, 60);

  // Sub-label
  ctx.fillStyle = 'rgba(255,255,255,0.72)'; ctx.font = '10px Arial';
  ctx.fillText('Grade Sync', 64, 100);

  save(C, 'icon-128.png');
}

// ─── 2. Screenshot 1 — Hero / Overview (1280×800) ────────────────────────────
function makeHero() {
  const W=1280, H=800, C=createCanvas(W,H), ctx=C.getContext('2d');

  // Deep-blue gradient background
  const g = ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0,'#002d4d'); g.addColorStop(0.55,BLUE); g.addColorStop(1,'#003355');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

  // Subtle dot grid
  ctx.fillStyle='rgba(255,255,255,0.03)';
  for(let x=20;x<W;x+=36) for(let y=20;y<H;y+=36) { ctx.beginPath(); ctx.arc(x,y,2,0,Math.PI*2); ctx.fill(); }

  // Central icon panel
  ctx.fillStyle='rgba(255,255,255,0.08)'; rr(ctx,540,70,200,200,28); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1.5; ctx.stroke();

  ctx.fillStyle=WHITE; ctx.font='bold 68px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('M',592,168);
  ctx.fillStyle='#ffd080'; ctx.fillText('N',688,168);

  ctx.strokeStyle='#ffd080'; ctx.lineWidth=5; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(618,168); ctx.lineTo(658,168); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(646,155); ctx.lineTo(660,168); ctx.lineTo(646,181); ctx.stroke();

  // Title
  ctx.fillStyle=WHITE; ctx.font='bold 54px Arial';
  ctx.fillText('Moodle → Nova Grade Sync', W/2, 315);

  ctx.fillStyle='rgba(255,255,255,0.72)'; ctx.font='22px Arial';
  ctx.fillText('Transfer grades from Moodle to Nova in seconds — no copy-paste needed', W/2, 365);

  // Four feature cards
  const cards = [
    { icon:'📋', title:'One-Click Capture', body:'Grab grades from any Moodle gradebook column instantly' },
    { icon:'🎯', title:'Smart Matching',    body:'Fuzzy name matching handles accents, hyphens & comma-flipped names' },
    { icon:'⚙️', title:'Per-Course Config', body:'Define custom Moodle→Nova mappings for grouped activity structures' },
    { icon:'↩',  title:'Safe & Reversible', body:'Preview before filling · Undo button · No auto-submit ever' },
  ];
  const cW=258, cH=168, gap=18, totalW=cards.length*(cW+gap)-gap;
  const sx=(W-totalW)/2;

  cards.forEach((c,i) => {
    const x=sx+i*(cW+gap), y=420;
    ctx.fillStyle='rgba(255,255,255,0.09)'; rr(ctx,x,y,cW,cH,12); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1; ctx.stroke();

    ctx.font='34px Arial'; ctx.fillStyle=WHITE; ctx.textAlign='center';
    ctx.fillText(c.icon, x+cW/2, y+42);
    ctx.font='bold 14px Arial'; ctx.fillStyle='#ffd080';
    ctx.fillText(c.title, x+cW/2, y+74);

    // Word wrap body
    ctx.font='12px Arial'; ctx.fillStyle='rgba(255,255,255,0.72)';
    const words=c.body.split(' '); let line='', ly=y+96;
    for(const w of words){
      const t=line?line+' '+w:w;
      if(ctx.measureText(t).width>cW-24){ ctx.fillText(line,x+cW/2,ly); line=w; ly+=17; }
      else line=t;
    }
    if(line) ctx.fillText(line,x+cW/2,ly);
  });

  // Footer
  ctx.fillStyle='rgba(255,255,255,0.38)'; ctx.font='13px Arial';
  ctx.fillText('Chrome & Edge extension · All data stays in your browser · Willis College', W/2, 758);

  save(C,'screenshot-1-overview.png');
}

// ─── 3. Screenshot 2 — Moodle Capture (1280×800) ─────────────────────────────
function makeMoodleCapture() {
  const W=1280, H=800, C=createCanvas(W,H), ctx=C.getContext('2d');

  // Page bg
  ctx.fillStyle='#f4f4f4'; ctx.fillRect(0,0,W,H);

  // Browser chrome
  ctx.fillStyle='#ddd'; ctx.fillRect(0,0,W,56);
  ctx.fillStyle=WHITE; rr(ctx,8,7,260,28,5); ctx.fill();
  ctx.fillStyle='#555'; ctx.font='11px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('Moodle Gradebook — COMP1000', 18, 21);
  ctx.fillStyle=WHITE; rr(ctx,300,11,W-380,26,4); ctx.fill();
  ctx.fillStyle='#444'; ctx.font='13px Arial';
  ctx.fillText('students.willisonline.ca/grade/report/grader/index.php?id=42', 308, 24);
  ctx.strokeStyle='#bbb'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(0,56); ctx.lineTo(W,56); ctx.stroke();

  // MNS orange bar
  ctx.fillStyle=ORANGE; ctx.fillRect(0,56,W,40);
  ctx.fillStyle=WHITE; ctx.font='bold 13px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('📋 Moodle→Nova', 12, 76);

  inputField(ctx,155,63,300,26,'Assignment 1 total',WHITE);

  btn(ctx,463,63,76,26,'Capture',WHITE,ORANGE);
  btn(ctx,545,63,98,26,'Capture All','#ffe8d6',ORANGE);

  ctx.fillStyle='rgba(255,255,255,0.82)'; ctx.font='11px Arial';
  ctx.fillText('✓ Stored: "Assignment 1 total" · 24 students · just now', 655, 76);

  btn(ctx,W-76,65,62,20,'▲ Hide','rgba(255,255,255,0.22)',WHITE);

  // Moodle nav bar (purple)
  ctx.fillStyle='#4a2d82'; ctx.fillRect(0,96,W,46);
  ctx.fillStyle=WHITE; ctx.font='bold 15px Arial';
  ctx.fillText('Willis College Moodle', 20,119);

  // Content area
  ctx.fillStyle=WHITE; ctx.fillRect(0,142,W,H-142);

  // Page heading
  ctx.fillStyle='#333'; ctx.font='bold 20px Arial';
  ctx.fillText('Grader report — Introduction to Computing (COMP1000)', 20,172);
  ctx.fillStyle='#666'; ctx.font='13px Arial';
  ctx.fillText('Dashboard / COMP1000 / Grades', 20,193);

  // Grade table
  const hdr = ['First name','Last name','Email','Assign 1','Assign 2','Assign 3','Assign 1 total','Quiz 1','Quiz 2','Quiz 3','Quiz 1 total','Midterm'];
  const cw  = [94,94,150,72,72,72,100,58,58,58,90,72];
  const TX=16, TY=208;

  // Header row
  ctx.fillStyle='#ebebeb'; ctx.fillRect(TX,TY,W-TX*2,30);
  ctx.strokeStyle='#ccc'; ctx.lineWidth=1; ctx.strokeRect(TX,TY,W-TX*2,30);
  let cx=TX+4;
  hdr.forEach((h,i)=>{
    if(cx+cw[i]>W-TX) return;
    const isTot = h.includes('total');
    if(isTot){ ctx.fillStyle='#fff0d8'; ctx.fillRect(cx-2,TY,cw[i]+4,30); }
    ctx.fillStyle=isTot?'#9a3800':'#333'; ctx.font=isTot?'bold 10px Arial':'10px Arial';
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(h, cx, TY+15);
    cx+=cw[i];
  });

  const students=[
    ['James','Anderson','j.ander…','78','82','75','78.3','88','90','85','87.7','72'],
    ['Sarah','Brown','s.brown…','92','88','95','91.7','94','91','96','93.7','88'],
    ['Michael','Chen','m.chen…','65','70','68','67.7','72','75','69','72.0','60'],
    ['Emily','Davis','e.davis…','88','85','90','87.7','92','89','94','91.7','86'],
    ['Robert','Foster','r.foster…','55','60','58','57.7','65','62','68','65.0','50'],
    ['Amanda','Garcia','a.garcia…','96','94','98','96.0','97','95','99','97.0','94'],
    ['Yusuf','Hassan-Ali','y.hassa…','80','78','82','80.0','84','86','82','84.0','76'],
    ['Fatima','Ibrahim','f.ibrah…','90','93','87','90.0','91','94','88','91.0','89'],
  ];

  students.forEach((row,ri)=>{
    const ry=TY+30+ri*28;
    ctx.fillStyle=ri%2===0?WHITE:'#f7f7f7'; ctx.fillRect(TX,ry,W-TX*2,28);
    ctx.strokeStyle='#ebebeb'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(TX,ry+28); ctx.lineTo(W-TX,ry+28); ctx.stroke();

    cx=TX+4;
    row.forEach((cell,ci)=>{
      if(cx+cw[ci]>W-TX) return;
      const isTot = ci===6||ci===10;
      if(isTot){ ctx.fillStyle='#fff0d8'; ctx.fillRect(cx-2,ry,cw[ci]+4,28); }
      ctx.fillStyle=isTot?'#9a3800':'#444';
      ctx.font=isTot?'bold 11px Arial':'11px Arial';
      ctx.textAlign=ci>=3?'right':'left';
      ctx.textBaseline='middle';
      ctx.fillText(cell, ci>=3?cx+cw[ci]-5:cx, ry+14);
      cx+=cw[ci];
    });
  });

  // Callout label
  ctx.fillStyle=rgba(ORANGE,0.92); rr(ctx,20,H-52,W-40,34,6); ctx.fill();
  ctx.fillStyle=WHITE; ctx.font='bold 14px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Orange columns ("Assignment 1 total", "Quiz 1 total") hold pre-computed averages — select one and click Capture', W/2, H-35);

  save(C,'screenshot-2-moodle-capture.png');
}

// ─── 4. Screenshot 3 — Nova Blue Bar (1280×800) ───────────────────────────────
function makeNovaBar() {
  const W=1280, H=800, C=createCanvas(W,H), ctx=C.getContext('2d');

  ctx.fillStyle='#f0f0f0'; ctx.fillRect(0,0,W,H);

  // Browser
  ctx.fillStyle='#ddd'; ctx.fillRect(0,0,W,56);
  ctx.fillStyle=WHITE; rr(ctx,8,7,320,28,5); ctx.fill();
  ctx.fillStyle='#555'; ctx.font='11px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('Nova Grade Entry — Introduction to Computing', 18,21);
  ctx.fillStyle=WHITE; rr(ctx,360,11,W-440,26,4); ctx.fill();
  ctx.fillStyle='#444'; ctx.font='13px Arial';
  ctx.fillText('nova.williscollege.ca/grades/entry?course=COMP1000', 368,24);
  ctx.strokeStyle='#bbb'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(0,56); ctx.lineTo(W,56); ctx.stroke();

  // MNS Blue bar
  ctx.fillStyle=BLUE; ctx.fillRect(0,56,W,40);
  ctx.fillStyle=WHITE; ctx.font='bold 13px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('⬇ Nova Sync', 12,76);

  inputField(ctx,116,63,220,26,'Assignment 1',WHITE);
  btn(ctx,342,63,70,26,'Preview',WHITE,BLUE);
  btn(ctx,418,63,78,26,'Fill Now',WHITE,BLUE);

  ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.font='15px Arial'; ctx.textAlign='left';
  ctx.fillText('|', 502,76);

  inputField(ctx,518,63,150,26,'— student —',WHITE);
  btn(ctx,674,63,100,26,'Fill Student','#fff3cd','#7a5500');
  btn(ctx,780,63,66,26,'Fill All','#fff3cd','#7a5500');
  btn(ctx,854,63,68,26,'Clear All','#fdecea','#c0392b');

  ctx.fillStyle='rgba(255,255,255,0.82)'; ctx.font='11px Arial';
  ctx.fillText('6 activities · 24 students · 5m ago', 932,76);

  btn(ctx,W-76,65,62,20,'▲ Hide','rgba(255,255,255,0.22)',WHITE);

  // Nova app header
  ctx.fillStyle='#1a3a5c'; ctx.fillRect(0,96,W,46);
  ctx.fillStyle=WHITE; ctx.font='bold 16px Arial';
  ctx.fillText('NOVA Student Information System — Grade Entry', 20,119);

  // Section bar
  ctx.fillStyle='#e8e8e8'; ctx.fillRect(0,142,W,32);
  ctx.fillStyle='#444'; ctx.font='13px Arial';
  ctx.fillText('Course: COMP1000 Introduction to Computing   |   Winter 2026   |   Instructor: B. Oke', 20,158);

  // Nova grade table
  const hdr=['Course','Assessment','Type','Max','Weight','Anderson, J','Brown, S','Chen, M','Davis, E','Foster, R','Garcia, A','Hassan-Ali, Y'];
  const cw=[120,150,70,46,60,88,78,78,78,78,78,96];
  const TX=0, TY=174;

  ctx.fillStyle='#e0e0e0'; ctx.fillRect(TX,TY,W,28);
  let cx=TX+4;
  hdr.forEach((h,i)=>{
    if(cx+cw[i]>W) return;
    ctx.fillStyle='#333'; ctx.font='bold 10px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(h,cx,TY+14);
    cx+=cw[i];
  });

  const rows=[
    {c:'COMP1000',a:'Assignment 1',t:'Assign',m:'100',w:'10%',sel:true},
    {c:'COMP1000',a:'Assignment 2',t:'Assign',m:'100',w:'10%',sel:false},
    {c:'COMP1000',a:'Quiz 1',t:'Quiz',m:'100',w:'5%',sel:false},
    {c:'COMP1000',a:'Quiz 2',t:'Quiz',m:'100',w:'5%',sel:false},
    {c:'COMP1000',a:'Midterm',t:'Exam',m:'100',w:'20%',sel:false},
    {c:'COMP1000',a:'Final Exam',t:'Exam',m:'100',w:'30%',sel:false},
  ];

  rows.forEach((row,ri)=>{
    const ry=TY+28+ri*42;
    ctx.fillStyle=row.sel?'#fff3e0':ri%2===0?WHITE:'#f8f8f8';
    ctx.fillRect(TX,ry,W,42);
    if(row.sel){
      ctx.strokeStyle=ORANGE; ctx.lineWidth=2;
      ctx.strokeRect(1,ry+1,W-2,40); ctx.lineWidth=1;
    } else {
      ctx.strokeStyle='#eee';
      ctx.beginPath(); ctx.moveTo(0,ry+42); ctx.lineTo(W,ry+42); ctx.stroke();
    }
    cx=TX+4;
    [row.c,row.a,row.t,row.m,row.w].forEach((v,vi)=>{
      ctx.fillStyle='#333'; ctx.font=vi===1?'bold 12px Arial':'12px Arial';
      ctx.textAlign='left'; ctx.textBaseline='middle';
      ctx.fillText(v,cx,ry+21);
      cx+=cw[vi];
    });
    // Student input cells
    for(let s=0;s<7;s++){
      if(cx+cw[s+5]>W) break;
      ctx.fillStyle='#eeeeee'; rr(ctx,cx+4,ry+8,cw[s+5]-8,26,3); ctx.fill();
      ctx.strokeStyle='#ccc'; ctx.lineWidth=1; ctx.stroke();
      cx+=cw[s+5];
    }
  });

  // Annotation
  ctx.fillStyle=rgba(BLUE,0.92); rr(ctx,20,H-52,W-40,34,6); ctx.fill();
  ctx.fillStyle=WHITE; ctx.font='bold 14px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Blue bar on Nova — select an assessment row from the dropdown, then click Preview or Fill All', W/2,H-35);

  save(C,'screenshot-3-nova-bar.png');
}

// ─── 5. Screenshot 4 — Preview Panel (1280×800) ───────────────────────────────
function makePreviewPanel() {
  const W=1280, H=800, C=createCanvas(W,H), ctx=C.getContext('2d');

  // Dimmed Nova page background
  ctx.fillStyle='#c8c8c8'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#ddd'; ctx.fillRect(0,0,W,56);
  ctx.strokeStyle='#bbb'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(0,56); ctx.lineTo(W,56); ctx.stroke();
  ctx.fillStyle=BLUE; ctx.fillRect(0,56,W,40);
  ctx.fillStyle=WHITE; ctx.font='bold 13px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('⬇ Nova Sync', 12,76);

  ctx.fillStyle='rgba(0,0,0,0.32)'; ctx.fillRect(0,96,W,H-96);

  // Preview panel card
  const PW=500, PX=W-PW-18, PY=106;
  ctx.shadowColor='rgba(0,0,0,0.3)'; ctx.shadowBlur=24;
  ctx.fillStyle=WHITE; rr(ctx,PX,PY,PW,618,8); ctx.fill();
  ctx.shadowBlur=0; ctx.strokeStyle='#bbb'; ctx.lineWidth=1; rr(ctx,PX,PY,PW,618,8); ctx.stroke();

  // Panel header
  ctx.fillStyle=BLUE; rr(ctx,PX,PY,PW,40,8); ctx.fill();
  ctx.fillRect(PX,PY+20,PW,20);
  ctx.fillStyle=WHITE; ctx.font='bold 14px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('Preview — Assignment 1  (24 students)', PX+14, PY+20);
  ctx.font='18px Arial'; ctx.textAlign='right';
  ctx.fillText('✕', PX+PW-14, PY+20);

  // Moodle activity picker
  let py=PY+40;
  ctx.fillStyle='#f0f8ff'; ctx.fillRect(PX,py,PW,56);
  ctx.strokeStyle='#b3d9f7'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(PX,py+56); ctx.lineTo(PX+PW,py+56); ctx.stroke();
  ctx.fillStyle='#333'; ctx.font='bold 12px Arial'; ctx.textAlign='left';
  ctx.fillText('Moodle activity to use:', PX+12, py+18);
  inputField(ctx,PX+12,py+28,PW-24,22,'Assignment 1 total  ▾','#aaa');
  py+=56;

  // Stats
  ctx.fillStyle='#f5f5f5'; ctx.fillRect(PX,py,PW,30);
  ctx.strokeStyle='#ddd'; ctx.beginPath(); ctx.moveTo(PX,py+30); ctx.lineTo(PX+PW,py+30); ctx.stroke();
  ctx.fillStyle='#333'; ctx.font='12px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('✓ 22 exact   ⚠ 2 fuzzy   ✗ 0 unmatched', PX+12, py+15);
  py+=30;

  // Table header
  ctx.fillStyle='#ebebeb'; ctx.fillRect(PX,py,PW,26);
  ctx.strokeStyle='#ddd'; ctx.beginPath(); ctx.moveTo(PX,py+26); ctx.lineTo(PX+PW,py+26); ctx.stroke();
  const tc=[28,160,162,100];
  let tcx=PX+5;
  ['','Nova Student','Moodle Match','Grade'].forEach((h,i)=>{
    ctx.fillStyle='#444'; ctx.font='bold 10px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(h,tcx,py+13); tcx+=tc[i];
  });
  py+=26;

  const prows=[
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Anderson, James',    m:'James Anderson',    g:'78.3'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Brown, Sarah',       m:'Sarah Brown',       g:'91.7'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Chen, Michael',      m:'Michael Chen',      g:'67.7'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:"Davis, Emily",       m:"Emily Davis",       g:'87.7'},
    {ic:'⚠',bg:'#fffbe6',ic_c:'#7a5500',nova:"O'Brien, Fiona",   m:"Fiona O Brien",     g:'72.0'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Foster, Robert',     m:'Robert Foster',     g:'57.7'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Garcia, Amanda',     m:'Amanda Garcia',     g:'96.0'},
    {ic:'⚠',bg:'#fffbe6',ic_c:'#7a5500',nova:'Hassan-Ali, Yusuf', m:'Yusuf Hassan Ali',  g:'84.3'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Ibrahim, Fatima',    m:'Fatima Ibrahim',    g:'93.0'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Jones, Derek',       m:'Derek Jones',       g:'61.3'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Kim, Christine',     m:'Christine Kim',     g:'88.0'},
    {ic:'✓',bg:'#f0fff0',ic_c:GREEN,   nova:'Lee, Daniel',        m:'Daniel Lee',        g:'74.7'},
  ];

  prows.forEach(row=>{
    ctx.fillStyle=row.bg; ctx.fillRect(PX,py,PW,24);
    ctx.strokeStyle='#eee'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(PX,py+24); ctx.lineTo(PX+PW,py+24); ctx.stroke();
    tcx=PX+5;
    ctx.fillStyle=row.ic_c; ctx.font='bold 11px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(row.ic,tcx,py+12); tcx+=tc[0];
    ctx.fillStyle='#333'; ctx.font='11px Arial'; ctx.fillText(row.nova,tcx,py+12); tcx+=tc[1];
    ctx.fillStyle='#555'; ctx.fillText(row.m,tcx,py+12); tcx+=tc[2];
    ctx.fillStyle='#333'; ctx.font='bold 11px Arial'; ctx.fillText(row.g,tcx,py+12);
    py+=24;
  });

  // Skip checkbox
  ctx.fillStyle='#fff8e1'; ctx.fillRect(PX,py,PW,30);
  ctx.strokeStyle='#ffe082'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(PX,py+30); ctx.lineTo(PX+PW,py+30); ctx.stroke();
  ctx.fillStyle='#555'; ctx.font='12px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('☑  Skip cells that already have a grade (recommended)', PX+12, py+15);
  py+=30;

  // Fill button
  ctx.fillStyle=GREEN; rr(ctx,PX+8,py+8,PW-16,36,5); ctx.fill();
  ctx.fillStyle=WHITE; ctx.font='bold 13px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('✓ Fill 22 grades into "Assignment 1"', PX+PW/2, py+26);

  // Caption
  ctx.fillStyle=rgba(BLUE,0.94); rr(ctx,20,H-50,W-40,34,6); ctx.fill();
  ctx.fillStyle=WHITE; ctx.font='bold 14px Arial';
  ctx.fillText('Preview panel shows every student match before you commit — fuzzy matches flagged in yellow', W/2,H-33);

  save(C,'screenshot-4-preview-panel.png');
}

// ─── 6. Screenshot 5 — Fill All Panel (1280×800) ─────────────────────────────
function makeFillAll() {
  const W=1280, H=800, C=createCanvas(W,H), ctx=C.getContext('2d');

  ctx.fillStyle='#c8c8c8'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#ddd'; ctx.fillRect(0,0,W,56);
  ctx.strokeStyle='#bbb'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(0,56); ctx.lineTo(W,56); ctx.stroke();
  ctx.fillStyle=BLUE; ctx.fillRect(0,56,W,40);
  ctx.fillStyle=WHITE; ctx.font='bold 13px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('⬇ Nova Sync', 12,76);
  ctx.fillStyle='rgba(0,0,0,0.32)'; ctx.fillRect(0,96,W,H-96);

  // Fill All panel — wide, centred
  const PW=640, PX=(W-PW)/2, PY=104;
  ctx.shadowColor='rgba(0,0,0,0.3)'; ctx.shadowBlur=24;
  ctx.fillStyle=WHITE; rr(ctx,PX,PY,PW,592,8); ctx.fill();
  ctx.shadowBlur=0; ctx.strokeStyle='#bbb'; ctx.lineWidth=1; rr(ctx,PX,PY,PW,592,8); ctx.stroke();

  // Header
  ctx.fillStyle=BLUE; rr(ctx,PX,PY,PW,40,8); ctx.fill();
  ctx.fillRect(PX,PY+20,PW,20);
  ctx.fillStyle=WHITE; ctx.font='bold 14px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('Fill All — 6/6 rows matched', PX+14,PY+20);
  ctx.font='18px Arial'; ctx.textAlign='right';
  ctx.fillText('✕', PX+PW-14,PY+20);

  let py=PY+40;

  // Summary
  ctx.fillStyle='#f0f8ff'; ctx.fillRect(PX,py,PW,30);
  ctx.strokeStyle='#b3d9f7'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(PX,py+30); ctx.lineTo(PX+PW,py+30); ctx.stroke();
  ctx.fillStyle='#333'; ctx.font='12px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('Up to  144  grade entries across  6  matched rows.', PX+12,py+15);
  py+=30;

  // Skip checkbox
  ctx.fillStyle='#fff8e1'; ctx.fillRect(PX,py,PW,30);
  ctx.strokeStyle='#ffe082'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(PX,py+30); ctx.lineTo(PX+PW,py+30); ctx.stroke();
  ctx.fillStyle='#555'; ctx.font='12px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('☑  Skip cells that already have a grade (recommended)', PX+12,py+15);
  py+=30;

  // Table header
  ctx.fillStyle='#e8e8e8'; ctx.fillRect(PX,py,PW,26);
  ctx.strokeStyle='#ddd'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(PX,py+26); ctx.lineTo(PX+PW,py+26); ctx.stroke();
  const tc=[210,340,70];
  let tcx=PX+6;
  ['Nova Row','Moodle Activity (auto-matched)','#'].forEach((h,i)=>{
    ctx.fillStyle='#444'; ctx.font='bold 11px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(h,tcx,py+13); tcx+=tc[i];
  });
  py+=26;

  const rows=[
    {nova:'COMP1000 › Assignment 1', act:'Assignment 1 total', n:24, mapped:true},
    {nova:'COMP1000 › Assignment 2', act:'Assignment 2 total', n:24, mapped:true},
    {nova:'COMP1000 › Quiz 1',       act:'Quiz 1 total',       n:24, mapped:true},
    {nova:'COMP1000 › Quiz 2',       act:'Quiz 2 total',       n:24, mapped:true},
    {nova:'COMP1000 › Midterm',      act:'Midterm Exam',       n:24, mapped:false},
    {nova:'COMP1000 › Final Exam',   act:'Final Exam',         n:24, mapped:false},
  ];

  rows.forEach((row,ri)=>{
    const ry=py;
    ctx.fillStyle='#f0fff0'; ctx.fillRect(PX,ry,PW,38);
    ctx.strokeStyle='#e8e8e8'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(PX,ry+38); ctx.lineTo(PX+PW,ry+38); ctx.stroke();

    tcx=PX+6;
    ctx.fillStyle='#333'; ctx.font='12px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(row.nova, tcx, ry+19); tcx+=tc[0];

    // Activity dropdown
    inputField(ctx,tcx,ry+7,tc[1]-12,24, row.act + '  ▾', row.mapped?ORANGE:'#ccc');
    if(row.mapped){
      // "course-mapped" badge
      ctx.fillStyle='#fff3e0'; rr(ctx,tcx+tc[1]-94,ry+10,84,16,3); ctx.fill();
      ctx.strokeStyle='#e65c00'; ctx.lineWidth=1; ctx.stroke();
      ctx.fillStyle=ORANGE; ctx.font='bold 9px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('course-mapped', tcx+tc[1]-52, ry+18);
      ctx.textAlign='left';
    }
    tcx+=tc[1];

    ctx.fillStyle='#333'; ctx.font='bold 12px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(String(row.n), tcx+tc[2]/2, ry+19);
    ctx.textAlign='left';

    py+=38;
  });

  // Fill button
  ctx.fillStyle=BLUE; rr(ctx,PX+8,py+10,PW-16,38,5); ctx.fill();
  ctx.fillStyle=WHITE; ctx.font='bold 14px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('✓ Fill All Matched Activities', PX+PW/2, py+29);

  // Caption
  ctx.fillStyle=rgba(BLUE,0.94); rr(ctx,20,H-50,W-40,34,6); ctx.fill();
  ctx.fillStyle=WHITE; ctx.font='bold 14px Arial';
  ctx.fillText('Fill All auto-maps every Nova row — course-mapped rows highlighted in orange, all adjustable via dropdown', W/2,H-33);

  save(C,'screenshot-5-fill-all.png');
}

// ─── 7. Small Promo Tile 440×280 ─────────────────────────────────────────────
function makeSmallPromo() {
  const W=440, H=280, C=createCanvas(W,H), ctx=C.getContext('2d');

  // Background gradient
  const g=ctx.createLinearGradient(0,0,W,H);
  g.addColorStop(0,'#002d4d'); g.addColorStop(0.6,BLUE); g.addColorStop(1,'#003d5c');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

  // Dot grid
  ctx.fillStyle='rgba(255,255,255,0.04)';
  for(let x=18;x<W;x+=30) for(let y=18;y<H;y+=30){
    ctx.beginPath(); ctx.arc(x,y,1.5,0,Math.PI*2); ctx.fill();
  }

  // Icon badge (top-left)
  const ig=ctx.createLinearGradient(18,18,98,98);
  ig.addColorStop(0,'#0082cc'); ig.addColorStop(1,'#003f6e');
  ctx.fillStyle=ig; rr(ctx,18,18,80,80,14); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.18)'; ctx.lineWidth=1.5; ctx.stroke();

  ctx.fillStyle=WHITE; ctx.font='bold 26px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('M',44,53);
  ctx.fillStyle='#ffd080'; ctx.fillText('N',72,53);
  ctx.strokeStyle='#ffd080'; ctx.lineWidth=3; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(53,58); ctx.lineTo(63,58); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(59,52); ctx.lineTo(64,58); ctx.lineTo(59,64); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.font='8px Arial';
  ctx.fillText('Grade Sync',58,74);

  // Title
  ctx.fillStyle=WHITE; ctx.font='bold 24px Arial'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText('Moodle → Nova', 112, 28);
  ctx.fillText('Grade Sync', 112, 58);

  // Tagline
  ctx.fillStyle='rgba(255,255,255,0.70)'; ctx.font='13px Arial'; ctx.textBaseline='top';
  ctx.fillText('Transfer grades in seconds', 112, 96);
  ctx.fillText('No copy-paste. No errors.', 112, 114);

  // Divider
  ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(18,120); ctx.lineTo(W-18,120); ctx.stroke();

  // Feature bullets (2 columns)
  const bullets=[
    ['📋','One-click Capture'],['🎯','Smart name matching'],
    ['⚙️','Per-course mapping'], ['↩','Preview & undo'],
  ];
  ctx.font='12px Arial'; ctx.textBaseline='middle';
  bullets.forEach((b,i)=>{
    const col=i%2, row=Math.floor(i/2);
    const x=26+col*210, y=142+row*38;
    ctx.fillStyle='rgba(255,255,255,0.18)'; rr(ctx,x,y-14,196,30,5); ctx.fill();
    ctx.font='16px Arial'; ctx.fillStyle=WHITE; ctx.textAlign='left';
    ctx.fillText(b[0], x+10, y);
    ctx.font='12px Arial'; ctx.fillStyle='rgba(255,255,255,0.85)';
    ctx.fillText(b[1], x+34, y);
  });

  // Footer stripe
  ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(0,H-36,W,36);
  ctx.fillStyle='rgba(255,255,255,0.50)'; ctx.font='11px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Chrome & Edge  ·  All data stays in your browser  ·  Willis College', W/2, H-18);

  save(C,'promo-small-440x280.png');
}

// ─── 8. Marquee Promo Tile 1400×560 ──────────────────────────────────────────
function makeMarquee() {
  const W=1400, H=560, C=createCanvas(W,H), ctx=C.getContext('2d');

  // Background gradient (left-to-right this time for a wide banner feel)
  const g=ctx.createLinearGradient(0,0,W,0);
  g.addColorStop(0,'#001f36'); g.addColorStop(0.45,BLUE); g.addColorStop(1,'#003355');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

  // Dot grid
  ctx.fillStyle='rgba(255,255,255,0.035)';
  for(let x=20;x<W;x+=36) for(let y=20;y<H;y+=36){
    ctx.beginPath(); ctx.arc(x,y,2,0,Math.PI*2); ctx.fill();
  }

  // Left: large icon
  const ig=ctx.createLinearGradient(54,80,230,256);
  ig.addColorStop(0,'#0090dd'); ig.addColorStop(1,'#003d6e');
  ctx.fillStyle=ig; rr(ctx,54,80,176,176,28); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.20)'; ctx.lineWidth=2; ctx.stroke();

  ctx.fillStyle=WHITE; ctx.font='bold 68px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('M', 108, 160);
  ctx.fillStyle='#ffd080'; ctx.fillText('N', 176, 160);
  ctx.strokeStyle='#ffd080'; ctx.lineWidth=5.5; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(128,168); ctx.lineTo(156,168); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(144,155); ctx.lineTo(158,168); ctx.lineTo(144,181); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.font='13px Arial';
  ctx.fillText('Grade Sync', 142, 212);

  // Centre: title + tagline
  const midX=290;
  ctx.fillStyle=WHITE; ctx.font='bold 52px Arial'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText('Moodle → Nova Grade Sync', midX, 82);

  ctx.fillStyle='rgba(255,255,255,0.72)'; ctx.font='22px Arial'; ctx.textBaseline='top';
  ctx.fillText('Transfer grades from your Moodle gradebook to Nova in seconds.', midX, 152);
  ctx.fillText('No copy-paste. No spreadsheets. No errors.', midX, 184);

  // Divider
  ctx.strokeStyle='rgba(255,255,255,0.14)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(midX,228); ctx.lineTo(W-50,228); ctx.stroke();

  // Feature grid — 4 cards in a row
  const cards=[
    {ic:'📋', t:'One-Click Capture',    d:'Grab any Moodle gradebook column instantly — single activity or all at once'},
    {ic:'🎯', t:'Smart Matching',        d:'Fuzzy student-name matching handles accents, hyphens & comma-flipped names'},
    {ic:'⚙️', t:'Per-Course Mappings',   d:'Define custom Nova-row → Moodle-column rules for grouped activity structures'},
    {ic:'↩',  t:'Safe & Reversible',     d:'Full preview before filling · in-session Undo · grades never auto-submitted'},
  ];
  const cW=258, cH=176, gap=16, startX=midX;
  cards.forEach((c,i)=>{
    const x=startX+i*(cW+gap), y=248;
    ctx.fillStyle='rgba(255,255,255,0.09)'; rr(ctx,x,y,cW,cH,10); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.16)'; ctx.lineWidth=1; ctx.stroke();

    ctx.font='30px Arial'; ctx.fillStyle=WHITE; ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillText(c.ic, x+cW/2, y+16);
    ctx.font='bold 13px Arial'; ctx.fillStyle='#ffd080';
    ctx.fillText(c.t, x+cW/2, y+56);

    // Word-wrap description
    ctx.font='11px Arial'; ctx.fillStyle='rgba(255,255,255,0.72)';
    const words=c.d.split(' '); let line='', ly=y+78;
    for(const w of words){
      const test=line?line+' '+w:w;
      if(ctx.measureText(test).width>cW-20){ ctx.fillText(line,x+cW/2,ly); line=w; ly+=16; }
      else line=test;
    }
    if(line) ctx.fillText(line,x+cW/2,ly);
  });

  // Right accent bar
  const barX=W-48;
  const ag=ctx.createLinearGradient(barX,0,barX,H);
  ag.addColorStop(0,ORANGE); ag.addColorStop(1,'#ff8c40');
  ctx.fillStyle=ag; rr(ctx,barX,0,48,H,0); ctx.fill();
  ctx.fillStyle=WHITE; ctx.font='bold 13px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.save(); ctx.translate(barX+24,H/2); ctx.rotate(-Math.PI/2);
  ctx.fillText('Chrome & Edge Extension', 0, 0);
  ctx.restore();

  // Footer
  ctx.fillStyle='rgba(0,0,0,0.22)'; ctx.fillRect(0,H-44,W-48,44);
  ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.font='12px Arial'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText('All grade data stays in your browser — no external servers, no credentials stored  ·  Willis College', midX, H-22);

  save(C,'promo-marquee-1400x560.png');
}

// ─── Run ──────────────────────────────────────────────────────────────────────
makeIcon();
makeHero();
makeMoodleCapture();
makeNovaBar();
makePreviewPanel();
makeFillAll();
makeSmallPromo();
makeMarquee();

console.log('\nAll assets saved to: store-assets/');
