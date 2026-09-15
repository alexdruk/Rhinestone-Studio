import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-3036 — DXF cutting-template export. Verifies:
//   - stoneLayoutToDxf() produces a valid, deterministic, millimeter-scale DXF document: correct
//     $INSUNITS, one CANVAS boundary polyline, one circle per stone at the Y-flipped position
//     StoneLayout -> DXF (DXF is Y-up), one layer per distinct stone color via
//     dxfLayerNameForColor().
//   - stoneLayoutToDxf() fails clearly on invalid input, mirroring stoneLayoutToSvg()'s validation.
//   - DxfExporter.js has no GeometryEngine/Project/Layer knowledge.
//   - app.js wires #exportDXF the same way as every other export handler; index.html exposes it.
//   - A real Project -> GeometryEngine -> StoneLayout -> DXF pipeline produces the expected,
//     independently-measured geometry for examples/rectangle-only.rhs.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const { stoneLayoutToDxf, dxfLayerNameForColor } = await import('../src/export/DxfExporter.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');
const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');
const { GeometryEngine } = await import('../src/geometry/index.js');
const { validateRhsProject, generateProjectStoneLayout } = await import('./lib/rhsProject.mjs');

const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const dxfExporterSource = await readFile(path.join(repoRoot, 'src/export/DxfExporter.js'), 'utf8');

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

function makeLayout(stoneParams, layerId = 'rect-1') {
  const stones = stoneParams.map((p, index) => new Stone({ layerId, index, ...p }));
  return new StoneLayout({ layerId, stones, sourceMode: 'outline' });
}

// --- Minimal DXF group-code reader --------------------------------------------------------------
// DXF is a flat stream of (code, value) line pairs. This reader walks that stream, tracking the
// current SECTION and the entity/table-row currently being accumulated, and collects just the
// fields the tests below need: CIRCLE {layer,x,y,r}, LWPOLYLINE {layer,flags,vertices}, TABLES
// LAYER names, and header $INSUNITS.
function parseDxf(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push({ code: parseInt(lines[i].trim(), 10), value: lines[i + 1].trim() });
  }

  const layerNames = [];
  const circles = [];
  const polylines = [];
  let insunits = null;
  let section = null;
  let entity = null;

  function flushEntity() {
    if (!entity) return;
    if (entity.type === 'CIRCLE') {
      circles.push({ layer: entity.layer, x: entity.x, y: entity.y, r: entity.r });
    } else if (entity.type === 'LWPOLYLINE') {
      polylines.push({ layer: entity.layer, flags: entity.flags, vertices: entity.vertices });
    } else if (entity.type === 'LAYER' && entity.name) {
      layerNames.push(entity.name);
    }
    entity = null;
  }

  for (let idx = 0; idx < pairs.length; idx++) {
    const { code, value } = pairs[idx];

    if (code === 0) {
      flushEntity();
      if (value === 'SECTION' || value === 'ENDSEC') {
        section = null;
      } else if (value === 'CIRCLE') {
        entity = { type: 'CIRCLE' };
      } else if (value === 'LWPOLYLINE') {
        entity = { type: 'LWPOLYLINE', vertices: [] };
      } else if (value === 'LAYER' && section === 'TABLES') {
        entity = { type: 'LAYER' };
      }
      continue;
    }

    if (section === null && code === 2) {
      section = value;
      continue;
    }

    if (code === 9 && value === '$INSUNITS') {
      const next = pairs[idx + 1];
      if (next && next.code === 70) insunits = parseFloat(next.value);
      continue;
    }

    if (!entity) continue;

    if (entity.type === 'CIRCLE') {
      if (code === 8) entity.layer = value;
      else if (code === 10) entity.x = parseFloat(value);
      else if (code === 20) entity.y = parseFloat(value);
      else if (code === 40) entity.r = parseFloat(value);
    } else if (entity.type === 'LWPOLYLINE') {
      if (code === 8) entity.layer = value;
      else if (code === 70) entity.flags = parseFloat(value);
      else if (code === 10) entity.vertices.push({ x: parseFloat(value), y: undefined });
      else if (code === 20) {
        const v = entity.vertices[entity.vertices.length - 1];
        if (v) v.y = parseFloat(value);
      }
    } else if (entity.type === 'LAYER') {
      if (code === 2) entity.name = value;
    }
  }
  flushEntity();

  return { layerNames, circles, polylines, insunits };
}

await test('1. $INSUNITS is 4 (Millimeters)', () => {
  const dxf = stoneLayoutToDxf(makeLayout([{ xMm: 1, yMm: 1, sizeMm: 2, color: 'gold' }]), { widthMm: 50, heightMm: 50 });
  const parsed = parseDxf(dxf);
  assert.equal(parsed.insunits, 4);
});

await test('2. circle count equals stones.length for a 3-stone, 3-colour layout', () => {
  const layout = makeLayout([
    { xMm: 5, yMm: 5, sizeMm: 2, color: 'gold' },
    { xMm: 10, yMm: 5, sizeMm: 2, color: 'sapphire' },
    { xMm: 15, yMm: 5, sizeMm: 2, color: 'jet' }
  ]);
  const parsed = parseDxf(stoneLayoutToDxf(layout, { widthMm: 50, heightMm: 20 }));
  assert.equal(parsed.circles.length, 3);
});

const ASYMMETRIC_W = 210;
const ASYMMETRIC_H = 90;
const ASYMMETRIC_STONES = [
  { xMm: 20, yMm: 1, sizeMm: 2, color: 'gold' },
  { xMm: 60, yMm: 30, sizeMm: 3, color: 'sapphire' },
  { xMm: 100, yMm: 88.9, sizeMm: 1.5, color: 'jet' }
];

await test('3. every circle equals (xMm, H - yMm, sizeMm/2) within 1e-9', () => {
  const layout = makeLayout(ASYMMETRIC_STONES);
  const parsed = parseDxf(stoneLayoutToDxf(layout, { widthMm: ASYMMETRIC_W, heightMm: ASYMMETRIC_H }));
  assert.equal(parsed.circles.length, ASYMMETRIC_STONES.length);
  for (let i = 0; i < ASYMMETRIC_STONES.length; i++) {
    const s = ASYMMETRIC_STONES[i];
    const c = parsed.circles[i];
    assert.ok(Math.abs(c.x - s.xMm) < 1e-9, `circle ${i} x mismatch`);
    assert.ok(Math.abs(c.y - (ASYMMETRIC_H - s.yMm)) < 1e-9, `circle ${i} y mismatch`);
    assert.ok(Math.abs(c.r - s.sizeMm / 2) < 1e-9, `circle ${i} r mismatch`);
  }
});

await test('4. negative control: the yMm=1 stone maps to DXF y=89, not 1', () => {
  const layout = makeLayout(ASYMMETRIC_STONES);
  const parsed = parseDxf(stoneLayoutToDxf(layout, { widthMm: ASYMMETRIC_W, heightMm: ASYMMETRIC_H }));
  const c = parsed.circles[0];
  assert.ok(Math.abs(c.y - 89) < 1e-9, 'expected DXF y to equal H - yMm (89)');
  assert.notEqual(c.y, 1, 'DXF y must not equal the raw StoneLayout yMm (1) -- Y is Y-up in DXF');
});

await test('5. exactly one closed CANVAS LWPOLYLINE with the expected corner vertices', () => {
  const layout = makeLayout(ASYMMETRIC_STONES);
  const parsed = parseDxf(stoneLayoutToDxf(layout, { widthMm: ASYMMETRIC_W, heightMm: ASYMMETRIC_H }));
  const canvasPolylines = parsed.polylines.filter((p) => p.layer === 'CANVAS');
  assert.equal(canvasPolylines.length, 1, 'expected exactly one CANVAS LWPOLYLINE');
  const poly = canvasPolylines[0];
  assert.ok((poly.flags & 1) === 1, 'expected the CANVAS polyline to carry the Closed flag');
  assert.deepEqual(
    poly.vertices,
    [{ x: 0, y: 0 }, { x: ASYMMETRIC_W, y: 0 }, { x: ASYMMETRIC_W, y: ASYMMETRIC_H }, { x: 0, y: ASYMMETRIC_H }]
  );
});

await test('6. per-color layers are named exactly via dxfLayerNameForColor()', () => {
  const layout = makeLayout([
    { xMm: 5, yMm: 5, sizeMm: 2, color: 'gold' },
    { xMm: 10, yMm: 5, sizeMm: 2, color: 'Crystal AB' },
    { xMm: 15, yMm: 5, sizeMm: 2, color: 'weird id/x' }
  ]);
  const parsed = parseDxf(stoneLayoutToDxf(layout, { widthMm: 50, heightMm: 20 }));

  for (const c of parsed.circles) {
    assert.ok(parsed.layerNames.includes(c.layer), `expected circle layer "${c.layer}" to be declared in the LAYER table`);
  }

  const circleLayers = parsed.circles.map((c) => c.layer).sort();
  assert.deepEqual(circleLayers, ['STONES_CRYSTAL_AB', 'STONES_GOLD', 'STONES_WEIRD_ID_X'].sort());
  assert.equal(dxfLayerNameForColor('gold'), 'STONES_GOLD');
  assert.equal(dxfLayerNameForColor('Crystal AB'), 'STONES_CRYSTAL_AB');
  assert.equal(dxfLayerNameForColor('weird id/x'), 'STONES_WEIRD_ID_X');
});

await test('7. stoneLayoutToDxf() is deterministic', () => {
  const a = stoneLayoutToDxf(makeLayout(ASYMMETRIC_STONES), { widthMm: ASYMMETRIC_W, heightMm: ASYMMETRIC_H });
  const b = stoneLayoutToDxf(makeLayout(ASYMMETRIC_STONES), { widthMm: ASYMMETRIC_W, heightMm: ASYMMETRIC_H });
  assert.equal(a, b);
});

await test('8. stoneLayoutToDxf() throws a clear TypeError for invalid input', () => {
  const validLayout = makeLayout([{ xMm: 1, yMm: 1, sizeMm: 2, color: 'gold' }]);
  assert.throws(
    () => stoneLayoutToDxf(null, { widthMm: 10, heightMm: 10 }),
    { name: 'TypeError', message: 'stoneLayoutToDxf requires a StoneLayout (an object with a stones array).' }
  );
  assert.throws(
    () => stoneLayoutToDxf({}, { widthMm: 10, heightMm: 10 }),
    { name: 'TypeError', message: 'stoneLayoutToDxf requires a StoneLayout (an object with a stones array).' }
  );
  assert.throws(
    () => stoneLayoutToDxf(validLayout, { widthMm: 0, heightMm: 10 }),
    { name: 'TypeError', message: 'stoneLayoutToDxf requires a positive finite widthMm.' }
  );
  assert.throws(
    () => stoneLayoutToDxf(validLayout, { widthMm: 10, heightMm: NaN }),
    { name: 'TypeError', message: 'stoneLayoutToDxf requires a positive finite heightMm.' }
  );
});

await test('9. an empty stones array still produces a valid file: 0 circles, 1 CANVAS polyline', () => {
  const parsed = parseDxf(stoneLayoutToDxf(makeLayout([]), { widthMm: 50, heightMm: 30 }));
  assert.equal(parsed.circles.length, 0);
  assert.equal(parsed.polylines.filter((p) => p.layer === 'CANVAS').length, 1);
});

await test('10. DxfExporter.js has no GeometryEngine reference', () => {
  assert.ok(!/GeometryEngine/.test(dxfExporterSource), 'DxfExporter.js must not reference GeometryEngine');
});

await test('11. app.js wires #exportDXF like every other export handler; index.html exposes it in the Production geometry group', () => {
  assert.match(
    appJs,
    /el\('exportDXF'\)\.onclick=\(\)=>\{if\(!layout\)\{[^}]*return\}try\{/,
    'expected #exportDXF handler to guard on !layout before a try block'
  );

  const groupStart = indexHtml.indexOf('Production geometry');
  assert.ok(groupStart !== -1, 'expected to find the Production geometry export group in index.html');
  const groupEnd = indexHtml.indexOf('</div>', groupStart);
  const groupHtml = indexHtml.slice(groupStart, groupEnd);
  assert.ok(groupHtml.includes('id="exportDXF"'), 'expected #exportDXF inside the Production geometry export-group');
});

await test('12. real pipeline: examples/rectangle-only.rhs through GeometryEngine produces the expected DXF', async () => {
  async function buildPermanentEngine() {
    const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
    const fontManager = new FontManager(manifest);
    async function loadFontBufferFromRepoRoot(relativePath) {
      const buffer = await readFile(path.join(repoRoot, relativePath));
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
    return new GeometryEngine({ fontProviderRegistry });
  }

  const engine = await buildPermanentEngine();
  const raw = JSON.parse(await readFile(path.join(repoRoot, 'examples/rectangle-only.rhs'), 'utf8'));
  const project = validateRhsProject(raw, 'rectangle-only.rhs');
  const layout = await generateProjectStoneLayout(project, engine);

  const dxf = stoneLayoutToDxf(layout, { widthMm: project.canvas.width, heightMm: project.canvas.height });
  const parsed = parseDxf(dxf);

  assert.equal(parsed.circles.length, 158, 'expected 158 circles for examples/rectangle-only.rhs');

  const first = parsed.circles[0];
  assert.ok(Math.abs(first.x - 40) < 1e-9, 'expected first circle x to be 40');
  assert.ok(Math.abs(first.y - 70) < 1e-9, 'expected first circle y to be 70');
  assert.ok(Math.abs(first.r - 1) < 1e-9, 'expected first circle r to be 1');
  assert.equal(first.layer, 'STONES_EMERALD');

  for (let i = 0; i < layout.stones.length; i++) {
    const s = layout.stones[i];
    const c = parsed.circles[i];
    assert.ok(Math.abs(c.x - s.xMm) < 1e-9, `circle ${i} x mismatch`);
    assert.ok(Math.abs(c.y - (project.canvas.height - s.yMm)) < 1e-9, `circle ${i} y mismatch`);
    assert.ok(Math.abs(c.r - s.sizeMm / 2) < 1e-9, `circle ${i} r mismatch`);
  }
});

console.log('RS-3036 DXF exporter tests passed.');
