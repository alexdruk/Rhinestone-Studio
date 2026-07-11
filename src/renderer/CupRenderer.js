/**
 * Cup/mug preview renderer.
 *
 * Draws a StoneLayout wrapped onto a schematic cup body. Per docs/ARCHITECTURE.md, the renderer
 * visualizes StoneLayout and never computes geometry: it has no knowledge of Project, Layer, or
 * any layer type (text/circle/rectangle/future shapes) — only the StoneLayout it is handed and
 * plain display options (cup color, wrap mode, rotation, zoom).
 */

import { drawStone } from './CanvasRenderer2D.js';

// Handle geometry/behavior constants (S-001). Named here instead of left as unexplained inline
// numbers so the handle's attachment/rotation behavior is auditable in one place.
//
// The cup body silhouette drawn below is rotation-invariant by construction (a real right
// cylinder/frustum looks identical from any azimuth around its own vertical axis under a fixed
// camera — rotating a real mug does not change its outline). The handle, by contrast, is mounted
// at one fixed azimuth on that body (HANDLE_AZIMUTH_RAD, opposite the front-facing design — the
// same convention a real mug uses), so it is the one part of the body whose screen position
// legitimately changes with rotation. Its azimuth is `HANDLE_AZIMUTH_RAD + rot` — the exact same
// `rot` term the stone-placement code below already uses — so the handle and the stones always
// stay synchronized under one rotation value.
//
// From that azimuth, `sideFactor = sin(theta)` (signed) drives both wall-attachment x-offset and
// bulge direction/magnitude, and `depthFactor = cos(theta)` decides whether the handle faces the
// camera (drawn after the body fill) or faces away (drawn before it, so the wall naturally
// occludes the overlapping part — real depth ordering, not an opacity hack). Because sideFactor
// and depthFactor are 90 degrees out of phase, the draw-order switch (at depthFactor == 0) always
// coincides with maximum |sideFactor| — the handle fully clear of the body silhouette — so
// switching which side of the body it is drawn on is never visible as a pop. There is no discrete
// side-flip branch and no opacity fade anywhere in this file; the only branch is the draw-order
// choice, which is provably invisible by that phase relationship.
const HANDLE_AZIMUTH_RAD = Math.PI;
const HANDLE_MAX_BULGE_FACTOR = 0.30; // outward bulge of the handle loop at full profile (|sideFactor|=1), relative to viewport width
const HANDLE_THICKNESS_FACTOR = 0.085; // handle tube thickness, relative to viewport height — constant regardless of bulge
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

  const handle = computeHandleGeometry({ cx, topY, botY, topW, botW, cupH, w, h, dpr, zoom, rot });
  if (handle.depthFactor <= 0) drawHandle(ctx, handle, cupColor);

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

  if (handle.depthFactor > 0) drawHandle(ctx, handle, cupColor);

  const boundingBoxMm = stoneLayout.getBoundingBox();
  const b = boundingBoxMm
    ? { x: boundingBoxMm.minXmm, y: boundingBoxMm.minYmm, width: boundingBoxMm.widthMm, height: boundingBoxMm.heightMm }
    : { x: 0, y: 0, width: 0, height: 0 };
  const labelW = topW * .72, labelH = cupH * .32;
  const stoneScale = Math.min(labelW / Math.max(1, b.width), labelH / Math.max(1, b.height));
  const ly = topY + cupH * .52 - (b.y + b.height / 2) * stoneScale;

  // S-001: 'front' used to render the design at a fixed screen position, entirely ignoring `rot` —
  // the design never appeared to rotate with the cup (only the handle did). It is now treated as a
  // single rigid flat label mounted at azimuth 0 (facing the camera at rot=0, matching its previous
  // fixed appearance exactly): the whole group shares one `front = cos(rot)` and one horizontal
  // `xShift`, instead of each stone getting its own per-stone azimuth (which would fragment the
  // design into a partial sliver right around the angle where it crosses the cull threshold,
  // instead of appearing/disappearing as one clean, believable unit). At rot=0 this reduces to
  // exactly the previous fixed layout (front=1, xShift=0) — no visual regression at the default
  // angle — and now continuously slides/foreshortens/hides in sync with the handle and body as
  // rotation changes, using the same cull threshold and size-foreshortening formula as every other
  // wrap mode below.
  if (wrap === 'front') {
    const front = Math.cos(rot);
    if (front < .10) return;
    const persp = .62 + .38 * front;
    const xShift = Math.sin(rot) * (topW / 2) * .55;
    const centerXMm = b.x + b.width / 2;
    const lx = cx + xShift - centerXMm * stoneScale * front;
    for (const st of stoneLayout.stones) {
      drawStone(ctx, lx + st.xMm * stoneScale * front, ly + st.yMm * stoneScale, Math.max(1.15, st.sizeMm * stoneScale * .45 * persp), st.color, 'cup');
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

// Half-width of the tapered cup wall at a given y — the same linear interpolation the body
// silhouette's straight sides use, so the handle's attachment points always land exactly on the
// wall regardless of how much the body tapers between topW and botW.
function wallHalfWidthAt(y, topY, botY, topW, botW) {
  const t = Math.max(0, Math.min(1, (y - topY) / Math.max(1e-6, botY - topY)));
  return (topW * (1 - t) + botW * t) / 2;
}

// Computes the handle's screen-space geometry for the current rotation, independent of drawing —
// this lets renderCup() decide, before drawing anything, whether the handle belongs before or
// after the body fill (see the constants block above for why that choice is always invisible).
// `sideFactor`/`depthFactor` are the signed sin/cos of the handle's 3D azimuth: both the
// wall-attachment x-offset and the bulge (how far the loop's curve swings out from the wall)
// scale by the same signed `sideFactor`, so the shape deforms as one continuous unit — from a
// full "D" profile at Left/Right (|sideFactor| = 1) down to a straight vertical tube seen end-on
// at Front/Back (sideFactor = 0). The handle is drawn as a single stroked tube (see drawHandle)
// rather than a separately-outlined fill, so there is nothing that can cross or twist at any
// angle, and the tube's own width (`thickness`) never collapses to zero even when the bulge does
// — exactly like a real handle's tube keeps its diameter when viewed end-on.
function computeHandleGeometry({ cx, topY, botY, topW, botW, cupH, w, h, dpr, zoom, rot }) {
  const theta = HANDLE_AZIMUTH_RAD + rot;
  const sideFactor = Math.sin(theta);
  const depthFactor = Math.cos(theta);

  const attachTopY = topY + cupH * HANDLE_ATTACH_TOP_FRACTION;
  const attachBotY = topY + cupH * HANDLE_ATTACH_BOTTOM_FRACTION;
  const attachTopX = cx + sideFactor * wallHalfWidthAt(attachTopY, topY, botY, topW, botW);
  const attachBotX = cx + sideFactor * wallHalfWidthAt(attachBotY, topY, botY, topW, botW);

  const bulge = w * HANDLE_MAX_BULGE_FACTOR * zoom * sideFactor;
  const thickness = Math.max(2 * dpr, h * HANDLE_THICKNESS_FACTOR * zoom);
  const midY1 = attachTopY + (attachBotY - attachTopY) * 0.30;
  const midY2 = attachTopY + (attachBotY - attachTopY) * 0.70;

  return { depthFactor, attachTopX, attachTopY, attachBotX, attachBotY, bulge, thickness, midY1, midY2, dpr };
}

// Draws the cup handle as a single rounded tube (a stroked bezier, not a separately-outlined
// filled ribbon) anchored to the tapered wall at both ends, from geometry already computed by
// computeHandleGeometry(). A stroked centerline can never self-intersect or twist, and its width
// (`thickness`) stays constant regardless of how far the bulge has foreshortened — this is what
// keeps the handle looking like a solid tube instead of thinning to a hairline at Front/Back.
// Fully opaque (real occlusion via draw order, not an opacity fade — see the constants block
// above).
function drawHandle(ctx, geom, cupColor) {
  const { attachTopX, attachTopY, attachBotX, attachBotY, bulge, thickness, midY1, midY2, dpr } = geom;
  const cp1x = attachTopX + bulge * .95, cp2x = attachBotX + bulge * .95;

  // Soft contact shadows fuse the handle ends into the wall instead of leaving a visible seam.
  ctx.fillStyle = 'rgba(0,0,0,.15)';
  for (const [ax, ay] of [[attachTopX, attachTopY], [attachBotX, attachBotY]]) {
    ctx.beginPath();
    ctx.ellipse(ax, ay, thickness * 0.65, thickness * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Traces the same centerline, optionally shifted sideways by `dx` — a fixed (not
  // rotation-dependent) horizontal offset, matching the body's own fixed-direction sheen. A single
  // centerline can only ever look like a flat ribbon; stacking several parallel offset strokes of
  // shrinking width — dark core-shadow on one side, a narrow specular highlight on the other — is
  // what actually reads as a rounded tube instead of a schematic flat band.
  const path = (dx = 0) => {
    ctx.beginPath();
    ctx.moveTo(attachTopX + dx, attachTopY);
    ctx.bezierCurveTo(cp1x + dx, midY1, cp2x + dx, midY2, attachBotX + dx, attachBotY);
  };

  ctx.lineCap = 'round';

  // A soft dark underlay slightly wider than the colored tube reads as an edge/ambient-occlusion
  // line without needing a second parallel curve. This is also the render's first bezierCurveTo
  // call, at the true (unshifted) wall-attachment point.
  path();
  ctx.strokeStyle = 'rgba(0,0,0,.28)';
  ctx.lineWidth = thickness + Math.max(1, 1.1 * dpr);
  ctx.stroke();

  const grad = ctx.createLinearGradient(attachTopX, attachTopY, attachTopX + bulge, (attachTopY + attachBotY) / 2);
  grad.addColorStop(0, shade(cupColor, -18));
  grad.addColorStop(.55, shade(cupColor, 6));
  grad.addColorStop(1, shade(cupColor, -14));
  path();
  ctx.strokeStyle = grad;
  ctx.lineWidth = thickness;
  ctx.stroke();

  // Core shadow, offset toward one side of the tube's cross-section...
  path(-thickness * 0.24);
  ctx.strokeStyle = 'rgba(0,0,0,.22)';
  ctx.lineWidth = Math.max(1, thickness * 0.42);
  ctx.stroke();

  // ...and a narrower specular highlight offset toward the other side — the two together are what
  // sell the roundness (a single centerline highlight reads as a flat painted stripe instead).
  path(thickness * 0.22);
  ctx.strokeStyle = 'rgba(255,255,255,.5)';
  ctx.lineWidth = Math.max(.8, thickness * 0.2);
  ctx.stroke();
  path(thickness * 0.08);
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.lineWidth = Math.max(1, thickness * 0.45);
  ctx.stroke();
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
