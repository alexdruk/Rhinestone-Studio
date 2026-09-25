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

/**
 * @param {object} layer an 'image' layer, with or without a previous `redraw` record
 * @param {{dataUrl:string, providerId:string, model:string, promptVersion:(number|null)}} result
 * @param {{canvas:{width:number,height:number}, naturalWidthPx:number, naturalHeightPx:number, now:()=>number}} options
 */
export function applyRedraw(layer, result, { canvas, naturalWidthPx, naturalHeightPx, now }) {
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

  const scale = REDRAW_LONG_SIDE_MM / Math.max(naturalWidthPx, naturalHeightPx);
  let w = naturalWidthPx * scale, h = naturalHeightPx * scale;
  // Restates the clamp in computeDefaultImagePlacement() (app.js) rather than sharing it:
  // test-img-011-import-defaults.mjs cuts that function out of app.js and runs it on its own.
  const maxW = canvas.width - 20, maxH = canvas.height - 20;
  if (w > maxW || h > maxH) { const s = Math.min(maxW / w, maxH / h); w *= s; h *= s; }

  const cx = layer.x + layer.w / 2, cy = layer.y + layer.h / 2;
  // Shift (never rescale) so the unrotated box lies inside the canvas.
  const x = Math.min(Math.max(cx - w / 2, 0), canvas.width - w);
  const y = Math.min(Math.max(cy - h / 2, 0), canvas.height - h);

  return {
    ...layer,
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
      createdAt: new Date(now()).toISOString()
    }
  };
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
