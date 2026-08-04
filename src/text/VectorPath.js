/**
 * Vector path primitives for Rhinestone Studio.
 *
 * This module intentionally contains no font parsing, no rendering, and no
 * rhinestone generation. It is the neutral geometry format that future font,
 * SVG, and shape providers will emit.
 *
 * Units are millimeters unless a caller explicitly documents otherwise.
 */

export class Point2D {
  constructor(xMm, yMm) {
    assertFiniteNumber(xMm, 'xMm');
    assertFiniteNumber(yMm, 'yMm');
    this.xMm = xMm;
    this.yMm = yMm;
  }

  clone() {
    return new Point2D(this.xMm, this.yMm);
  }

  translate(dxMm, dyMm) {
    return new Point2D(this.xMm + dxMm, this.yMm + dyMm);
  }

  scale(scaleX, scaleY = scaleX) {
    assertFiniteNumber(scaleX, 'scaleX');
    assertFiniteNumber(scaleY, 'scaleY');
    return new Point2D(this.xMm * scaleX, this.yMm * scaleY);
  }

  distanceTo(other) {
    return Math.hypot(this.xMm - other.xMm, this.yMm - other.yMm);
  }

  toJSON() {
    return { xMm: roundForJson(this.xMm), yMm: roundForJson(this.yMm) };
  }

  static fromJSON(value) {
    if (!value || typeof value !== 'object') {
      throw new TypeError('Point2D.fromJSON expects an object.');
    }
    return new Point2D(value.xMm, value.yMm);
  }
}

export class BoundingBox {
  constructor(minXmm, minYmm, maxXmm, maxYmm) {
    assertFiniteNumber(minXmm, 'minXmm');
    assertFiniteNumber(minYmm, 'minYmm');
    assertFiniteNumber(maxXmm, 'maxXmm');
    assertFiniteNumber(maxYmm, 'maxYmm');

    if (maxXmm < minXmm || maxYmm < minYmm) {
      throw new RangeError('BoundingBox max values must be greater than or equal to min values.');
    }

    this.minXmm = minXmm;
    this.minYmm = minYmm;
    this.maxXmm = maxXmm;
    this.maxYmm = maxYmm;
  }

  get widthMm() {
    return this.maxXmm - this.minXmm;
  }

  get heightMm() {
    return this.maxYmm - this.minYmm;
  }

  get center() {
    return new Point2D(
      this.minXmm + this.widthMm / 2,
      this.minYmm + this.heightMm / 2
    );
  }

  expandToIncludePoint(point) {
    return new BoundingBox(
      Math.min(this.minXmm, point.xMm),
      Math.min(this.minYmm, point.yMm),
      Math.max(this.maxXmm, point.xMm),
      Math.max(this.maxYmm, point.yMm)
    );
  }

  union(other) {
    return new BoundingBox(
      Math.min(this.minXmm, other.minXmm),
      Math.min(this.minYmm, other.minYmm),
      Math.max(this.maxXmm, other.maxXmm),
      Math.max(this.maxYmm, other.maxYmm)
    );
  }

  toJSON() {
    return {
      minXmm: roundForJson(this.minXmm),
      minYmm: roundForJson(this.minYmm),
      maxXmm: roundForJson(this.maxXmm),
      maxYmm: roundForJson(this.maxYmm),
      widthMm: roundForJson(this.widthMm),
      heightMm: roundForJson(this.heightMm)
    };
  }

  static empty() {
    return null;
  }

  static fromPoints(points) {
    if (!Array.isArray(points) || points.length === 0) {
      return BoundingBox.empty();
    }

    let minXmm = Infinity;
    let minYmm = Infinity;
    let maxXmm = -Infinity;
    let maxYmm = -Infinity;

    for (const point of points) {
      minXmm = Math.min(minXmm, point.xMm);
      minYmm = Math.min(minYmm, point.yMm);
      maxXmm = Math.max(maxXmm, point.xMm);
      maxYmm = Math.max(maxYmm, point.yMm);
    }

    return new BoundingBox(minXmm, minYmm, maxXmm, maxYmm);
  }
}

export class PathCommand {
  constructor(type, points = []) {
    if (!['moveTo', 'lineTo', 'quadraticTo', 'cubicTo', 'closePath'].includes(type)) {
      throw new TypeError(`Unsupported path command type: ${type}`);
    }
    if (!Array.isArray(points)) {
      throw new TypeError('PathCommand points must be an array.');
    }
    this.type = type;
    this.points = points.map((point) => ensurePoint(point));
  }

  toJSON() {
    return {
      type: this.type,
      points: this.points.map((point) => point.toJSON())
    };
  }

  static fromJSON(value) {
    return new PathCommand(value.type, (value.points || []).map(Point2D.fromJSON));
  }
}

export class Contour {
  constructor(commands = []) {
    this.commands = [];
    for (const command of commands) {
      this.addCommand(command);
    }
  }

  get isEmpty() {
    return this.commands.length === 0;
  }

  get isClosed() {
    return this.commands.some((command) => command.type === 'closePath');
  }

  moveTo(xMm, yMm) {
    this.addCommand(new PathCommand('moveTo', [new Point2D(xMm, yMm)]));
    return this;
  }

  lineTo(xMm, yMm) {
    this.addCommand(new PathCommand('lineTo', [new Point2D(xMm, yMm)]));
    return this;
  }

  quadraticTo(cxMm, cyMm, xMm, yMm) {
    this.addCommand(new PathCommand('quadraticTo', [
      new Point2D(cxMm, cyMm),
      new Point2D(xMm, yMm)
    ]));
    return this;
  }

  cubicTo(c1xMm, c1yMm, c2xMm, c2yMm, xMm, yMm) {
    this.addCommand(new PathCommand('cubicTo', [
      new Point2D(c1xMm, c1yMm),
      new Point2D(c2xMm, c2yMm),
      new Point2D(xMm, yMm)
    ]));
    return this;
  }

  closePath() {
    this.addCommand(new PathCommand('closePath'));
    return this;
  }

  addCommand(command) {
    const normalized = command instanceof PathCommand
      ? command
      : PathCommand.fromJSON(command);

    validateCommandShape(normalized);
    this.commands.push(normalized);
  }

  getPointsUsedByCommands() {
    return this.commands.flatMap((command) => command.points);
  }

  getBoundingBox() {
    return BoundingBox.fromPoints(this.getPointsUsedByCommands());
  }

  toJSON() {
    return {
      commands: this.commands.map((command) => command.toJSON())
    };
  }

  static fromJSON(value) {
    if (!value || typeof value !== 'object') {
      throw new TypeError('Contour.fromJSON expects an object.');
    }
    return new Contour((value.commands || []).map(PathCommand.fromJSON));
  }
}

export class VectorPath {
  constructor({ id = null, source = 'unknown', contours = [], metadata = {} } = {}) {
    this.id = id;
    this.source = source;
    this.metadata = { ...metadata };
    this.contours = [];

    for (const contour of contours) {
      this.addContour(contour);
    }
  }

  get isEmpty() {
    return this.contours.length === 0 || this.contours.every((contour) => contour.isEmpty);
  }

  addContour(contour) {
    const normalized = contour instanceof Contour ? contour : Contour.fromJSON(contour);
    this.contours.push(normalized);
    return normalized;
  }

  getBoundingBox() {
    let box = null;
    for (const contour of this.contours) {
      const contourBox = contour.getBoundingBox();
      if (!contourBox) continue;
      box = box ? box.union(contourBox) : contourBox;
    }
    return box;
  }

  toJSON() {
    return {
      id: this.id,
      source: this.source,
      metadata: { ...this.metadata },
      contours: this.contours.map((contour) => contour.toJSON()),
      boundingBox: this.getBoundingBox()?.toJSON() ?? null
    };
  }

  static fromJSON(value) {
    if (!value || typeof value !== 'object') {
      throw new TypeError('VectorPath.fromJSON expects an object.');
    }
    return new VectorPath({
      id: value.id ?? null,
      source: value.source ?? 'unknown',
      metadata: value.metadata ?? {},
      contours: (value.contours || []).map(Contour.fromJSON)
    });
  }
}

export class GlyphMetrics {
  constructor({ advanceWidthMm, boundingBox = null, ascenderMm = null, descenderMm = null } = {}) {
    assertFiniteNumber(advanceWidthMm, 'advanceWidthMm');
    this.advanceWidthMm = advanceWidthMm;
    this.boundingBox = boundingBox;
    this.ascenderMm = ascenderMm;
    this.descenderMm = descenderMm;
  }

  toJSON() {
    return {
      advanceWidthMm: roundForJson(this.advanceWidthMm),
      boundingBox: this.boundingBox?.toJSON() ?? null,
      ascenderMm: this.ascenderMm === null ? null : roundForJson(this.ascenderMm),
      descenderMm: this.descenderMm === null ? null : roundForJson(this.descenderMm)
    };
  }
}

export class FontProviderResult {
  /**
   * @param {object} options
   * @param {VectorPath} options.path Ordinary glyph outline contours. Required by every provider,
   *   even one that instead supplies `stoneCenters` below -- an empty VectorPath (no contours) in
   *   that case, not a placeholder shape.
   * @param {GlyphMetrics} options.metrics
   * @param {string} options.fontId
   * @param {string} options.text
   * @param {number} options.heightMm
   * @param {{xMm:number,yMm:number}[]|null} [options.stoneCenters] A font may return this instead of
   *   (never in addition to any meaningful use of) glyph contours: explicit, already-in-millimeters
   *   stone-center positions for this character, authored directly by the font rather than derived
   *   from any vector shape. GeometryEngine converts these straight into ordinary Stone objects --
   *   see GeometryEngine._buildPositionedContours()/generateTextLayout(). null (the default) means
   *   "this provider only ever returns ordinary contours", matching every provider before this field
   *   existed.
   */
  constructor({ path, metrics, fontId, text, heightMm, stoneCenters = null }) {
    if (!(path instanceof VectorPath)) {
      throw new TypeError('FontProviderResult path must be a VectorPath.');
    }
    if (!(metrics instanceof GlyphMetrics)) {
      throw new TypeError('FontProviderResult metrics must be GlyphMetrics.');
    }
    if (stoneCenters !== null) {
      if (!Array.isArray(stoneCenters)) {
        throw new TypeError('FontProviderResult stoneCenters must be an array when provided.');
      }
      for (const center of stoneCenters) {
        if (!center || !Number.isFinite(center.xMm) || !Number.isFinite(center.yMm)) {
          throw new TypeError('FontProviderResult stoneCenters entries must be {xMm, yMm} finite numbers.');
        }
      }
    }
    this.path = path;
    this.metrics = metrics;
    this.fontId = fontId;
    this.text = text;
    this.heightMm = heightMm;
    this.stoneCenters = stoneCenters;
  }

  toJSON() {
    return {
      fontId: this.fontId,
      text: this.text,
      heightMm: roundForJson(this.heightMm),
      metrics: this.metrics.toJSON(),
      path: this.path.toJSON(),
      stoneCenters: this.stoneCenters
        ? this.stoneCenters.map((c) => ({ xMm: roundForJson(c.xMm), yMm: roundForJson(c.yMm) }))
        : null
    };
  }
}

export function createRectangleVectorPath({ xMm, yMm, widthMm, heightMm, id = null }) {
  assertFiniteNumber(xMm, 'xMm');
  assertFiniteNumber(yMm, 'yMm');
  assertFiniteNumber(widthMm, 'widthMm');
  assertFiniteNumber(heightMm, 'heightMm');
  if (widthMm <= 0 || heightMm <= 0) {
    throw new RangeError('Rectangle width and height must be positive.');
  }

  const contour = new Contour()
    .moveTo(xMm, yMm)
    .lineTo(xMm + widthMm, yMm)
    .lineTo(xMm + widthMm, yMm + heightMm)
    .lineTo(xMm, yMm + heightMm)
    .closePath();

  return new VectorPath({ id, source: 'shape:rectangle', contours: [contour] });
}

export function createCircleVectorPath({ cxMm, cyMm, radiusMm, id = null }) {
  assertFiniteNumber(cxMm, 'cxMm');
  assertFiniteNumber(cyMm, 'cyMm');
  assertFiniteNumber(radiusMm, 'radiusMm');
  if (radiusMm <= 0) {
    throw new RangeError('Circle radius must be positive.');
  }

  // Four cubic Bézier curves approximate a circle. This is deterministic and
  // standard for vector interchange. The true flattening tolerance will be
  // handled by a later CurveSampler commit.
  const k = 0.5522847498307936;
  const c = radiusMm * k;

  const contour = new Contour()
    .moveTo(cxMm + radiusMm, cyMm)
    .cubicTo(cxMm + radiusMm, cyMm + c, cxMm + c, cyMm + radiusMm, cxMm, cyMm + radiusMm)
    .cubicTo(cxMm - c, cyMm + radiusMm, cxMm - radiusMm, cyMm + c, cxMm - radiusMm, cyMm)
    .cubicTo(cxMm - radiusMm, cyMm - c, cxMm - c, cyMm - radiusMm, cxMm, cyMm - radiusMm)
    .cubicTo(cxMm + c, cyMm - radiusMm, cxMm + radiusMm, cyMm - c, cxMm + radiusMm, cyMm)
    .closePath();

  return new VectorPath({ id, source: 'shape:circle', contours: [contour] });
}

function ensurePoint(value) {
  return value instanceof Point2D ? value : Point2D.fromJSON(value);
}

function validateCommandShape(command) {
  const expectedPoints = {
    moveTo: 1,
    lineTo: 1,
    quadraticTo: 2,
    cubicTo: 3,
    closePath: 0
  }[command.type];

  if (command.points.length !== expectedPoints) {
    throw new TypeError(`${command.type} expects ${expectedPoints} point(s), got ${command.points.length}.`);
  }
}

function assertFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
}

function roundForJson(value) {
  return Number(value.toFixed(6));
}
