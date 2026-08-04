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
  constructor({ layerId, stones = [], sourceMode = null } = {}) {
    if (typeof layerId !== 'string' || layerId.length === 0) {
      throw new TypeError('StoneLayout requires a non-empty layerId.');
    }

    this.layerId = layerId;
    this.sourceMode = sourceMode;
    this.stones = stones.map((stone) => (stone instanceof Stone ? stone : Stone.fromJSON(stone)));
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
    return {
      layerId: this.layerId,
      sourceMode: this.sourceMode,
      count: this.count,
      boundingBox: this.getBoundingBox()?.toJSON() ?? null,
      widthMm: roundForJson(this.widthMm),
      heightMm: roundForJson(this.heightMm),
      stones: this.stones.map((stone) => stone.toJSON())
    };
  }

  static fromJSON(value) {
    if (!value || typeof value !== 'object') {
      throw new TypeError('StoneLayout.fromJSON expects an object.');
    }
    return new StoneLayout({
      layerId: value.layerId,
      sourceMode: value.sourceMode ?? null,
      stones: value.stones ?? []
    });
  }
}
