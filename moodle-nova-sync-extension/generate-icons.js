// @ts-nocheck
// Generates extension icons: icons/icon16.png, icons/icon48.png, icons/icon128.png
// Design: bold circular sync arrow containing three vivid grade bars — no text, pure graphic.
// Run from the extension folder: node generate-icons.js

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, 'icons');
fs.mkdirSync(ICONS_DIR, { recursive: true });

function save(canvas, name) {
  const p = path.join(ICONS_DIR, name);
  fs.writeFileSync(p, canvas.toBuffer('image/png'));
  const kb = (fs.statSync(p).size / 1024).toFixed(0);
  console.log(`✓  ${name}  (${kb} KB)`);
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Draw a bold arrowhead at the END of an arc.
// angle = tangent direction at arc end (endAngle + PI/2)
// tip = {x, y} = the point of the arrow
function arrowHead(ctx, tip, angle, size) {
  const spread = 0.62; // radians half-angle of chevron
  ctx.beginPath();
  ctx.moveTo(tip.x + size * Math.cos(angle - spread),
             tip.y + size * Math.sin(angle - spread));
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tip.x + size * Math.cos(angle + spread),
             tip.y + size * Math.sin(angle + spread));
  ctx.stroke();
}

// ── 128 × 128 ───────────────────────────────────────────────────────────────
function makeIcon128() {
  const S = 128;
  const C = createCanvas(S, S);
  const ctx = C.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  /* ── Background ──────────────────────────────────────────────────── */
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, '#0E2060');
  bg.addColorStop(0.55, '#091440');
  bg.addColorStop(1, '#04091E');
  ctx.fillStyle = bg;
  rr(ctx, 0, 0, S, S, 22);
  ctx.fill();

  // Radial highlight — subtle light source top-left
  const hl = ctx.createRadialGradient(36, 30, 4, 52, 46, 68);
  hl.addColorStop(0, 'rgba(120,180,255,0.18)');
  hl.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hl;
  ctx.beginPath(); ctx.arc(64, 64, 64, 0, Math.PI * 2); ctx.fill();

  /* ── Sync-ring outer glow ────────────────────────────────────────── */
  const cx = 64, cy = 64, arcR = 44;
  const arcStart = Math.PI * 0.12; // ~22°
  const arcEnd   = Math.PI * 1.84; // ~331°

  ctx.save();
  ctx.strokeStyle = 'rgba(255,160,30,0.18)';
  ctx.lineWidth = 22;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, arcR, arcStart, arcEnd); ctx.stroke();
  ctx.restore();

  /* ── Grade bars (inside the circle) ─────────────────────────────── */
  // Three vivid bars: emerald / sky-blue / amber, left-aligned, stacked
  const bars = [
    { y: 48, w: 56, color: '#22D3EE', glow: '#22D3EE' }, // cyan  — longest
    { y: 62, w: 44, color: '#4ADE80', glow: '#4ADE80' }, // green
    { y: 76, w: 34, color: '#FBBF24', glow: '#FBBF24' }, // amber — shortest
  ];
  const barX = 28, barH = 12;

  bars.forEach(b => {
    ctx.save();
    ctx.shadowColor = b.glow;
    ctx.shadowBlur = 10;
    ctx.fillStyle = b.color;
    rr(ctx, barX, b.y, b.w, barH, barH / 2);
    ctx.fill();
    ctx.restore();

    // Subtle inner-top highlight (gives each bar a slight 3-D feel)
    const hiGrad = ctx.createLinearGradient(barX, b.y, barX, b.y + barH);
    hiGrad.addColorStop(0, 'rgba(255,255,255,0.35)');
    hiGrad.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = hiGrad;
    rr(ctx, barX, b.y, b.w, barH, barH / 2);
    ctx.fill();
  });

  /* ── Sync arc ────────────────────────────────────────────────────── */
  const arcGrad = ctx.createLinearGradient(
    cx - arcR, cy, cx + arcR, cy
  );
  arcGrad.addColorStop(0,   '#FF8C00');
  arcGrad.addColorStop(0.5, '#FFB600');
  arcGrad.addColorStop(1,   '#FFE000');

  ctx.save();
  ctx.strokeStyle = arcGrad;
  ctx.lineWidth = 13;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, arcR, arcStart, arcEnd); ctx.stroke();
  ctx.restore();

  /* ── Arrowhead ───────────────────────────────────────────────────── */
  const ex = cx + arcR * Math.cos(arcEnd);
  const ey = cy + arcR * Math.sin(arcEnd);
  const tangent = arcEnd + Math.PI / 2;
  ctx.save();
  ctx.strokeStyle = '#FFE000';
  ctx.lineWidth = 13;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  arrowHead(ctx, { x: ex, y: ey }, tangent, 13);
  ctx.restore();

  /* ── Rim highlight (thin bright edge at top of bg) ───────────────── */
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5;
  rr(ctx, 1, 1, S - 2, S - 2, 21);
  ctx.stroke();
  ctx.restore();

  save(C, 'icon128.png');
}

// ── 48 × 48 ─────────────────────────────────────────────────────────────────
function makeIcon48() {
  const S = 48;
  const C = createCanvas(S, S);
  const ctx = C.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  /* Background */
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, '#0E2060'); bg.addColorStop(1, '#04091E');
  ctx.fillStyle = bg; rr(ctx, 0, 0, S, S, 9); ctx.fill();

  // Radial highlight
  const hl = ctx.createRadialGradient(14, 12, 2, 20, 18, 26);
  hl.addColorStop(0, 'rgba(120,180,255,0.20)');
  hl.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hl;
  ctx.beginPath(); ctx.arc(24, 24, 24, 0, Math.PI * 2); ctx.fill();

  /* Sync glow */
  const cx = 24, cy = 24, arcR = 16.5;
  const arcStart = Math.PI * 0.12, arcEnd = Math.PI * 1.84;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,160,30,0.20)';
  ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, arcR, arcStart, arcEnd); ctx.stroke();
  ctx.restore();

  /* Grade bars — 2 bars to keep clean at 48px */
  const bars = [
    { y: 18, w: 21, color: '#22D3EE' },
    { y: 25, w: 16.5, color: '#4ADE80' },
    { y: 32, w: 13, color: '#FBBF24' },
  ];
  const barX = 10.5, barH = 5;
  bars.forEach(b => {
    ctx.save();
    ctx.shadowColor = b.color; ctx.shadowBlur = 5;
    ctx.fillStyle = b.color;
    rr(ctx, barX, b.y, b.w, barH, barH / 2); ctx.fill();
    ctx.restore();
    const hiGrad = ctx.createLinearGradient(barX, b.y, barX, b.y + barH);
    hiGrad.addColorStop(0, 'rgba(255,255,255,0.30)');
    hiGrad.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = hiGrad;
    rr(ctx, barX, b.y, b.w, barH, barH / 2); ctx.fill();
  });

  /* Sync arc */
  const ag = ctx.createLinearGradient(cx - arcR, cy, cx + arcR, cy);
  ag.addColorStop(0, '#FF8C00'); ag.addColorStop(0.5, '#FFB600'); ag.addColorStop(1, '#FFE000');
  ctx.save();
  ctx.strokeStyle = ag; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, arcR, arcStart, arcEnd); ctx.stroke();
  ctx.restore();

  /* Arrowhead */
  const ex = cx + arcR * Math.cos(arcEnd), ey = cy + arcR * Math.sin(arcEnd);
  ctx.save();
  ctx.strokeStyle = '#FFE000'; ctx.lineWidth = 5;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  arrowHead(ctx, { x: ex, y: ey }, arcEnd + Math.PI / 2, 5);
  ctx.restore();

  /* Rim */
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
  rr(ctx, 0.5, 0.5, S - 1, S - 1, 8.5); ctx.stroke();
  ctx.restore();

  save(C, 'icon48.png');
}

// ── 16 × 16 ─────────────────────────────────────────────────────────────────
function makeIcon16() {
  const S = 16;
  const C = createCanvas(S, S);
  const ctx = C.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  /* Background */
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, '#0E2060'); bg.addColorStop(1, '#04091E');
  ctx.fillStyle = bg; rr(ctx, 0, 0, S, S, 3); ctx.fill();

  /* Two tiny grade bar hints */
  ctx.fillStyle = '#22D3EE';
  rr(ctx, 2.5, 5, 7, 2.5, 1.25); ctx.fill();
  ctx.fillStyle = '#4ADE80';
  rr(ctx, 2.5, 8.5, 5.5, 2.5, 1.25); ctx.fill();

  /* Bold sync arc — this dominates at 16px */
  const cx = 11, cy = 10, arcR = 4.5;
  const arcStart = Math.PI * 0.14, arcEnd = Math.PI * 1.82;

  ctx.save();
  ctx.strokeStyle = '#FFB600'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, arcR, arcStart, arcEnd); ctx.stroke();
  ctx.restore();

  /* Arrowhead */
  const ex = cx + arcR * Math.cos(arcEnd), ey = cy + arcR * Math.sin(arcEnd);
  ctx.save();
  ctx.strokeStyle = '#FFB600'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  arrowHead(ctx, { x: ex, y: ey }, arcEnd + Math.PI / 2, 2);
  ctx.restore();

  save(C, 'icon16.png');
}

makeIcon128();
makeIcon48();
makeIcon16();

console.log('\nIcons saved to: icons/');
