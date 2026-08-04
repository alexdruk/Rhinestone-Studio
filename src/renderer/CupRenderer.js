/**
 * Object preview renderer (mug / straight tumbler / bottle).
 *
 * Draws a StoneLayout wrapped onto a schematic object body. Per docs/ARCHITECTURE.md, the renderer
 * visualizes StoneLayout and never computes geometry: it has no knowledge of Project, Layer, or
 * any layer type (text/circle/rectangle/future shapes) — only the StoneLayout it is handed and
 * plain display options (cup color, wrap mode, rotation, zoom, and — as of RS-1004 — an optional
 * `objectTemplate` option carrying plain preview-silhouette parameters, exactly the same kind of
 * plain display option `cupColor`/`wrap` already are, not a Project/Layer/template-class
 * reference).
 *
 * RS-1004 generalized the single hardcoded mug silhouette this file used to draw into three
 * variants (mug/tumbler/bottle) sharing one frustum + stone-wrap-placement math — see
 * `computeHandleGeometry()`/`wallHalfWidthAt()` and the wrap-mode loop at the bottom of
 * `renderCup()`, none of which changed. Only the silhouette drawing itself (body taper, optional
 * handle, optional bottle neck/shoulder/cap) now branches on `preview.kind`. Omitting
 * `objectTemplate` (or passing one whose `preview` is absent) falls back to `DEFAULT_PREVIEW`,
 * whose values are byte-identical to this file's pre-RS-1004 hardcoded mug constants — any
 * existing direct caller/test that never passes `objectTemplate` sees no behavior change.
 */

import { drawStone } from './CanvasRenderer2D.js';

// RS-1004: the exact pre-milestone hardcoded mug silhouette, kept as the fallback so a caller that
// omits `objectTemplate` (e.g. an existing test, or a future caller with no template concept) gets
// identical output to before this milestone.
const DEFAULT_PREVIEW = Object.freeze({
  kind: 'mug',
  topWidthFactor: 0.52,
  bottomWidthFactor: 0.43,
  bodyHeightFactor: 0.64,
  hasHandle: true
});

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
 * @param {{preview:object}} [options.objectTemplate] RS-1004: plain preview-silhouette parameters
 *   (see src/products/ObjectTemplate.js). Omitted/absent falls back to DEFAULT_PREVIEW (mug).
 */
export function renderCup(ctx, stoneLayout, { widthPx: w, heightPx: h, dpr, cupColor, wrap, rotationDeg, zoom, objectTemplate }) {
  const preview = objectTemplate?.preview || DEFAULT_PREVIEW;
  const isBottle = preview.kind === 'bottle';

  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#fbfdff');
  bg.addColorStop(1, '#e9eef5');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2, cy = h * .54;
  const bodyH = h * preview.bodyHeightFactor * zoom, topW = w * preview.topWidthFactor * zoom, botW = w * preview.bottomWidthFactor * zoom;
  // Bottle: reserve vertical space above the body for the shoulder/neck/cap, so the whole
  // silhouette (not just the body) fits the same overall viewport allowance the mug/tumbler use.
  const neckH = isBottle ? h * preview.neckHeightFactor * zoom : 0;
  const shoulderH = isBottle ? h * preview.shoulderHeightFactor * zoom : 0;
  const capH = isBottle ? h * preview.capHeightFactor * zoom : 0;
  const topExtraH = neckH + shoulderH + capH;
  const topY = cy - (bodyH + topExtraH) / 2 + topExtraH, botY = topY + bodyH;
  const rot = rotationDeg * Math.PI / 180;

  const handle = preview.hasHandle ? computeHandleGeometry({ cx, topY, botY, topW, botW, cupH: bodyH, w, h, dpr, zoom, rot }) : null;
  if (handle && handle.depthFactor <= 0) drawHandle(ctx, handle, cupColor);

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

  if (isBottle) {
    drawBottleTop(ctx, {
      cx, bodyTopY: topY, bodyTopW: topW,
      neckW: w * preview.neckWidthFactor * zoom, neckH, shoulderH, capH, cupColor, dpr
    });
  } else {
    // Mouth rim — mug/tumbler only; a bottle's mouth is covered by the cap drawn above instead.
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
  }

  if (handle && handle.depthFactor > 0) drawHandle(ctx, handle, cupColor);

  const boundingBoxMm = stoneLayout.getBoundingBox();
  const b = boundingBoxMm
    ? { x: boundingBoxMm.minXmm, y: boundingBoxMm.minYmm, width: boundingBoxMm.widthMm, height: boundingBoxMm.heightMm }
    : { x: 0, y: 0, width: 0, height: 0 };
  const labelW = topW * .72, labelH = bodyH * .32;
  const stoneScale = Math.min(labelW / Math.max(1, b.width), labelH / Math.max(1, b.height));
  const ly = topY + bodyH * .52 - (b.y + b.height / 2) * stoneScale;

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
    const t = (yy - topY) / bodyH;
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

  const path = () => {
    ctx.beginPath();
    ctx.moveTo(attachTopX, attachTopY);
    ctx.bezierCurveTo(cp1x, midY1, cp2x, midY2, attachBotX, attachBotY);
  };

  // Round line caps make the underlay stroke below (wider than the tube) naturally form a soft,
  // circular dark base exactly at each wall-attachment point — this is what fuses the handle into
  // the wall without a visible seam. A separate flat-opacity contact-shadow ellipse used to be
  // drawn here too, but at a different aspect ratio than the round cap it sat next to, it read as
  // a disconnected dark smudge rather than a blended shadow (most visible against a light cup
  // color) — removed rather than tuned, since the round cap alone already does this job.
  ctx.lineCap = 'round';

  // A dark underlay, wider than the tube, reads as its outer edge/ambient-occlusion line. This is
  // also the render's first bezierCurveTo call, at the true wall-attachment point.
  path();
  ctx.strokeStyle = shade(cupColor, -46);
  ctx.lineWidth = thickness + Math.max(1, 1.1 * dpr);
  ctx.stroke();

  // A canvas gradient varies by absolute position, not by distance along a stroked path — so a
  // *linear* gradient whose axis runs from the wall side of the loop to its outward/tip side
  // shades every part of the tube (the near-straight top/bottom segments *and* the curved tip)
  // consistently by which side of the loop each point is on, with no seams and no hard band edges.
  // The axis is centered on the loop's own midpoint, offset toward the bulge direction, with a
  // floor on its half-width so it stays a meaningful gradient (not a near-zero-width, all-or-
  // nothing cutoff) even at Front/Back where the bulge itself is nearly zero.
  const midX = (attachTopX + attachBotX) / 2, midY = (attachTopY + attachBotY) / 2;
  const dir = bulge >= 0 ? 1 : -1;
  const halfSpan = Math.max(thickness * 0.9, Math.abs(bulge) * 0.65);
  const centerX = midX + bulge * .5;
  const wallX = centerX - dir * halfSpan; // inner, nearer the cup wall: shadowed
  const tipX = centerX + dir * halfSpan; // outer, away from the wall: lit

  const grad = ctx.createLinearGradient(wallX, midY, tipX, midY);
  grad.addColorStop(0, shade(cupColor, -30));
  grad.addColorStop(.62, shade(cupColor, 32));
  grad.addColorStop(1, shade(cupColor, -10));

  path();
  ctx.strokeStyle = grad;
  ctx.lineWidth = thickness;
  ctx.stroke();

  // A thin, crisp specular rim-light near the outer/lit edge sharpens the sense of a polished tube.
  const rimGrad = ctx.createLinearGradient(wallX, midY, tipX, midY);
  rimGrad.addColorStop(0, 'rgba(255,255,255,0)');
  rimGrad.addColorStop(.68, 'rgba(255,255,255,0)');
  rimGrad.addColorStop(.82, 'rgba(255,255,255,.55)');
  rimGrad.addColorStop(1, 'rgba(255,255,255,0)');
  path();
  ctx.strokeStyle = rimGrad;
  ctx.lineWidth = thickness * 0.9;
  ctx.stroke();
}

// RS-1004 — bottle-only silhouette above the body: a shoulder taper from the body's top width
// down to the neck width, a straight neck, and a cap. Schematic, matching this file's existing
// 2D-canvas-only style (no 3D mesh) — drawn as three flat-shaded fills, not lit/textured.
function drawBottleTop(ctx, { cx, bodyTopY, bodyTopW, neckW, neckH, shoulderH, capH, cupColor, dpr }) {
  const shoulderTopY = bodyTopY - shoulderH;
  const neckTopY = shoulderTopY - neckH;
  const capTopY = neckTopY - capH;

  ctx.fillStyle = shade(cupColor, -14);
  ctx.beginPath();
  ctx.moveTo(cx - bodyTopW / 2, bodyTopY);
  ctx.quadraticCurveTo(cx - bodyTopW / 2, shoulderTopY, cx - neckW / 2, shoulderTopY);
  ctx.lineTo(cx + neckW / 2, shoulderTopY);
  ctx.quadraticCurveTo(cx + bodyTopW / 2, shoulderTopY, cx + bodyTopW / 2, bodyTopY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = shade(cupColor, -18);
  ctx.fillRect(cx - neckW / 2, neckTopY, neckW, shoulderTopY - neckTopY);
  ctx.strokeStyle = 'rgba(0,0,0,.15)';
  ctx.lineWidth = 1 * dpr;
  ctx.strokeRect(cx - neckW / 2, neckTopY, neckW, shoulderTopY - neckTopY);

  // The cap is drawn in a fixed neutral color (not derived from cupColor), matching how a real
  // bottle cap is commonly a different material/color from the body it sits on.
  const capW = neckW * 1.22;
  const capRadius = Math.min(5 * dpr, (neckTopY - capTopY) / 2);
  ctx.fillStyle = '#4b5563';
  roundRectPath(ctx, cx - capW / 2, capTopY, capW, neckTopY - capTopY, capRadius);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.25)';
  ctx.lineWidth = 1 * dpr;
  ctx.stroke();
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
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
