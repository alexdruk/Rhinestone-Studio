/**
 * IMG-022: the two pure layer edits behind "Redraw with AI" and "Use original". Both return a new
 * layer object and never mutate their input; app.js wraps each in one commitHistory() step. See
 * docs/specifications/IMG-022-RedrawProvider.md D9.
 */

export const REDRAW_LONG_SIDE_MM = 160;
export const REDRAW_NAME_SUFFIX = ' (AI redraw)';
export const REDRAW_VIVIDNESS = 1.0;
const POSITION_EPSILON_MM = 1e-9;

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

// Sets key to value, or removes the key when value is undefined, so a restore gives back a layer
// that never had the key (e.g. no vividness before IMG-017) without adding `key: undefined`.
function setOrDelete(obj, key, value) {
  if (value === undefined) delete obj[key];
  else obj[key] = value;
}

// IMG-023 (D2): millimetres per image pixel for an AI stones layer -- one AI stone pitch becomes
// one real pitch (stone size + gap), times the shrink.
export function aiStoneMmPerPx({ stoneSizeMm, gapMm, aiPitchPx, shrink = 1 }) {
  return (stoneSizeMm + gapMm) * shrink / aiPitchPx;
}

/**
 * IMG-023 (D2): the AI stones box. On a Flat Sheet (`sheetMaxMm` given) the sheet grows, rounded up
 * to a whole millimetre and never past `sheetMaxMm`; then the box is fitted to the canvas minus
 * 20 mm (the clamp restated from computeDefaultImagePlacement(), as applyRedraw() below does) and
 * shifted, never rescaled, to lie inside the canvas, keeping its centre where possible.
 */
export function fitAiStoneBox({ centerXMm, centerYMm, widthPx, heightPx, aiPitchPx, stoneSizeMm, gapMm, shrink = 1, canvas, sheetMaxMm = null }) {
  const mmPerPx = aiStoneMmPerPx({ stoneSizeMm, gapMm, aiPitchPx, shrink });
  let w = widthPx * mmPerPx, h = heightPx * mmPerPx;
  let outCanvas = { width: canvas.width, height: canvas.height };
  if (finite(sheetMaxMm)) {
    outCanvas = {
      width: Math.min(sheetMaxMm, Math.max(canvas.width, Math.ceil(w + 20))),
      height: Math.min(sheetMaxMm, Math.max(canvas.height, Math.ceil(h + 20)))
    };
  }
  const maxW = outCanvas.width - 20, maxH = outCanvas.height - 20;
  if (w > maxW || h > maxH) { const f = Math.min(maxW / w, maxH / h); w *= f; h *= f; }
  const x = Math.min(Math.max(centerXMm - w / 2, 0), outCanvas.width - w);
  const y = Math.min(Math.max(centerYMm - h / 2, 0), outCanvas.height - h);
  return { x, y, w, h, canvas: outCanvas };
}

// IMG-023 (D2): how large the box is relative to the AI's own drawing (1 = one AI stone per real
// stone). Uses the live box, so a manual resize counts.
export function aiStoneEffectiveShrink({ w, h, widthPx, heightPx, aiPitchPx, stoneSizeMm, gapMm }) {
  return Math.min(w / widthPx, h / heightPx) * aiPitchPx / (stoneSizeMm + gapMm);
}

/**
 * @param {object} layer an 'image' layer, with or without a previous `redraw` record
 * @param {{dataUrl:string, providerId:string, model:string, promptVersion:(number|null)}} result
 * @param {{canvas:{width:number,height:number}, naturalWidthPx:number, naturalHeightPx:number, now:()=>number, aiPitchPx?:(number|null), shrink?:number, style?:('stones'|'flat')}} options
 *   IMG-023: with a positive `aiPitchPx` the layer becomes an AI stones layer sized per D2; without
 *   one, the IMG-022 behaviour (160 mm long side, fillMode unchanged) is kept exactly.
 *   IMG-024: style 'flat' ignores aiPitchPx/shrink, takes the IMG-022 sizing and sets fillMode
 *   'staggered' and paletteRule 'error'; any other style is 'stones'.
 */
export function applyRedraw(layer, result, { canvas, naturalWidthPx, naturalHeightPx, now, aiPitchPx = null, shrink = 1, style = 'stones' }) {
  const isFlat = style === 'flat';
  const prev = layer.redraw && typeof layer.redraw === 'object' ? layer.redraw : null;
  const base = prev
    ? {
        originalImageSrc: prev.originalImageSrc,
        originalImageName: prev.originalImageName,
        previousVividness: prev.previousVividness,
        previousW: prev.previousW,
        previousH: prev.previousH,
        previousNaturalWidthPx: prev.previousNaturalWidthPx,
        previousNaturalHeightPx: prev.previousNaturalHeightPx,
        previousX: prev.previousX,
        previousY: prev.previousY
      }
    : {
        originalImageSrc: layer.imageSrc,
        originalImageName: layer.imageName,
        previousVividness: layer.vividness,
        previousW: layer.w,
        previousH: layer.h,
        previousNaturalWidthPx: layer.naturalWidthPx,
        previousNaturalHeightPx: layer.naturalHeightPx,
        previousX: layer.x,
        previousY: layer.y
      };

  // IMG-023: a record that already carries previousFillMode keeps it (the fillMode before the
  // first AI stones redraw); `null` means the layer had no fillMode. IMG-024: previousPaletteRule
  // likewise (the paletteRule before the first flat redraw).
  if (prev && 'previousFillMode' in prev) base.previousFillMode = prev.previousFillMode;
  if (prev && 'previousPaletteRule' in prev) base.previousPaletteRule = prev.previousPaletteRule;
  const isAiStones = !isFlat && finite(aiPitchPx) && aiPitchPx > 0;
  if ((isAiStones || isFlat) && !('previousFillMode' in base)) base.previousFillMode = layer.fillMode ?? null;
  if (isFlat && !('previousPaletteRule' in base)) base.previousPaletteRule = layer.paletteRule ?? null;

  const cx = layer.x + layer.w / 2, cy = layer.y + layer.h / 2;
  let x, y, w, h;
  if (isAiStones) {
    ({ x, y, w, h } = fitAiStoneBox({ centerXMm: cx, centerYMm: cy, widthPx: naturalWidthPx, heightPx: naturalHeightPx, aiPitchPx, stoneSizeMm: layer.stoneSize, gapMm: layer.gap, shrink, canvas }));
  } else {
    const scale = REDRAW_LONG_SIDE_MM / Math.max(naturalWidthPx, naturalHeightPx);
    w = naturalWidthPx * scale; h = naturalHeightPx * scale;
    // Restates the clamp in computeDefaultImagePlacement() (app.js) rather than sharing it:
    // test-img-011-import-defaults.mjs cuts that function out of app.js and runs it on its own.
    const maxW = canvas.width - 20, maxH = canvas.height - 20;
    if (w > maxW || h > maxH) { const s = Math.min(maxW / w, maxH / h); w *= s; h *= s; }
    // Shift (never rescale) so the unrotated box lies inside the canvas.
    x = Math.min(Math.max(cx - w / 2, 0), canvas.width - w);
    y = Math.min(Math.max(cy - h / 2, 0), canvas.height - h);
  }

  const out = {
    ...layer,
    ...(isAiStones ? { fillMode: 'ai-stones' } : {}),
    ...(isFlat ? { fillMode: 'staggered', paletteRule: 'error' } : {}),
    imageSrc: result.dataUrl,
    imageName: `${base.originalImageName ?? ''}${REDRAW_NAME_SUFFIX}`,
    vividness: REDRAW_VIVIDNESS,
    naturalWidthPx,
    naturalHeightPx,
    x, y, w, h,
    redraw: {
      ...base,
      appliedX: x,
      appliedY: y,
      providerId: result.providerId,
      model: result.model,
      promptVersion: result.promptVersion,
      style: isFlat ? 'flat' : 'stones',
      createdAt: new Date(now()).toISOString()
    }
  };
  // IMG-024 (F3): a stones redraw puts back the paletteRule from before the first flat redraw, so
  // its result is the same whichever style came before. It never records previousPaletteRule itself.
  if (!isFlat && 'previousPaletteRule' in base) setOrDelete(out, 'paletteRule', base.previousPaletteRule === null ? undefined : base.previousPaletteRule);
  return out;
}

/** "Use original": undoes applyRedraw() from the layer's own `redraw` record. */
export function restoreOriginal(layer) {
  const r = layer.redraw;
  const out = { ...layer };
  delete out.redraw;
  if (!r || typeof r !== 'object') return out;
  setOrDelete(out, 'imageSrc', r.originalImageSrc);
  setOrDelete(out, 'imageName', r.originalImageName);
  setOrDelete(out, 'vividness', r.previousVividness);
  setOrDelete(out, 'w', r.previousW);
  setOrDelete(out, 'h', r.previousH);
  setOrDelete(out, 'naturalWidthPx', r.previousNaturalWidthPx);
  setOrDelete(out, 'naturalHeightPx', r.previousNaturalHeightPx);
  // IMG-023: only a record written by an AI stones redraw changed fillMode.
  if ('previousFillMode' in r) setOrDelete(out, 'fillMode', r.previousFillMode === null ? undefined : r.previousFillMode);
  // IMG-024: only a record written by a flat redraw (or carried from one) changed paletteRule.
  if ('previousPaletteRule' in r) setOrDelete(out, 'paletteRule', r.previousPaletteRule === null ? undefined : r.previousPaletteRule);

  const unmoved = finite(r.appliedX) && finite(r.appliedY) && finite(r.previousX) && finite(r.previousY)
    && Math.abs(layer.x - r.appliedX) <= POSITION_EPSILON_MM && Math.abs(layer.y - r.appliedY) <= POSITION_EPSILON_MM;
  if (unmoved) {
    out.x = r.previousX;
    out.y = r.previousY;
  } else if (finite(out.w) && finite(out.h)) {
    // Moved after the redraw: keep the original box where the operator put the redrawn one.
    out.x = layer.x + layer.w / 2 - out.w / 2;
    out.y = layer.y + layer.h / 2 - out.h / 2;
  }
  return out;
}
