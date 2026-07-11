/**
 * Top-level SVG import orchestrator.
 *
 * parseSvgDocument(svgSource) turns raw SVG text into a natural millimeter size and a flat list of
 * { contour, closed } shapes, ready for GeometryEngine.generateSvgLayout() to flatten/sample.
 * Pure parsing/measurement — no stone positions are invented here, matching
 * docs/ARCHITECTURE.md's "only the Geometry Engine generates stone positions" rule.
 *
 * No DOM/Canvas dependency, so this runs identically under plain Node (tests) and the browser.
 */

import { Contour, createCircleVectorPath, createRectangleVectorPath } from '../text/VectorPath.js';
import { parseXml } from './SvgXmlParser.js';
import { pathDataToContours } from './SvgPathData.js';
import { IDENTITY_MATRIX, composeMatrix, applyMatrix, parseTransformList } from './SvgTransform.js';

const MM_PER_INCH = 25.4;
const CSS_PX_PER_INCH = 96;

const SUPPORTED_SHAPE_ELEMENTS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon']);
const CONTAINER_ELEMENTS = new Set(['g', 'a', 'switch']);
// Legitimate non-shape SVG constructs: not directly rendered (defs/symbol/clipPath/mask/pattern),
// not geometry (style/title/desc/metadata), or explicitly out of scope (nested svg). These are
// skipped silently (not a "warning"-worthy shortcoming), matching SVG's own semantics.
const SILENTLY_SKIPPED_ELEMENTS = new Set([
  'defs', 'symbol', 'clipPath', 'mask', 'pattern', 'style', 'title', 'desc', 'metadata', 'svg'
]);

function unitToMmPerUnit(unit) {
  switch (unit) {
    case 'mm': return 1;
    case 'cm': return 10;
    case 'in': return MM_PER_INCH;
    case 'pt': return MM_PER_INCH / 72;
    case 'pc': return MM_PER_INCH / 6;
    case 'px': return MM_PER_INCH / CSS_PX_PER_INCH;
    default: return null;
  }
}

function parseLength(raw) {
  if (typeof raw !== 'string') return null;
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(mm|cm|in|pt|pc|px|%)?\s*$/.exec(raw);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: match[2] || 'px' };
}

function parseViewBox(raw) {
  if (typeof raw !== 'string') return null;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minX, minY, width, height] = parts;
  if (!(width > 0) || !(height > 0)) return null;
  return { minX, minY, width, height };
}

function optionalNumAttr(attrs, name, fallback = 0) {
  const raw = attrs[name];
  if (raw === undefined) return fallback;
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) throw new Error(`invalid numeric "${name}" attribute`);
  return value;
}

function requiredNumAttr(attrs, name) {
  const raw = attrs[name];
  if (raw === undefined) throw new Error(`missing "${name}" attribute`);
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) throw new Error(`invalid numeric "${name}" attribute`);
  return value;
}

function parsePointsAttr(raw) {
  if (typeof raw !== 'string') throw new Error('missing "points" attribute');
  const numbers = raw.trim().split(/[\s,]+/).filter((token) => token.length > 0).map(Number);
  if (numbers.some((n) => !Number.isFinite(n))) throw new Error('invalid "points" attribute');
  const points = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] });
  return points;
}

/**
 * Convert one shape element (local, pre-transform coordinates) into { contour, closed } entries.
 * Throws on a genuinely malformed element; the caller treats that as a skip-with-warning, not a
 * whole-document failure. Elements that are spec-valid but empty (non-positive radius/width/
 * height, per SVG's own "not rendered" rule) return an empty array without warning.
 */
function shapeElementToContours(element, warnings) {
  const { name, attrs } = element;

  switch (name) {
    case 'circle': {
      const cx = optionalNumAttr(attrs, 'cx', 0);
      const cy = optionalNumAttr(attrs, 'cy', 0);
      const r = requiredNumAttr(attrs, 'r');
      if (!(r > 0)) return [];
      const vectorPath = createCircleVectorPath({ cxMm: cx, cyMm: cy, radiusMm: r });
      return [{ contour: vectorPath.contours[0], closed: true }];
    }
    case 'rect': {
      const x = optionalNumAttr(attrs, 'x', 0);
      const y = optionalNumAttr(attrs, 'y', 0);
      const width = requiredNumAttr(attrs, 'width');
      const height = requiredNumAttr(attrs, 'height');
      if (!(width > 0) || !(height > 0)) return [];
      const rx = optionalNumAttr(attrs, 'rx', 0);
      const ry = optionalNumAttr(attrs, 'ry', 0);
      if (rx > 0 || ry > 0) {
        warnings.push('Rounded rectangle corners (rx/ry) are not supported; imported as a sharp rectangle.');
      }
      const vectorPath = createRectangleVectorPath({ xMm: x, yMm: y, widthMm: width, heightMm: height });
      return [{ contour: vectorPath.contours[0], closed: true }];
    }
    case 'line': {
      const x1 = optionalNumAttr(attrs, 'x1', 0);
      const y1 = optionalNumAttr(attrs, 'y1', 0);
      const x2 = optionalNumAttr(attrs, 'x2', 0);
      const y2 = optionalNumAttr(attrs, 'y2', 0);
      const contour = new Contour().moveTo(x1, y1).lineTo(x2, y2);
      return [{ contour, closed: false }];
    }
    case 'polyline':
    case 'polygon': {
      const points = parsePointsAttr(attrs.points);
      if (points.length < 2) throw new Error('requires at least two points');
      const contour = new Contour();
      contour.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) contour.lineTo(points[i].x, points[i].y);
      if (name === 'polygon') contour.closePath();
      return [{ contour, closed: name === 'polygon' }];
    }
    case 'path': {
      const d = attrs.d;
      if (typeof d !== 'string' || d.trim().length === 0) {
        warnings.push('<path> has an empty or missing "d" attribute; skipped.');
        return [];
      }
      return pathDataToContours(d);
    }
    default:
      throw new Error(`unhandled shape element <${name}>`);
  }
}

function transformContour(contour, matrix) {
  const out = new Contour();
  for (const command of contour.commands) {
    switch (command.type) {
      case 'moveTo': {
        const p = applyMatrix(matrix, command.points[0].xMm, command.points[0].yMm);
        out.moveTo(p.x, p.y);
        break;
      }
      case 'lineTo': {
        const p = applyMatrix(matrix, command.points[0].xMm, command.points[0].yMm);
        out.lineTo(p.x, p.y);
        break;
      }
      case 'quadraticTo': {
        const c = applyMatrix(matrix, command.points[0].xMm, command.points[0].yMm);
        const e = applyMatrix(matrix, command.points[1].xMm, command.points[1].yMm);
        out.quadraticTo(c.x, c.y, e.x, e.y);
        break;
      }
      case 'cubicTo': {
        const c1 = applyMatrix(matrix, command.points[0].xMm, command.points[0].yMm);
        const c2 = applyMatrix(matrix, command.points[1].xMm, command.points[1].yMm);
        const e = applyMatrix(matrix, command.points[2].xMm, command.points[2].yMm);
        out.cubicTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y);
        break;
      }
      case 'closePath':
        out.closePath();
        break;
      default:
        throw new Error(`Unsupported path command in SVG transform: ${command.type}`);
    }
  }
  return out;
}

/**
 * Parse SVG source text into its natural millimeter size and every supported shape's contour.
 *
 * @param {string} svgSource
 * @returns {{naturalWidthMm:number, naturalHeightMm:number, shapes:Array<{contour:Contour,closed:boolean}>, warnings:string[]}}
 */
export function parseSvgDocument(svgSource) {
  if (typeof svgSource !== 'string' || svgSource.trim().length === 0) {
    throw new TypeError('parseSvgDocument requires a non-empty SVG source string.');
  }

  let root;
  try {
    root = parseXml(svgSource);
  } catch (error) {
    throw new Error(`SVG parse error: ${error.message}`);
  }

  const svgRoot = root.children.find((child) => child.name === 'svg');
  if (!svgRoot) {
    throw new Error('SVG parse error: no <svg> root element found.');
  }

  const viewBox = parseViewBox(svgRoot.attrs.viewBox);
  const widthLength = parseLength(svgRoot.attrs.width);
  const heightLength = parseLength(svgRoot.attrs.height);

  let declaredWidthValue, declaredWidthUnit, declaredHeightValue, declaredHeightUnit;
  if (widthLength && heightLength) {
    declaredWidthValue = widthLength.value;
    declaredWidthUnit = widthLength.unit;
    declaredHeightValue = heightLength.value;
    declaredHeightUnit = heightLength.unit;
  } else if (viewBox) {
    declaredWidthValue = viewBox.width;
    declaredWidthUnit = 'px';
    declaredHeightValue = viewBox.height;
    declaredHeightUnit = 'px';
  } else {
    throw new Error('SVG parse error: the document must declare width/height or a viewBox.');
  }

  const widthMmPerUnit = unitToMmPerUnit(declaredWidthUnit);
  const heightMmPerUnit = unitToMmPerUnit(declaredHeightUnit);
  if (widthMmPerUnit === null || heightMmPerUnit === null) {
    throw new Error('SVG parse error: unsupported width/height unit (percentage sizing is not supported).');
  }
  if (!(declaredWidthValue > 0) || !(declaredHeightValue > 0)) {
    throw new Error('SVG parse error: width/height must be positive.');
  }

  const naturalWidthMm = declaredWidthValue * widthMmPerUnit;
  const naturalHeightMm = declaredHeightValue * heightMmPerUnit;

  let viewBoxMatrix = IDENTITY_MATRIX;
  if (viewBox) {
    const scaleX = declaredWidthValue / viewBox.width;
    const scaleY = declaredHeightValue / viewBox.height;
    viewBoxMatrix = { a: scaleX, b: 0, c: 0, d: scaleY, e: -viewBox.minX * scaleX, f: -viewBox.minY * scaleY };
  }
  const rootMatrix = composeMatrix(viewBoxMatrix, parseTransformList(svgRoot.attrs.transform));

  const shapes = [];
  const warnings = [];

  function walk(node, matrix) {
    for (const child of node.children) {
      const name = child.name;
      if (SILENTLY_SKIPPED_ELEMENTS.has(name)) continue;

      const localMatrix = composeMatrix(matrix, parseTransformList(child.attrs.transform));

      if (CONTAINER_ELEMENTS.has(name)) {
        walk(child, localMatrix);
        continue;
      }

      if (!SUPPORTED_SHAPE_ELEMENTS.has(name)) {
        warnings.push(`Unsupported element skipped: <${name}>`);
        continue;
      }

      try {
        const localContours = shapeElementToContours(child, warnings);
        for (const { contour, closed } of localContours) {
          shapes.push({ contour: transformContour(contour, localMatrix), closed });
        }
      } catch (error) {
        warnings.push(`Skipped <${name}>: ${error.message}`);
      }
    }
  }

  walk(svgRoot, rootMatrix);

  if (shapes.length === 0) {
    throw new Error('SVG parse error: the document contains no supported shapes (path/circle/rect/line/polyline/polygon).');
  }

  return { naturalWidthMm, naturalHeightMm, shapes, warnings };
}
