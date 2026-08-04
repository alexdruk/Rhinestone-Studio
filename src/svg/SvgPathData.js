/**
 * SVG `<path d="...">` grammar parser and elliptical-arc-to-cubic-Bezier conversion.
 *
 * Produces src/text/VectorPath.js Contours (the same neutral vector-path primitive font glyphs and
 * shape layers already use), so downstream flattening/sampling needs no SVG-specific code.
 */

import { Contour } from '../text/VectorPath.js';

const COMMAND_LETTERS = new Set('MmLlHhVvCcSsQqTtAaZz'.split(''));

function isWhitespaceOrComma(ch) {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === ',';
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

class PathTokenizer {
  constructor(d) {
    this.text = d;
    this.n = d.length;
    this.i = 0;
  }

  skipWs() {
    while (this.i < this.n && isWhitespaceOrComma(this.text[this.i])) this.i++;
  }

  peekCommand() {
    this.skipWs();
    const ch = this.text[this.i];
    return ch !== undefined && COMMAND_LETTERS.has(ch) ? ch : null;
  }

  consumeCommand() {
    const ch = this.text[this.i];
    this.i++;
    return ch;
  }

  atEnd() {
    this.skipWs();
    return this.i >= this.n;
  }

  readNumber() {
    this.skipWs();
    const start = this.i;
    const text = this.text;
    if (text[this.i] === '+' || text[this.i] === '-') this.i++;
    while (this.i < this.n && isDigit(text[this.i])) this.i++;
    if (text[this.i] === '.') {
      this.i++;
      while (this.i < this.n && isDigit(text[this.i])) this.i++;
    }
    if (text[this.i] === 'e' || text[this.i] === 'E') {
      const expStart = this.i;
      this.i++;
      if (text[this.i] === '+' || text[this.i] === '-') this.i++;
      if (isDigit(text[this.i])) {
        while (this.i < this.n && isDigit(text[this.i])) this.i++;
      } else {
        this.i = expStart; // not actually an exponent; back off
      }
    }
    if (this.i === start || (this.i === start + 1 && (text[start] === '+' || text[start] === '-' || text[start] === '.'))) {
      throw new Error(`Expected a number at position ${this.i} in path data.`);
    }
    return parseFloat(text.slice(start, this.i));
  }

  readFlag() {
    this.skipWs();
    const ch = this.text[this.i];
    if (ch !== '0' && ch !== '1') {
      throw new Error(`Expected a flag (0 or 1) at position ${this.i} in path data.`);
    }
    this.i++;
    return ch === '1';
  }
}

/**
 * Tokenize an SVG path `d` attribute into a flat command list with resolved argument counts
 * (implicit command repetition already expanded, including the "M repeats as L" rule).
 *
 * @param {string} d
 * @returns {Array<Object>}
 */
export function parsePathData(d) {
  const tokenizer = new PathTokenizer(d);
  const commands = [];
  let currentLetter = null;
  let first = true;

  while (!tokenizer.atEnd()) {
    const next = tokenizer.peekCommand();
    if (next) {
      currentLetter = tokenizer.consumeCommand();
    } else if (currentLetter === null) {
      throw new Error('SVG path data must start with a move command (M/m).');
    } else if (currentLetter === 'Z' || currentLetter === 'z') {
      throw new Error('SVG path data has trailing coordinates after a close-path command with no following command letter.');
    }
    if (first) {
      if (currentLetter !== 'M' && currentLetter !== 'm') {
        throw new Error('SVG path data must start with a move command (M/m).');
      }
      first = false;
    }

    const rel = currentLetter === currentLetter.toLowerCase();
    switch (currentLetter.toUpperCase()) {
      case 'M': {
        const x = tokenizer.readNumber();
        const y = tokenizer.readNumber();
        commands.push({ type: 'M', rel, x, y });
        // Subsequent coordinate pairs without a new command letter are implicit LineTo commands.
        currentLetter = rel ? 'l' : 'L';
        break;
      }
      case 'L': {
        const x = tokenizer.readNumber();
        const y = tokenizer.readNumber();
        commands.push({ type: 'L', rel, x, y });
        break;
      }
      case 'H':
        commands.push({ type: 'H', rel, x: tokenizer.readNumber() });
        break;
      case 'V':
        commands.push({ type: 'V', rel, y: tokenizer.readNumber() });
        break;
      case 'C': {
        const x1 = tokenizer.readNumber(), y1 = tokenizer.readNumber();
        const x2 = tokenizer.readNumber(), y2 = tokenizer.readNumber();
        const x = tokenizer.readNumber(), y = tokenizer.readNumber();
        commands.push({ type: 'C', rel, x1, y1, x2, y2, x, y });
        break;
      }
      case 'S': {
        const x2 = tokenizer.readNumber(), y2 = tokenizer.readNumber();
        const x = tokenizer.readNumber(), y = tokenizer.readNumber();
        commands.push({ type: 'S', rel, x2, y2, x, y });
        break;
      }
      case 'Q': {
        const x1 = tokenizer.readNumber(), y1 = tokenizer.readNumber();
        const x = tokenizer.readNumber(), y = tokenizer.readNumber();
        commands.push({ type: 'Q', rel, x1, y1, x, y });
        break;
      }
      case 'T': {
        const x = tokenizer.readNumber(), y = tokenizer.readNumber();
        commands.push({ type: 'T', rel, x, y });
        break;
      }
      case 'A': {
        const rx = tokenizer.readNumber(), ry = tokenizer.readNumber();
        const rot = tokenizer.readNumber();
        const large = tokenizer.readFlag();
        const sweep = tokenizer.readFlag();
        const x = tokenizer.readNumber(), y = tokenizer.readNumber();
        commands.push({ type: 'A', rel, rx, ry, rot, large, sweep, x, y });
        break;
      }
      case 'Z':
        commands.push({ type: 'Z' });
        currentLetter = null;
        break;
      default:
        throw new Error(`Unsupported SVG path command "${currentLetter}".`);
    }
  }

  return commands;
}

/**
 * Convert one elliptical arc segment (SVG's endpoint parameterization) into cubic Bezier
 * segments, using the standard center-parameterization algorithm from the SVG implementation
 * notes. Degenerate arcs (zero radius, or identical endpoints) resolve to a straight line instead
 * of throwing, matching how a real SVG renderer treats them.
 *
 * @returns {Array<{line:true,x:number,y:number}|{c1x:number,c1y:number,c2x:number,c2y:number,x:number,y:number}>}
 */
export function arcToBezierSegments(x1, y1, rxIn, ryIn, xAxisRotationDeg, largeArcFlag, sweepFlag, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  if (rxIn === 0 || ryIn === 0) return [{ line: true, x: x2, y: y2 }];

  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;
  let rxSq = rx * rx;
  let rySq = ry * ry;
  const lambda = x1pSq / rxSq + y1pSq / rySq;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
    rxSq = rx * rx;
    rySq = ry * ry;
  }

  const sign = largeArcFlag !== sweepFlag ? 1 : -1;
  const numerator = Math.max(0, rxSq * rySq - rxSq * y1pSq - rySq * x1pSq);
  const denominator = rxSq * y1pSq + rySq * x1pSq;
  const coef = denominator === 0 ? 0 : sign * Math.sqrt(numerator / denominator);
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (coef * (-ry * x1p)) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const vectorAngle = (ux, uy, vx, vy) => {
    const sign2 = ux * vy - uy * vx < 0 ? -1 : 1;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const dot = len === 0 ? 1 : Math.max(-1, Math.min(1, (ux * vx + uy * vy) / len));
    return sign2 * Math.acos(dot);
  };

  const theta1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vectorAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweepFlag && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweepFlag && dTheta < 0) dTheta += 2 * Math.PI;

  const numSegments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2 + 1e-6)));
  const delta = dTheta / numSegments;
  const t = (4 / 3) * Math.tan(delta / 4);

  const ellipsePoint = (angle) => {
    const ex = rx * Math.cos(angle);
    const ey = ry * Math.sin(angle);
    return { x: cx + cosPhi * ex - sinPhi * ey, y: cy + sinPhi * ex + cosPhi * ey };
  };
  const rotateVector = (vx, vy) => ({ x: cosPhi * vx - sinPhi * vy, y: sinPhi * vx + cosPhi * vy });

  const segments = [];
  let angle1 = theta1;
  for (let i = 0; i < numSegments; i++) {
    const angle2 = angle1 + delta;
    const p1 = ellipsePoint(angle1);
    const p2 = ellipsePoint(angle2);
    const d1 = rotateVector(-rx * Math.sin(angle1), ry * Math.cos(angle1));
    const d2 = rotateVector(-rx * Math.sin(angle2), ry * Math.cos(angle2));

    segments.push({
      c1x: p1.x + t * d1.x,
      c1y: p1.y + t * d1.y,
      c2x: p2.x - t * d2.x,
      c2y: p2.y - t * d2.y,
      x: p2.x,
      y: p2.y
    });
    angle1 = angle2;
  }

  // Force the final segment's endpoint to be bit-exact with the requested endpoint, since the
  // trigonometric round trip can leave a sub-1e-9mm floating point residue.
  segments[segments.length - 1].x = x2;
  segments[segments.length - 1].y = y2;

  return segments;
}

/**
 * Convert parsed path commands into one or more { contour, closed } entries, splitting a new
 * Contour at every 'M'/'m' (each subpath is independent) and tracking closedness per subpath.
 *
 * @param {Array<Object>} commands
 * @returns {Array<{contour: Contour, closed: boolean}>}
 */
export function commandsToContours(commands) {
  const results = [];
  let current = null;
  let subpathStart = null;
  let active = null;
  let prevControl = null;
  let prevType = null;

  function startSubpath(x, y) {
    if (active) results.push(active);
    const contour = new Contour();
    contour.moveTo(x, y);
    active = { contour, closed: false };
    current = { x, y };
    subpathStart = { x, y };
  }

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M': {
        const x = cmd.rel && current ? current.x + cmd.x : cmd.x;
        const y = cmd.rel && current ? current.y + cmd.y : cmd.y;
        startSubpath(x, y);
        prevControl = null;
        prevType = 'M';
        break;
      }
      case 'L': {
        const x = cmd.rel ? current.x + cmd.x : cmd.x;
        const y = cmd.rel ? current.y + cmd.y : cmd.y;
        active.contour.lineTo(x, y);
        current = { x, y };
        prevControl = null;
        prevType = 'L';
        break;
      }
      case 'H': {
        const x = cmd.rel ? current.x + cmd.x : cmd.x;
        active.contour.lineTo(x, current.y);
        current = { x, y: current.y };
        prevControl = null;
        prevType = 'H';
        break;
      }
      case 'V': {
        const y = cmd.rel ? current.y + cmd.y : cmd.y;
        active.contour.lineTo(current.x, y);
        current = { x: current.x, y };
        prevControl = null;
        prevType = 'V';
        break;
      }
      case 'C': {
        const x1 = cmd.rel ? current.x + cmd.x1 : cmd.x1, y1 = cmd.rel ? current.y + cmd.y1 : cmd.y1;
        const x2 = cmd.rel ? current.x + cmd.x2 : cmd.x2, y2 = cmd.rel ? current.y + cmd.y2 : cmd.y2;
        const x = cmd.rel ? current.x + cmd.x : cmd.x, y = cmd.rel ? current.y + cmd.y : cmd.y;
        active.contour.cubicTo(x1, y1, x2, y2, x, y);
        current = { x, y };
        prevControl = { x: x2, y: y2 };
        prevType = 'C';
        break;
      }
      case 'S': {
        const x2 = cmd.rel ? current.x + cmd.x2 : cmd.x2, y2 = cmd.rel ? current.y + cmd.y2 : cmd.y2;
        const x = cmd.rel ? current.x + cmd.x : cmd.x, y = cmd.rel ? current.y + cmd.y : cmd.y;
        const reflected = (prevType === 'C' || prevType === 'S') && prevControl
          ? { x: 2 * current.x - prevControl.x, y: 2 * current.y - prevControl.y }
          : { x: current.x, y: current.y };
        active.contour.cubicTo(reflected.x, reflected.y, x2, y2, x, y);
        current = { x, y };
        prevControl = { x: x2, y: y2 };
        prevType = 'S';
        break;
      }
      case 'Q': {
        const x1 = cmd.rel ? current.x + cmd.x1 : cmd.x1, y1 = cmd.rel ? current.y + cmd.y1 : cmd.y1;
        const x = cmd.rel ? current.x + cmd.x : cmd.x, y = cmd.rel ? current.y + cmd.y : cmd.y;
        active.contour.quadraticTo(x1, y1, x, y);
        current = { x, y };
        prevControl = { x: x1, y: y1 };
        prevType = 'Q';
        break;
      }
      case 'T': {
        const x = cmd.rel ? current.x + cmd.x : cmd.x, y = cmd.rel ? current.y + cmd.y : cmd.y;
        const reflected = (prevType === 'Q' || prevType === 'T') && prevControl
          ? { x: 2 * current.x - prevControl.x, y: 2 * current.y - prevControl.y }
          : { x: current.x, y: current.y };
        active.contour.quadraticTo(reflected.x, reflected.y, x, y);
        current = { x, y };
        prevControl = { x: reflected.x, y: reflected.y };
        prevType = 'T';
        break;
      }
      case 'A': {
        const x = cmd.rel ? current.x + cmd.x : cmd.x, y = cmd.rel ? current.y + cmd.y : cmd.y;
        const segments = arcToBezierSegments(current.x, current.y, cmd.rx, cmd.ry, cmd.rot, cmd.large, cmd.sweep, x, y);
        for (const segment of segments) {
          if (segment.line) active.contour.lineTo(segment.x, segment.y);
          else active.contour.cubicTo(segment.c1x, segment.c1y, segment.c2x, segment.c2y, segment.x, segment.y);
        }
        current = { x, y };
        prevControl = null;
        prevType = 'A';
        break;
      }
      case 'Z': {
        active.contour.closePath();
        active.closed = true;
        current = { ...subpathStart };
        prevControl = null;
        prevType = 'Z';
        break;
      }
      default:
        throw new Error(`Unsupported path command type "${cmd.type}".`);
    }
  }

  if (active) results.push(active);
  return results;
}

/**
 * Parse an SVG path `d` attribute directly into { contour, closed } entries.
 *
 * @param {string} d
 * @returns {Array<{contour: Contour, closed: boolean}>}
 */
export function pathDataToContours(d) {
  if (typeof d !== 'string' || d.trim().length === 0) return [];
  return commandsToContours(parsePathData(d));
}
