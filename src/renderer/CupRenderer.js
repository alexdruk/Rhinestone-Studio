/**
 * Cup/mug preview renderer.
 *
 * Draws a StoneLayout wrapped onto a schematic cup body. Per docs/ARCHITECTURE.md, the renderer
 * visualizes StoneLayout and never computes geometry: it has no knowledge of Project, Layer, or
 * any layer type (text/circle/rectangle/future shapes) — only the StoneLayout it is handed and
 * plain display options (cup color, wrap mode, rotation, zoom).
 */

import { drawStone } from './CanvasRenderer2D.js';

// Handle geometry/behavior constants (RS-0003.5D2). Named here instead of left as unexplained
// inline numbers so the handle's attachment/animation behavior is auditable in one place. The
// cup body silhouette drawn below is itself rotation-invariant (rotationDeg only affects stone
// placement, not the body's screen shape), so the handle is likewise anchored to a fixed flank
// of that silhouette; only its opacity/bulge respond to rotationDeg, via a continuous cosine
// falloff — this keeps it visually consistent with the body and guarantees no discrete jump at
// any angle (there is no side-flip branch anywhere in this file).
const HANDLE_FADE_LOW = -0.4; // cos(rotationDeg) at/below which the handle is fully hidden (near the true back view)
const HANDLE_FADE_HIGH = 0.05; // cos(rotationDeg) at/above which the handle is fully visible (covers front + left/right views)
const HANDLE_MAX_BULGE_FACTOR = 0.30; // outward bulge of the handle loop, relative to viewport width
const HANDLE_INNER_BULGE_FACTOR = 0.42; // inner-boundary bulge, relative to the outer bulge (creates the loop's opening)
const HANDLE_THICKNESS_FACTOR = 0.085; // handle band thickness, relative to viewport height
const HANDLE_ATTACH_TOP_FRACTION = 0.16; // where the handle meets the wall, as a fraction of cup height from the top
const HANDLE_ATTACH_BOTTOM_FRACTION = 0.83;
const BODY_SHADE_STOPS = 10; // number of gradient stops used to approximate smooth cylindrical shading

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../geometry/StoneLayout.js').StoneLayout} stoneLayout
 * @param {object} options
 * @param {number} options.widthPx
 * @param {number} options.heightPx
 * @param {number} options.dpr
 * @param {string} options.cupColor Hex color, e.g. '#1f3556'.
 * @param {'front'|'wide'|'half'|'full'} options.wrap
 * @param {number} options.rotationDeg
 * @param {number} options.zoom
 */
export function renderCup(ctx, stoneLayout, { widthPx: w, heightPx: h, dpr, cupColor, wrap, rotationDeg, zoom }) {
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#fbfdff');
  bg.addColorStop(1, '#e9eef5');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h * .54, cupH = h * .64 * zoom, topW = w * .52 * zoom, botW = w * .43 * zoom;
  const topY = cy - cupH / 2, botY = cy + cupH / 2;
  const rot = rotationDeg * Math.PI / 180;

  drawHandle(ctx, { cx, topY, botY, topW, botW, cupH, w, h, dpr, zoom, cupColor, rot });

  const body = ctx.createLinearGradient(cx - topW / 2, 0, cx + topW / 2, 0);
  for (let i = 0; i <= BODY_SHADE_STOPS; i++) {
    const t = i / BODY_SHADE_STOPS;
    const lambert = Math.cos((t - 0.5) * Math.PI); // 1 at center, 0 at both silhouette edges — smooth cylindrical falloff
    body.addColorStop(t, shade(cupColor, -30 + lambert * 42));
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cx - topW / 2, topY);
  ctx.lineTo(cx + topW / 2, topY);
  ctx.lineTo(cx + botW / 2, botY);
  ctx.quadraticCurveTo(cx, botY + h * .018, cx - botW / 2, botY);
  ctx.closePath();
  ctx.fill();

  // Soft vertical sheen over the body — a translucent repaint of the same path, no hard edges.
  const sheen = ctx.createLinearGradient(cx - topW * .18, 0, cx + topW * .08, 0);
  sheen.addColorStop(0, 'rgba(255,255,255,0)');
  sheen.addColorStop(.5, 'rgba(255,255,255,.16)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,0,0,.18)';
  ctx.lineWidth = 1.5 * dpr;
  ctx.stroke();

  ctx.fillStyle = shade(cupColor, -22);
  ctx.beginPath();
  ctx.ellipse(cx, topY, topW / 2, h * .032 * zoom, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shade(cupColor, 35);
  ctx.lineWidth = 4 * dpr * zoom;
  ctx.stroke();
  ctx.fillStyle = shade(cupColor, -50);
  ctx.beginPath();
  ctx.ellipse(cx, topY, topW * .42, h * .019 * zoom, 0, 0, Math.PI * 2);
  ctx.fill();

  const boundingBoxMm = stoneLayout.getBoundingBox();
  const b = boundingBoxMm
    ? { x: boundingBoxMm.minXmm, y: boundingBoxMm.minYmm, width: boundingBoxMm.widthMm, height: boundingBoxMm.heightMm }
    : { x: 0, y: 0, width: 0, height: 0 };
  const labelW = topW * .72, labelH = cupH * .32;
  const stoneScale = Math.min(labelW / Math.max(1, b.width), labelH / Math.max(1, b.height));
  const ly = topY + cupH * .52 - (b.y + b.height / 2) * stoneScale;

  if (wrap === 'front') {
    const lx = cx - (b.x + b.width / 2) * stoneScale;
    for (const st of stoneLayout.stones) {
      drawStone(ctx, lx + st.xMm * stoneScale, ly + st.yMm * stoneScale, Math.max(1.15, st.sizeMm * stoneScale * .45), st.color, 'cup');
    }
    return;
  }

  const wrapDeg = { wide: 115, half: 180, full: 300 }[wrap] || 115;
  const maxTheta = wrapDeg * Math.PI / 180;
  for (const st of stoneLayout.stones) {
    const theta = ((st.xMm - (b.x + b.width / 2)) / Math.max(b.width, 1)) * maxTheta + rot;
    const front = Math.cos(theta);
    if (front < .10) continue;
    const yy = ly + st.yMm * stoneScale;
    const t = (yy - topY) / cupH;
    if (t < .06 || t > .95) continue;
    const radius = (topW * (1 - t) + botW * t) / 2;
    const xx = cx + Math.sin(theta) * radius * .82;
    const persp = .62 + .38 * front;
    drawStone(ctx, xx, yy, Math.max(1.1, st.sizeMm * stoneScale * .42 * persp), st.color, 'cup');
  }
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Half-width of the tapered cup wall at a given y — the same linear interpolation the body
// silhouette's straight sides use, so the handle's attachment points always land exactly on the
// wall regardless of how much the body tapers between topW and botW.
function wallHalfWidthAt(y, topY, botY, topW, botW) {
  const t = Math.max(0, Math.min(1, (y - topY) / Math.max(1e-6, botY - topY)));
  return (topW * (1 - t) + botW * t) / 2;
}

// Draws the cup handle as a filled loop anchored to the tapered wall at both ends, on a fixed
// screen-space flank (the body silhouette itself never rotates in this renderer — only stone
// placement does — so pinning the handle to it keeps the two visually consistent). Opacity and
// bulge are both continuous functions of cos(rotationDeg) (pure trig, no branches), so there is
// no discrete side flip and no visible jump at any rotation angle, including exactly the
// Left/Right view buttons (±90°): both attachment points always sit exactly on the tapered wall.
function drawHandle(ctx, { cx, topY, botY, topW, botW, cupH, w, h, dpr, zoom, cupColor, rot }) {
  const presence = smoothstep(HANDLE_FADE_LOW, HANDLE_FADE_HIGH, Math.cos(rot));
  if (presence <= 0.01) return;

  const attachTopY = topY + cupH * HANDLE_ATTACH_TOP_FRACTION;
  const attachBotY = topY + cupH * HANDLE_ATTACH_BOTTOM_FRACTION;
  const attachTopX = cx + wallHalfWidthAt(attachTopY, topY, botY, topW, botW);
  const attachBotX = cx + wallHalfWidthAt(attachBotY, topY, botY, topW, botW);

  const bulge = w * HANDLE_MAX_BULGE_FACTOR * zoom * (0.45 + 0.55 * presence); // slight foreshortening as it fades
  const thickness = Math.max(2 * dpr, h * HANDLE_THICKNESS_FACTOR * zoom);
  const midY1 = attachTopY + (attachBotY - attachTopY) * 0.30;
  const midY2 = attachTopY + (attachBotY - attachTopY) * 0.70;
  const innerBulge = bulge * HANDLE_INNER_BULGE_FACTOR;
  const innerTopX = attachTopX + thickness * 0.55;
  const innerBotX = attachBotX + thickness * 0.55;

  ctx.save();
  ctx.globalAlpha = presence;

  // Soft contact shadows fuse the handle ends into the wall instead of leaving a visible seam.
  ctx.fillStyle = 'rgba(0,0,0,.15)';
  for (const [ax, ay] of [[attachTopX, attachTopY], [attachBotX, attachBotY]]) {
    ctx.beginPath();
    ctx.ellipse(ax, ay, thickness * 0.65, thickness * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const grad = ctx.createLinearGradient(attachTopX, attachTopY, attachTopX + bulge, (attachTopY + attachBotY) / 2);
  grad.addColorStop(0, shade(cupColor, -24));
  grad.addColorStop(.55, shade(cupColor, 14));
  grad.addColorStop(1, shade(cupColor, -8));

  ctx.beginPath();
  ctx.moveTo(attachTopX, attachTopY);
  ctx.bezierCurveTo(attachTopX + bulge * .95, midY1, attachBotX + bulge * .95, midY2, attachBotX, attachBotY);
  ctx.lineTo(innerBotX, attachBotY);
  ctx.bezierCurveTo(innerBotX + innerBulge * .9, midY2, innerTopX + innerBulge * .9, midY1, innerTopX, attachTopY);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = shade(cupColor, -42);
  ctx.lineWidth = Math.max(1, 1.1 * dpr);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(0,0,0,.20)';
  ctx.lineWidth = Math.max(.8, .9 * dpr);
  ctx.beginPath();
  ctx.moveTo(innerTopX, attachTopY);
  ctx.bezierCurveTo(innerTopX + innerBulge * .9, midY1, innerBotX + innerBulge * .9, midY2, innerBotX, attachBotY);
  ctx.stroke();

  ctx.restore();
}

function shade(hex, pct) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  let r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  const f = pct >= 0 ? 255 : 0, p = Math.abs(pct) / 100;
  r = Math.round(r + (f - r) * p);
  g = Math.round(g + (f - g) * p);
  b = Math.round(b + (f - b) * p);
  return `rgb(${r},${g},${b})`;
}
