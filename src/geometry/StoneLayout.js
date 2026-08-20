/**
 * StoneLayout — the Geometry Engine's product.
 *
 * Per docs/ARCHITECTURE.md, StoneLayout is the single source of truth
 * consumed by the 2D canvas, 3D preview, and every exporter. Nothing outside
 * the Geometry Engine may generate or mutate a StoneLayout's stones.
 *
 * Units are millimeters.
 */

import { BoundingBox } from '../text/VectorPath.js';
import { Stone } from './Stone.js';

function roundForJson(value) {
  return Number(value.toFixed(6));
}

export class StoneLayout {
  /**
   * @param {object} params
   * @param {string} params.layerId
   * @param {(Stone|object)[]} [params.stones]
   * @param {string|null} [params.sourceMode]
   * @param {{rawSampleCount: number, keptCount: number}|null} [params.outlineStats] Layout-quality
   *   metrics (Prompt 3): outline-mode sample attrition -- how many raw candidate points
   *   sampleMultiContourOutlinePoints() considered vs. how many survived dedup/backfill. Additive
   *   and optional: null/absent for every non-outline layout and every layout produced before this
   *   field existed, so older saved projects and every pre-existing caller are unaffected.
   */
  constructor({ layerId, stones = [], sourceMode = null, outlineStats = null } = {}) {
    if (typeof layerId !== 'string' || layerId.length === 0) {
      throw new TypeError('StoneLayout requires a non-empty layerId.');
    }

    this.layerId = layerId;
    this.sourceMode = sourceMode;
    this.stones = stones.map((stone) => (stone instanceof Stone ? stone : Stone.fromJSON(stone)));
    this.outlineStats = outlineStats;
  }

  get count() {
    return this.stones.length;
  }

  /**
   * Bounding box of the physical stone footprints (center +/- half size),
   * not just their center points. Returns null for an empty layout.
   *
   * @returns {BoundingBox|null}
   */
  getBoundingBox() {
    let box = null;

    for (const stone of this.stones) {
      const halfMm = stone.sizeMm / 2;
      const stoneBox = new BoundingBox(
        stone.xMm - halfMm,
        stone.yMm - halfMm,
        stone.xMm + halfMm,
        stone.yMm + halfMm
      );
      box = box ? box.union(stoneBox) : stoneBox;
    }

    return box;
  }

  get widthMm() {
    return this.getBoundingBox()?.widthMm ?? 0;
  }

  get heightMm() {
    return this.getBoundingBox()?.heightMm ?? 0;
  }

  toJSON() {
    const json = {
      layerId: this.layerId,
      sourceMode: this.sourceMode,
      count: this.count,
      boundingBox: this.getBoundingBox()?.toJSON() ?? null,
      widthMm: roundForJson(this.widthMm),
      heightMm: roundForJson(this.heightMm),
      stones: this.stones.map((stone) => stone.toJSON())
    };
    if (this.outlineStats) {
      json.outlineStats = { ...this.outlineStats };
    }
    return json;
  }

  static fromJSON(value) {
    if (!value || typeof value !== 'object') {
      throw new TypeError('StoneLayout.fromJSON expects an object.');
    }
    return new StoneLayout({
      layerId: value.layerId,
      sourceMode: value.sourceMode ?? null,
      stones: value.stones ?? [],
      outlineStats: value.outlineStats ?? null
    });
  }
}

/**
 * Every pair of stones whose center-to-center distance is less than the sum of their radii --
 * i.e. genuinely overlapping physical footprints, not just close placement. Accepts Stone
 * instances or plain {xMm,yMm,sizeMm} objects. The single definition of "overlap" shared by the
 * stone-overlap regression suite (tools/test-geometry-stone-overlap-same-contour.mjs) and the
 * Stone Size picker's overlap guard (app.js), so the two can never silently disagree.
 */
export function findOverlappingStonePairs(stones) {
  const pairs = [];
  for (let i = 0; i < stones.length; i++) {
    for (let j = i + 1; j < stones.length; j++) {
      const a = stones[i], b = stones[j];
      const distanceMm = Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
      const minSeparationMm = (a.sizeMm + b.sizeMm) / 2;
      if (distanceMm < minSeparationMm - 1e-9) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

function median(sortedValues) {
  const n = sortedValues.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedValues[mid - 1] + sortedValues[mid]) / 2 : sortedValues[mid];
}

/**
 * Layout-quality crowding metric (Prompt 3). findOverlappingStonePairs() above can structurally
 * never fire for single-layer generated output -- dedupeStonePoints()'s center-distance floor in
 * StoneSampler.js already guarantees stones never overlap -- so a layout that merely "looks
 * crowded" (rim gap far below the user's requested gapMm, but not literally overlapping) is
 * invisible to that check. This is a pure measurement, not a pass/fail verdict: no threshold is
 * baked in here, the caller decides what fractionBelowHalfGap counts as a warning.
 *
 * For each stone, finds its nearest neighbor via a grid-bucket index (cell size = the largest
 * stone diameter present, 3x3-neighborhood scan) -- the same bucketed-neighbor-check technique
 * dedupeStonePoints() and dedupeStonesByRadius() use in StoneSampler.js, just applied as a query
 * instead of a dedup. Rim gap is nearest-neighbor center distance minus the sum of each stone's own
 * radius (per-pair radii, so mixed sizes are correct), not a single global stone size.
 *
 * @param {(Stone|{xMm: number, yMm: number, sizeMm: number})[]} stones
 * @param {{gapMm: number}} options
 * @returns {{count: number, minRimGapMm: number|null, medianRimGapMm: number|null, fractionBelowHalfGap: number}}
 *   minRimGapMm/medianRimGapMm are null when there is nothing to measure (fewer than 2 stones).
 *   fractionBelowHalfGap is 0 whenever gapMm <= 0 (deliberate pavé) or there are fewer than 2
 *   stones, so intentional touching is never flagged as crowding.
 */
export function measureStoneCrowding(stones, { gapMm } = {}) {
  const count = stones.length;
  if (count < 2) {
    return { count, minRimGapMm: null, medianRimGapMm: null, fractionBelowHalfGap: 0 };
  }

  const cellSizeMm = Math.max(...stones.map((stone) => stone.sizeMm));
  const buckets = new Map();
  for (const stone of stones) {
    const gx = Math.floor(stone.xMm / cellSizeMm);
    const gy = Math.floor(stone.yMm / cellSizeMm);
    const key = `${gx},${gy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(stone);
  }

  const rimGapsMm = [];
  for (const stone of stones) {
    const gx = Math.floor(stone.xMm / cellSizeMm);
    const gy = Math.floor(stone.yMm / cellSizeMm);
    let nearestDistanceMm = Infinity;
    let nearestSizeMm = null;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = buckets.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other === stone) continue;
          const distanceMm = Math.hypot(stone.xMm - other.xMm, stone.yMm - other.yMm);
          if (distanceMm < nearestDistanceMm) {
            nearestDistanceMm = distanceMm;
            nearestSizeMm = other.sizeMm;
          }
        }
      }
    }
    if (nearestSizeMm === null) continue;
    rimGapsMm.push(nearestDistanceMm - (stone.sizeMm + nearestSizeMm) / 2);
  }

  const sorted = [...rimGapsMm].sort((a, b) => a - b);
  const minRimGapMm = sorted.length > 0 ? sorted[0] : null;
  const medianRimGapMm = sorted.length > 0 ? median(sorted) : null;
  const fractionBelowHalfGap = gapMm > 0 && sorted.length > 0
    ? rimGapsMm.filter((rimGapMm) => rimGapMm < gapMm * 0.5).length / count
    : 0;

  return { count, minRimGapMm, medianRimGapMm, fractionBelowHalfGap };
}
