/**
 * Alignment and distribution — RS-1009.
 *
 * Pure geometry over layer bounding boxes in millimeters. No DOM, no `Project`/`Layer`/
 * `StoneLayout` type, no dependency on `src/geometry/**`/`src/renderer/**`. The caller
 * (`app.js`) is responsible for turning `{id, bbox}` inputs into these functions from its own
 * per-layer-type bounding box, and for applying the returned per-id `{dxMm,dyMm}` deltas back
 * onto its own layer fields (`cx`/`cy` vs `x`/`y`) — this module never sees a layer's type.
 */

export const ALIGN_DIRECTIONS = Object.freeze(['left', 'centerH', 'right', 'top', 'centerV', 'bottom']);
export const DISTRIBUTE_AXES = Object.freeze(['horizontal', 'vertical']);

function assertItems(items, minCount, fnName) {
  if (!Array.isArray(items) || items.length < minCount) {
    throw new TypeError(`${fnName} requires at least ${minCount} items.`);
  }
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || item.id.length === 0) {
      throw new TypeError(`${fnName}: every item needs a non-empty string id.`);
    }
    const b = item.bbox;
    if (!b || ![b.xMm, b.yMm, b.widthMm, b.heightMm].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new TypeError(`${fnName}: item "${item.id}" needs a numeric bbox {xMm,yMm,widthMm,heightMm}.`);
    }
  }
}

function unionBBox(items) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { bbox: b } of items) {
    minX = Math.min(minX, b.xMm);
    minY = Math.min(minY, b.yMm);
    maxX = Math.max(maxX, b.xMm + b.widthMm);
    maxY = Math.max(maxY, b.yMm + b.heightMm);
  }
  return { xMm: minX, yMm: minY, widthMm: maxX - minX, heightMm: maxY - minY };
}

/**
 * Aligns every item to the union bounding box of the whole selection.
 *
 * @param {{id:string, bbox:{xMm:number,yMm:number,widthMm:number,heightMm:number}}[]} items
 * @param {'left'|'centerH'|'right'|'top'|'centerV'|'bottom'} direction
 * @returns {Map<string,{dxMm:number,dyMm:number}>}
 */
export function alignLayers(items, direction) {
  assertItems(items, 2, 'alignLayers');
  if (!ALIGN_DIRECTIONS.includes(direction)) {
    throw new TypeError(`alignLayers: unknown direction "${direction}".`);
  }
  const union = unionBBox(items);
  const deltas = new Map();
  for (const { id, bbox: b } of items) {
    let dxMm = 0, dyMm = 0;
    switch (direction) {
      case 'left': dxMm = union.xMm - b.xMm; break;
      case 'right': dxMm = (union.xMm + union.widthMm) - (b.xMm + b.widthMm); break;
      case 'centerH': dxMm = (union.xMm + union.widthMm / 2) - (b.xMm + b.widthMm / 2); break;
      case 'top': dyMm = union.yMm - b.yMm; break;
      case 'bottom': dyMm = (union.yMm + union.heightMm) - (b.yMm + b.heightMm); break;
      case 'centerV': dyMm = (union.yMm + union.heightMm / 2) - (b.yMm + b.heightMm / 2); break;
    }
    deltas.set(id, { dxMm, dyMm });
  }
  return deltas;
}

/**
 * Distributes items evenly by center-to-center spacing along one axis, holding the two extreme
 * items (by current center position) fixed.
 *
 * @param {{id:string, bbox:{xMm:number,yMm:number,widthMm:number,heightMm:number}}[]} items
 * @param {'horizontal'|'vertical'} axis
 * @returns {Map<string,{dxMm:number,dyMm:number}>}
 */
export function distributeLayers(items, axis) {
  assertItems(items, 3, 'distributeLayers');
  if (!DISTRIBUTE_AXES.includes(axis)) {
    throw new TypeError(`distributeLayers: unknown axis "${axis}".`);
  }
  const centerOf = (item) => axis === 'horizontal'
    ? item.bbox.xMm + item.bbox.widthMm / 2
    : item.bbox.yMm + item.bbox.heightMm / 2;

  const sorted = [...items].sort((a, b) => centerOf(a) - centerOf(b));
  const firstCenter = centerOf(sorted[0]);
  const lastCenter = centerOf(sorted[sorted.length - 1]);
  const step = (lastCenter - firstCenter) / (sorted.length - 1);

  const deltas = new Map();
  sorted.forEach((item, index) => {
    const targetCenter = firstCenter + step * index;
    const delta = targetCenter - centerOf(item);
    deltas.set(item.id, axis === 'horizontal' ? { dxMm: delta, dyMm: 0 } : { dxMm: 0, dyMm: delta });
  });
  return deltas;
}
