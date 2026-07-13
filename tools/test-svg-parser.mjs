import assert from 'node:assert/strict';
import { parseSvgDocument } from '../src/svg/SvgDocumentParser.js';
import { parseXml } from '../src/svg/SvgXmlParser.js';
import { parsePathData, arcToBezierSegments, pathDataToContours } from '../src/svg/SvgPathData.js';
import { parseTransformList, applyMatrix } from '../src/svg/SvgTransform.js';

// RS-1001 — unit tests for src/svg/** (SVG vector path extraction), independent of
// GeometryEngine/app.js. No DOM, no browser: pure string/XML/math parsing.

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function svg(body, { width = '50mm', height = '20mm', viewBox } = {}) {
  const vb = viewBox ? ` viewBox="${viewBox}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"${vb}>${body}</svg>`;
}

await test('1. a minimal <rect> parses to one closed contour with the expected corners', () => {
  const result = parseSvgDocument(svg('<rect x="1" y="2" width="3" height="4"/>'));
  assert.equal(result.shapes.length, 1);
  assert.equal(result.shapes[0].closed, true);
  const points = result.shapes[0].contour.getPointsUsedByCommands();
  const xs = points.map((p) => p.xMm);
  const ys = points.map((p) => p.yMm);
  assert.ok(Math.min(...xs) === 1 && Math.max(...xs) === 4);
  assert.ok(Math.min(...ys) === 2 && Math.max(...ys) === 6);
});

await test('2. circle/line/polyline/polygon parse to the expected shape/closedness', () => {
  const result = parseSvgDocument(svg(
    '<circle cx="5" cy="5" r="2"/>' +
    '<line x1="0" y1="0" x2="10" y2="10"/>' +
    '<polyline points="0,0 5,5 10,0"/>' +
    '<polygon points="0,0 5,5 10,0"/>'
  ));
  assert.equal(result.shapes.length, 4);
  const [circle, line, polyline, polygon] = result.shapes;
  assert.equal(circle.closed, true);
  assert.equal(line.closed, false);
  assert.equal(line.contour.getPointsUsedByCommands().length, 2);
  assert.equal(polyline.closed, false);
  assert.equal(polygon.closed, true);
});

await test('2b. <ellipse> parses to a closed contour spanning its independent rx/ry extents', () => {
  const result = parseSvgDocument(svg('<ellipse cx="5" cy="5" rx="3" ry="2"/>'));
  assert.equal(result.shapes.length, 1);
  assert.equal(result.shapes[0].closed, true);
  const points = result.shapes[0].contour.getPointsUsedByCommands();
  const xs = points.map((p) => p.xMm);
  const ys = points.map((p) => p.yMm);
  assert.ok(Math.abs(Math.min(...xs) - 2) < 1e-9 && Math.abs(Math.max(...xs) - 8) < 1e-9);
  assert.ok(Math.abs(Math.min(...ys) - 3) < 1e-9 && Math.abs(Math.max(...ys) - 7) < 1e-9);
});

await test('3. <path> parses M L H V C S Q T Z (absolute/relative); multiple M subpaths split into multiple contours; unclosed subpath is open', () => {
  const contours = pathDataToContours('M0,0 L10,0 H20 V10 C20,20 10,20 10,10 S0,20 0,10 Q-5,5 0,0 T0,0 Z M5,5 l5,0');
  assert.equal(contours.length, 2, 'expected two subpaths (one closed with Z, one open)');
  assert.equal(contours[0].closed, true);
  assert.equal(contours[1].closed, false);

  const relative = pathDataToContours('M0,0 l10,0 l0,10 z');
  const points = relative[0].contour.getPointsUsedByCommands();
  assert.deepEqual(
    points.map((p) => [p.xMm, p.yMm]),
    [[0, 0], [10, 0], [10, 10]]
  );
});

await test('4. elliptical arc endpoint is correct; degenerate arcs fall back to a line without throwing', () => {
  const segments = arcToBezierSegments(1, 0, 1, 1, 0, false, true, 0, 1);
  const last = segments[segments.length - 1];
  assert.ok(Math.abs(last.x - 0) < 1e-9 && Math.abs(last.y - 1) < 1e-9);

  assert.deepEqual(arcToBezierSegments(0, 0, 0, 5, 0, false, true, 10, 10), [{ line: true, x: 10, y: 10 }]);
  assert.deepEqual(arcToBezierSegments(5, 5, 1, 1, 0, false, false, 5, 5), []);
});

await test('5. transform composition (translate/scale/rotate-with-pivot/skew/matrix/nested groups) applies in SVG-spec order', () => {
  // translate(-10,-20) scale(2) rotate(45) translate(5,10), applied to (0,0):
  // innermost-first application order per the SVG spec (last-listed function applied first).
  const m = parseTransformList('translate(-10,-20) scale(2) rotate(45) translate(5,10)');
  const p = applyMatrix(m, 0, 0);
  const rad = (45 * Math.PI) / 180;
  const rx = 5 * Math.cos(rad) - 10 * Math.sin(rad);
  const ry = 5 * Math.sin(rad) + 10 * Math.cos(rad);
  assert.ok(Math.abs(p.x - (rx * 2 - 10)) < 1e-9);
  assert.ok(Math.abs(p.y - (ry * 2 - 20)) < 1e-9);

  const pivotRotate = parseTransformList('rotate(90,10,10)');
  const rotated = applyMatrix(pivotRotate, 10, 0);
  assert.ok(Math.abs(rotated.x - 20) < 1e-9 && Math.abs(rotated.y - 10) < 1e-9, 'expected a 90deg rotation about (10,10) to map (10,0) to (20,10)');

  const skewed = applyMatrix(parseTransformList('skewX(45)'), 0, 1);
  assert.ok(Math.abs(skewed.x - 1) < 1e-9, 'expected skewX(45) to shift x by tan(45)*y = 1');

  const matrixResult = applyMatrix(parseTransformList('matrix(2,0,0,3,4,5)'), 1, 1);
  assert.deepEqual(matrixResult, { x: 2 * 1 + 4, y: 3 * 1 + 5 });

  // Nested <g> transforms compose (parent applied after child).
  const nested = parseSvgDocument(svg('<g transform="translate(10,0)"><g transform="scale(2)"><rect x="0" y="0" width="1" height="1"/></g></g>'));
  const nestedPoints = nested.shapes[0].contour.getPointsUsedByCommands();
  const nestedXs = nestedPoints.map((p) => p.xMm);
  assert.ok(Math.min(...nestedXs) === 10 && Math.max(...nestedXs) === 12, 'expected scale(2) then translate(10,0): [0,1] -> [10,12]');
});

await test('6. unit conversion resolves the expected naturalWidthMm; viewBox-only and neither-present cases behave as documented', () => {
  const mm = parseSvgDocument(svg('<rect x="0" y="0" width="1" height="1"/>', { width: '50mm', height: '20mm' }));
  assert.equal(mm.naturalWidthMm, 50);

  const cm = parseSvgDocument(svg('<rect x="0" y="0" width="1" height="1"/>', { width: '5cm', height: '2cm' }));
  assert.equal(cm.naturalWidthMm, 50);

  const inches = parseSvgDocument(svg('<rect x="0" y="0" width="1" height="1"/>', { width: '2in', height: '1in' }));
  assert.ok(Math.abs(inches.naturalWidthMm - 50.8) < 1e-9);

  const px = parseSvgDocument(svg('<rect x="0" y="0" width="1" height="1"/>', { width: '200px', height: '100px' }));
  assert.ok(Math.abs(px.naturalWidthMm - (200 * 25.4) / 96) < 1e-9);

  const unitless = parseSvgDocument(svg('<rect x="0" y="0" width="1" height="1"/>', { width: '200', height: '100' }));
  assert.equal(unitless.naturalWidthMm, px.naturalWidthMm);

  const viewBoxOnly = parseSvgDocument(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect x="0" y="0" width="1" height="1"/></svg>'
  );
  assert.equal(viewBoxOnly.naturalWidthMm, (200 * 25.4) / 96);

  assert.throws(
    () => parseSvgDocument('<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="1" height="1"/></svg>'),
    /width\/height or a viewBox/
  );
});

await test('7. a mix of one supported and one unsupported element imports the supported one and records a warning', () => {
  const result = parseSvgDocument(svg('<rect x="0" y="0" width="1" height="1"/><image href="x.png" x="0" y="0" width="1" height="1"/>'));
  assert.equal(result.shapes.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /image/);
});

await test('8. a document with only unsupported elements throws a clear "no supported shapes" error', () => {
  assert.throws(
    () => parseSvgDocument(svg('<image href="x.png" x="0" y="0" width="1" height="1"/>')),
    /no supported shapes/
  );
});

await test('9. malformed XML throws a clear parse error', () => {
  assert.throws(() => parseXml('<svg><rect x="0"'), /unterminated tag/);
  assert.throws(() => parseXml('<svg><rect></svg>'), /mismatched closing tag/);
  assert.throws(() => parseSvgDocument('<svg width="10mm" height="10mm"><rect x="0" y="0" width="1" height="1">'), /SVG parse error/);
});

await test('10. a single malformed <path> is skipped with a warning, not aborting a document with other valid shapes', () => {
  const result = parseSvgDocument(svg('<path d="M0,0 Q"/><rect x="0" y="0" width="1" height="1"/>'));
  assert.equal(result.shapes.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Skipped <path>/);
});

await test('11. parsing the same source twice produces deepEqual contour output (deterministic)', () => {
  const source = svg('<path d="M0,0 C1,1 2,2 3,3 A2,2 0 0 1 5,5 Z"/><circle cx="5" cy="5" r="2"/>');
  const first = parseSvgDocument(source);
  const second = parseSvgDocument(source);
  const serialize = (r) => JSON.stringify({
    naturalWidthMm: r.naturalWidthMm,
    naturalHeightMm: r.naturalHeightMm,
    shapes: r.shapes.map((s) => ({ closed: s.closed, contour: s.contour.toJSON() }))
  });
  assert.equal(serialize(first), serialize(second));
});

await test('extra: parsePathData rejects a path that does not start with a move command', () => {
  assert.throws(() => parsePathData('L10,10'), /must start with a move command/);
});

await test('extra: rounded rect corners are imported as a sharp rectangle with a warning', () => {
  const result = parseSvgDocument(svg('<rect x="0" y="0" width="10" height="10" rx="2" ry="2"/>'));
  assert.equal(result.shapes.length, 1);
  assert.match(result.warnings[0], /Rounded rectangle corners/);
});

await test('extra: zero-radius circle/ellipse and zero-size rect are valid-but-empty (SVG "not rendered" rule), not errors', () => {
  const result = parseSvgDocument(svg(
    '<circle cx="0" cy="0" r="0"/><ellipse cx="0" cy="0" rx="0" ry="5"/>' +
    '<rect x="0" y="0" width="0" height="5"/><rect x="0" y="0" width="5" height="5"/>'
  ));
  assert.equal(result.shapes.length, 1);
  assert.equal(result.warnings.length, 0);
});

await test('RS-2000: a non-mm unit with a matching viewBox produces shape coordinates in real millimeters, not the declared unit\'s raw numeric value', () => {
  // width="100" (unitless -> px) + viewBox="0 0 100 100" is an extremely common real-world SVG
  // pattern (icon libraries, exported logos). naturalWidthMm correctly resolves to ~26.46mm
  // (100px at 96 CSS px/inch); shape coordinates must land in that same millimeter space, not be
  // left at their raw 0-100 viewBox-unit values (the pre-fix bug: coordinates were off by a factor
  // of 1/widthMmPerUnit, ~3.78x too large per axis for this case).
  const result = parseSvgDocument(svg('<rect x="0" y="0" width="100" height="100"/>', { width: '100', height: '100', viewBox: '0 0 100 100' }));
  const xs = result.shapes[0].contour.getPointsUsedByCommands().map((p) => p.xMm);
  const expectedMaxMm = (100 * 25.4) / 96;
  assert.ok(Math.abs(Math.max(...xs) - expectedMaxMm) < 1e-9, `expected shape's max x to equal naturalWidthMm (${expectedMaxMm}), got ${Math.max(...xs)}`);
  assert.ok(Math.abs(Math.max(...xs) - result.naturalWidthMm) < 1e-9, 'shape coordinates must match naturalWidthMm\'s unit space exactly');
});

await test('RS-2000: a non-mm unit with NO viewBox also produces shape coordinates in real millimeters', () => {
  // No viewBox means 1 user-unit == 1 declared-unit (standard SVG semantics) -- still needs the
  // declared unit's mm-per-unit factor applied, the same gap the viewBox branch had.
  const result = parseSvgDocument(svg('<rect x="0" y="0" width="200" height="100"/>', { width: '200px', height: '100px' }));
  const xs = result.shapes[0].contour.getPointsUsedByCommands().map((p) => p.xMm);
  const expectedMaxMm = (200 * 25.4) / 96;
  assert.ok(Math.abs(Math.max(...xs) - expectedMaxMm) < 1e-9, `expected shape's max x to equal naturalWidthMm (${expectedMaxMm}), got ${Math.max(...xs)}`);
});

await test('RS-2000: the "mm" unit case is unchanged (byte-identical scale factor of 1, matching every pre-existing test in this file)', () => {
  const result = parseSvgDocument(svg('<rect x="0" y="0" width="10" height="10"/>', { width: '50mm', height: '20mm', viewBox: '0 0 10 10' }));
  const xs = result.shapes[0].contour.getPointsUsedByCommands().map((p) => p.xMm);
  assert.equal(Math.max(...xs), 50, 'viewBox case: 10 user-units -> 50mm declared width, unaffected by this fix');
});

console.log('SVG parser tests passed.');
