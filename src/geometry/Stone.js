/**
 * Stone model for Rhinestone Studio.
 *
 * A Stone is a single manufacturing-ready rhinestone placement. It is the
 * atomic unit of StoneLayout, the Geometry Engine's product. Nothing outside
 * the Geometry Engine may construct or reposition a Stone.
 *
 * Units are millimeters.
 */

function assertFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
}

function roundForJson(value) {
  return Number(value.toFixed(6));
}

export class Stone {
  constructor({ xMm, yMm, sizeMm, layerId, index = null, metadata = {} } = {}) {
    assertFiniteNumber(xMm, 'xMm');
    assertFiniteNumber(yMm, 'yMm');
    assertFiniteNumber(sizeMm, 'sizeMm');

    if (sizeMm <= 0) {
      throw new RangeError('Stone sizeMm must be positive.');
    }
    if (typeof layerId !== 'string' || layerId.length === 0) {
      throw new TypeError('Stone requires a non-empty layerId.');
    }

    this.xMm = xMm;
    this.yMm = yMm;
    this.sizeMm = sizeMm;
    this.layerId = layerId;
    this.index = index;
    this.metadata = { ...metadata };
  }

  toJSON() {
    return {
      xMm: roundForJson(this.xMm),
      yMm: roundForJson(this.yMm),
      sizeMm: roundForJson(this.sizeMm),
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
