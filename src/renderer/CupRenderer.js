/**
 * Cup/mug preview renderer.
 *
 * Draws a StoneLayout wrapped onto a schematic cup body. Per docs/ARCHITECTURE.md, the renderer
 * visualizes StoneLayout and never computes geometry: it has no knowledge of Project, Layer, or
 * any layer type (text/circle/rectangle/future shapes) — only the StoneLayout it is handed and
 * plain display options (cup color, wrap mode, rotation, zoom).
 */

import { drawStone } from './CanvasRenderer2D.js';

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
  const rot = rotationDeg * Math.PI / 180, side = Math.cos(rot) >= 0 ? 1 : -1, showHandle = Math.cos(rot) > -.35;

  if (showHandle) {
    ctx.lineCap = 'round';
    ctx.lineWidth = w * .054 * zoom;
    ctx.strokeStyle = shade(cupColor, -28);
    ctx.beginPath();
    ctx.ellipse(cx + side * topW * .50, cy, h * .125 * zoom, h * .23 * zoom, 0, -Math.PI / 2, Math.PI / 2, side < 0);
    ctx.stroke();
    ctx.lineWidth = w * .036 * zoom;
    ctx.strokeStyle = shade(cupColor, 12);
    ctx.beginPath();
    ctx.ellipse(cx + side * topW * .50, cy, h * .125 * zoom, h * .23 * zoom, 0, -Math.PI / 2, Math.PI / 2, side < 0);
    ctx.stroke();
  }

  const body = ctx.createLinearGradient(cx - topW / 2, 0, cx + topW / 2, 0);
  body.addColorStop(0, shade(cupColor, -15));
  body.addColorStop(.28, shade(cupColor, 4));
  body.addColorStop(.52, shade(cupColor, 12));
  body.addColorStop(.75, cupColor);
  body.addColorStop(1, shade(cupColor, -18));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cx - topW / 2, topY);
  ctx.lineTo(cx + topW / 2, topY);
  ctx.lineTo(cx + botW / 2, botY);
  ctx.quadraticCurveTo(cx, botY + h * .018, cx - botW / 2, botY);
  ctx.closePath();
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
