/**
 * Stone model for Rhinestone Studio.
 *
 * A Stone is a single manufacturing-ready rhinestone placement. It is the
 * atomic unit of StoneLayout, the Geometry Engine's product. Nothing outside
 * the Geometry Engine may construct or reposition a Stone.
 *
 * Units are millimeters.
 */

/**
 * Default crystal color applied to a Stone when none is supplied.
 *
 * This matches the default already used for layer params (see
 * src/core/Layer.js), so a Stone generated without an explicit color still
 * reads as the same crystal finish the rest of the project defaults to.
 */
export const DEFAULT_STONE_COLOR = 'Crystal AB';

function assertFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
}

function roundForJson(value) {
  return Number(value.toFixed(6));
}

export class Stone {
  constructor({ xMm, yMm, sizeMm, color, layerId, index = null, metadata = {} } = {}) {
    assertFiniteNumber(xMm, 'xMm');
    assertFiniteNumber(yMm, 'yMm');
    assertFiniteNumber(sizeMm, 'sizeMm');

    if (sizeMm <= 0) {
      throw new RangeError('Stone sizeMm must be positive.');
    }
    if (typeof layerId !== 'string' || layerId.length === 0) {
      throw new TypeError('Stone requires a non-empty layerId.');
    }
    if (color !== undefined && color !== null && (typeof color !== 'string' || color.length === 0)) {
      throw new TypeError('Stone color must be a non-empty string when provided.');
    }

    this.xMm = xMm;
    this.yMm = yMm;
    this.sizeMm = sizeMm;
    this.color = color ?? DEFAULT_STONE_COLOR;
    this.layerId = layerId;
    this.index = index;
    this.metadata = { ...metadata };
  }

  toJSON() {
    return {
      xMm: roundForJson(this.xMm),
      yMm: roundForJson(this.yMm),
      sizeMm: roundForJson(this.sizeMm),
      color: this.color,
      layerId: this.layerId,
      index: this.index,
      metadata: { ...this.metadata }
    };
  }

  static fromJSON(value) {
    if (!value || typeof value !== 'object') {
      throw new TypeError('Stone.fromJSON expects an object.');
    }
    return new Stone(value);
  }
}
