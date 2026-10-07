/**
 * IMG-026 (build D): the one write path for manual edits to an ai-layout image layer's stones. Pure:
 * every function returns new objects and never mutates its input. app.js's editAiLayoutStones() is
 * its only caller that writes the result back to a layer. See
 * docs/specifications/IMG-026-StrassLayoutService.md, "Editing in Design (build D)".
 *
 * A stone is named by its index in `aiLayout.stones` (the engine's metadata.aiIndex), never by its
 * position in a filtered or deduplicated list.
 */

import { STONE_COLORS } from '../renderer/CrystalColors.js';
import { isValidStoneSizeId } from '../renderer/StoneSizes.js';

/** The most stones an aiLayout may hold, the same limit validateProject() applies. */
export const AI_LAYOUT_MAX_STONES = 20000;

const AI_LAYOUT_EDIT_OPS = ['delete', 'move', 'recolour', 'resize', 'add'];

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

// The service writes coordinates to 0.001 mm; edits keep that precision in box space.
function round3(v) {
  return Math.round(v * 1000) / 1000;
}

function requireAiLayout(layer) {
  const a = layer && layer.aiLayout;
  if (!a || typeof a !== 'object' || !Array.isArray(a.stones) || !(finite(a.widthMm) && a.widthMm > 0) || !(finite(a.heightMm) && a.heightMm > 0)) {
    throw new TypeError('The layer has no ai-layout to edit.');
  }
  return a;
}

// k is the engine's enlargement (S14): the box is never placed smaller than the layout.
function placement(layer) {
  const a = requireAiLayout(layer);
  const k = Math.max(1, layer.w / a.widthMm);
  const radians = (layer.rotationDeg ?? 0) * (Math.PI / 180);
  return {
    k,
    cos: Math.cos(radians),
    sin: Math.sin(radians),
    cxMm: layer.x + k * a.widthMm / 2,
    cyMm: layer.y + k * a.heightMm / 2
  };
}

/**
 * The inverse of the engine's placement: an absolute project-mm point to the layout's box
 * coordinates. Undoes the rotation about the placed box's centre, subtracts the box origin and
 * divides by k.
 * @param {object} layer an ai-layout image layer
 * @param {{xMm:number, yMm:number}} point
 * @returns {{xMm:number, yMm:number}}
 */
export function aiLayoutPointFromAbsolute(layer, { xMm, yMm }) {
  const { k, cos, sin, cxMm, cyMm } = placement(layer);
  const dx = xMm - cxMm;
  const dy = yMm - cyMm;
  const ux = cxMm + dx * cos + dy * sin;
  const uy = cyMm - dx * sin + dy * cos;
  return { xMm: (ux - layer.x) / k, yMm: (uy - layer.y) / k };
}

/**
 * aiLayoutPointFromAbsolute() for a displacement: the rotation and the scale, no translation.
 * @param {object} layer an ai-layout image layer
 * @param {{dxMm:number, dyMm:number}} delta
 * @returns {{dxMm:number, dyMm:number}}
 */
export function aiLayoutDeltaFromAbsolute(layer, { dxMm, dyMm }) {
  const { k, cos, sin } = placement(layer);
  return { dxMm: (dxMm * cos + dyMm * sin) / k, dyMm: (-dxMm * sin + dyMm * cos) / k };
}

function checkIndices(indices, count, op) {
  if (!Array.isArray(indices) || indices.length === 0) throw new TypeError(`${op}: indices must be a non-empty array.`);
  const seen = new Set();
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= count) throw new RangeError(`${op}: stone index ${i} is not in the layout.`);
    if (seen.has(i)) throw new RangeError(`${op}: stone index ${i} is listed twice.`);
    seen.add(i);
  }
  return seen;
}

function checkColour(colorId, op) {
  if (typeof colorId !== 'string' || !Object.prototype.hasOwnProperty.call(STONE_COLORS, colorId)) {
    throw new TypeError(`${op}: unknown colour id ${colorId}.`);
  }
}

function checkSize(sizeId, op) {
  if (!isValidStoneSizeId(sizeId)) throw new TypeError(`${op}: unknown size id ${sizeId}.`);
}

/**
 * Applies `ops`, in order, to a copy of the layer's layout. Each op:
 *   { op: 'delete', indices }
 *   { op: 'move', indices, dxMm, dyMm }       absolute displacement, converted to box space
 *   { op: 'recolour', indices, colorId }      bakes colorSwaps into every stone first, then empties it
 *   { op: 'resize', indices, sizeId }
 *   { op: 'add', stones: [{ xMm, yMm, sizeId, colorId }] }   absolute positions, appended in order
 * Indices are stone indices in the layout as it stands when that op runs: non-empty, distinct,
 * integers in range. Moved and added coordinates are rounded to 0.001 mm in box space. editCount
 * goes up by 1 per call. Throws on any bad input, and when the result would hold more than
 * AI_LAYOUT_MAX_STONES stones; the layer is never changed.
 * @param {object} layer an ai-layout image layer
 * @param {object[]} ops
 * @returns {{aiLayout: object, colorSwaps: object}} new objects
 */
export function applyAiLayoutEdits(layer, ops) {
  const source = requireAiLayout(layer);
  if (!Array.isArray(ops) || ops.length === 0) throw new TypeError('applyAiLayoutEdits needs a non-empty list of ops.');
  let stones = source.stones.map((t) => [...t]);
  let colorSwaps = { ...(layer.colorSwaps || {}) };

  for (const edit of ops) {
    const op = edit && edit.op;
    if (!AI_LAYOUT_EDIT_OPS.includes(op)) throw new TypeError(`Unknown ai-layout edit op: ${op}.`);
    if (op === 'add') {
      if (!Array.isArray(edit.stones) || edit.stones.length === 0) throw new TypeError('add: stones must be a non-empty array.');
      for (const s of edit.stones) {
        if (!s || !finite(s.xMm) || !finite(s.yMm)) throw new TypeError('add: every stone needs a finite xMm and yMm.');
        checkSize(s.sizeId, op);
        checkColour(s.colorId, op);
      }
      for (const s of edit.stones) {
        const p = aiLayoutPointFromAbsolute(layer, s);
        stones.push([round3(p.xMm), round3(p.yMm), s.sizeId, s.colorId]);
      }
      continue;
    }
    const picked = checkIndices(edit.indices, stones.length, op);
    if (op === 'delete') {
      stones = stones.filter((_, i) => !picked.has(i));
    } else if (op === 'move') {
      if (!finite(edit.dxMm) || !finite(edit.dyMm)) throw new TypeError('move: dxMm and dyMm must be finite numbers.');
      const d = aiLayoutDeltaFromAbsolute(layer, edit);
      for (const i of picked) stones[i] = [round3(stones[i][0] + d.dxMm), round3(stones[i][1] + d.dyMm), stones[i][2], stones[i][3]];
    } else if (op === 'recolour') {
      checkColour(edit.colorId, op);
      stones = stones.map(([x, y, size, colour]) => [x, y, size, Object.prototype.hasOwnProperty.call(colorSwaps, colour) ? colorSwaps[colour] : colour]);
      colorSwaps = {};
      for (const i of picked) stones[i][3] = edit.colorId;
    } else {
      checkSize(edit.sizeId, op);
      for (const i of picked) stones[i][2] = edit.sizeId;
    }
  }

  if (stones.length > AI_LAYOUT_MAX_STONES) throw new RangeError(`An AI layout holds at most ${AI_LAYOUT_MAX_STONES} stones.`);
  const report = source.report && typeof source.report === 'object'
    ? Object.fromEntries(Object.entries(source.report).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]))
    : source.report;
  return {
    aiLayout: { ...source, stones, report, editCount: (Number.isInteger(source.editCount) ? source.editCount : 0) + 1 },
    colorSwaps
  };
}
