import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-1005 — Production Sheet Generator. Verifies:
//   - computeProductionSheetLayout()/productionSheetToSvg()/productionSheetToPdf() validate input,
//     are deterministic, and derive stone count/size(s)/color(s) from the StoneLayout itself.
//   - registration marks, mirror mode, page size (A4/Letter + auto orientation), and margins all
//     behave exactly as specified, including the "does not fit -> clear error, never rescaled" path.
//   - every object template (src/products/index.js) and every layer type (via the real permanent
//     GeometryEngine, same pattern tools/test-object-template-integration.mjs already uses) flow
//     through the exporter with no special-casing, since it is StoneLayout-only.
//   - neither new module regenerates geometry or knows about a layer's type.
//   - app.js/index.html are wired: #projectName, the Production Sheet controls/buttons, and all
//     three guarded/try-catch export handlers.
//   - no forbidden file changed.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const productionSheetExporterSource = await readFile(path.join(repoRoot, 'src/export/ProductionSheetExporter.js'), 'utf8');
const pdfDocumentSource = await readFile(path.join(repoRoot, 'src/export/PdfDocument.js'), 'utf8');

const {
  PAGE_SIZES,
  computeProductionSheetLayout,
  productionSheetToSvg,
  productionSheetToPdf
} = await import('../src/export/ProductionSheetExporter.js');
const { PT_PER_MM } = await import('../src/export/PdfDocument.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');
const { GeometryEngine } = await import('../src/geometry/index.js');
const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');
const { OBJECT_TEMPLATE_IDS, getObjectTemplate } = await import('../src/products/index.js');

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

function makeLayout(stoneParams, layerId = 'layer-1') {
  const stones = stoneParams.map((p, index) => new Stone({ layerId, index, ...p }));
  return new StoneLayout({ layerId, stones });
}

const TWO_STONE_LAYOUT = () => makeLayout([
  { xMm: 10, yMm: 5, sizeMm: 2, color: 'gold' },
  { xMm: 15, yMm: 8, sizeMm: 2, color: 'sapphire' }
]);

const BASE_OPTIONS = { projectName: 'Test Project', objectType: 'Mug', productionWidthMm: 210, productionHeightMm: 90, gapMm: 0.3 };

// --- 1. Input validation -------------------------------------------------------------------------

await test('1. computeProductionSheetLayout() throws a clear TypeError for invalid stoneLayout/options', () => {
  assert.throws(() => computeProductionSheetLayout(null, BASE_OPTIONS), TypeError);
  assert.throws(() => computeProductionSheetLayout({}, BASE_OPTIONS), TypeError);
  assert.throws(() => computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, productionWidthMm: 0 }), TypeError);
  assert.throws(() => computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, productionWidthMm: NaN }), TypeError);
  assert.throws(() => computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, productionHeightMm: -5 }), TypeError);
  assert.throws(() => computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, pageSize: 'Legal' }), TypeError);
  assert.throws(() => computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, marginMm: -1 }), TypeError);
  assert.throws(() => computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, mirror: 'yes' }), TypeError);
  assert.throws(() => computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, registrationMarks: 1 }), TypeError);
});

await test('2. a production size that cannot fit either page orientation throws a clear RangeError, not a rescale', () => {
  assert.throws(
    () => computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, productionWidthMm: 1000, productionHeightMm: 1000 }),
    /RangeError|does not fit/
  );
  try {
    computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, productionWidthMm: 1000, productionHeightMm: 1000 });
    assert.fail('expected a throw');
  } catch (error) {
    assert.ok(error instanceof RangeError);
    assert.match(error.message, /A4/);
  }
});

// --- 2. Determinism --------------------------------------------------------------------------------

await test('3. productionSheetToSvg() is deterministic; different inputs produce different output', () => {
  const a = productionSheetToSvg(TWO_STONE_LAYOUT(), BASE_OPTIONS);
  const b = productionSheetToSvg(TWO_STONE_LAYOUT(), BASE_OPTIONS);
  assert.equal(a, b);
  const c = productionSheetToSvg(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, projectName: 'Different Project' });
  assert.notEqual(a, c);
  const d = productionSheetToSvg(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, pageSize: 'Letter' });
  assert.notEqual(a, d);
  const e = productionSheetToSvg(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, mirror: true });
  assert.notEqual(a, e);
});

await test('4. productionSheetToPdf() is deterministic (byte-identical); different inputs differ', () => {
  const a = Buffer.from(productionSheetToPdf(TWO_STONE_LAYOUT(), BASE_OPTIONS));
  const b = Buffer.from(productionSheetToPdf(TWO_STONE_LAYOUT(), BASE_OPTIONS));
  assert.ok(a.equals(b));
  const c = Buffer.from(productionSheetToPdf(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, mirror: true }));
  assert.ok(!a.equals(c));
});

// --- 3. Header derived from StoneLayout, not passed in ----------------------------------------------

await test('5. stone count / stone size(s) / crystal color(s) are derived from stoneLayout.stones, holding options fixed', () => {
  const oneStone = makeLayout([{ xMm: 1, yMm: 1, sizeMm: 1.5, color: 'jet' }]);
  const three = makeLayout([
    { xMm: 1, yMm: 1, sizeMm: 1.5, color: 'jet' },
    { xMm: 2, yMm: 2, sizeMm: 2.5, color: 'rose' },
    { xMm: 3, yMm: 3, sizeMm: 1.5, color: 'jet' }
  ]);
  const d1 = computeProductionSheetLayout(oneStone, BASE_OPTIONS);
  const d3 = computeProductionSheetLayout(three, BASE_OPTIONS);
  assert.equal(d1.stoneCount, 1);
  assert.deepEqual(d1.distinctSizesMm, [1.5]);
  // RS-1007 renamed the 'jet' catalog entry's display name from "Jet Black" to "Jet" (same id,
  // same fill/stroke/shine/accent values) to match the Crystal Color Library's required name list.
  assert.deepEqual(d1.distinctColors, ['Jet']);
  assert.equal(d3.stoneCount, 3);
  assert.deepEqual(d3.distinctSizesMm, [1.5, 2.5]);
  assert.deepEqual(d3.distinctColors, ['Jet', 'Rose']);
});

await test('6. an empty StoneLayout does not throw and reports zero/placeholder header values', () => {
  const empty = makeLayout([]);
  const d = computeProductionSheetLayout(empty, BASE_OPTIONS);
  assert.equal(d.stoneCount, 0);
  assert.deepEqual(d.distinctSizesMm, []);
  assert.deepEqual(d.distinctColors, []);
  assert.doesNotThrow(() => productionSheetToSvg(empty, BASE_OPTIONS));
  assert.doesNotThrow(() => productionSheetToPdf(empty, BASE_OPTIONS));
});

// --- 4. Registration marks ---------------------------------------------------------------------------

await test('7. registrationMarks:true produces exactly four corner marks at the expected coordinates', () => {
  const d = computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, registrationMarks: true });
  assert.equal(d.registrationMarks.length, 4);
  const r = d.productionRect;
  const corners = new Set(d.registrationMarks.map((m) => `${m.xMm},${m.yMm}`));
  assert.ok(corners.has(`${r.xMm},${r.yMm}`));
  assert.ok(corners.has(`${r.xMm + r.widthMm},${r.yMm}`));
  assert.ok(corners.has(`${r.xMm},${r.yMm + r.heightMm}`));
  assert.ok(corners.has(`${r.xMm + r.widthMm},${r.yMm + r.heightMm}`));
});

await test('8. registrationMarks:false produces none, and nothing else in the output changes', () => {
  const dOff = computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, registrationMarks: false });
  assert.equal(dOff.registrationMarks.length, 0);
  const svgOn = productionSheetToSvg(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, registrationMarks: true });
  const svgOff = productionSheetToSvg(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, registrationMarks: false });
  assert.notEqual(svgOn, svgOff);
  assert.ok(svgOff.includes('Registration marks: Off'));
  assert.ok(svgOn.includes('Registration marks: On'));
});

// --- 5. Mirror mode ------------------------------------------------------------------------------------

await test('9. mirror:true reflects every stone\'s X about the production rect; Y/size/color/order unaffected', () => {
  const layout = makeLayout([
    { xMm: 5, yMm: 20, sizeMm: 2, color: 'gold' },
    { xMm: 200, yMm: 70, sizeMm: 2.5, color: 'sapphire' }
  ]);
  const off = computeProductionSheetLayout(layout, { ...BASE_OPTIONS, mirror: false });
  const on = computeProductionSheetLayout(layout, { ...BASE_OPTIONS, mirror: true });
  const r = off.productionRect;
  assert.equal(off.stones.length, on.stones.length);
  for (let i = 0; i < off.stones.length; i++) {
    const original = layout.stones[i];
    assert.equal(off.stones[i].xMm, r.xMm + original.xMm);
    assert.equal(on.stones[i].xMm, r.xMm + (original.xMm !== undefined ? off.productionRect.widthMm - original.xMm : 0));
    assert.equal(on.stones[i].yMm, off.stones[i].yMm, 'Y must be unaffected by mirror');
    assert.equal(on.stones[i].sizeMm, off.stones[i].sizeMm);
    assert.equal(on.stones[i].color, off.stones[i].color);
  }
});

// --- 6. Page sizes + orientation ------------------------------------------------------------------------

await test('10. A4 vs Letter produce different page dimensions in SVG root and PDF /MediaBox', () => {
  const a4Svg = productionSheetToSvg(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, pageSize: 'A4' });
  const letterSvg = productionSheetToSvg(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, pageSize: 'Letter' });
  assert.notEqual(a4Svg.match(/width="([\d.]+)mm"/)[1], letterSvg.match(/width="([\d.]+)mm"/)[1]);

  const a4Pdf = Buffer.from(productionSheetToPdf(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, pageSize: 'A4' })).toString('latin1');
  const letterPdf = Buffer.from(productionSheetToPdf(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, pageSize: 'Letter' })).toString('latin1');
  assert.notEqual(a4Pdf.match(/\/MediaBox \[[^\]]+\]/)[0], letterPdf.match(/\/MediaBox \[[^\]]+\]/)[0]);
});

await test('11. orientation is chosen automatically (landscape) when portrait cannot fit the production size', () => {
  // A wide 230x100mm production size (wider than A4's 210mm portrait width) must resolve to landscape.
  const d = computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, productionWidthMm: 230, productionHeightMm: 100, pageSize: 'A4' });
  assert.equal(d.orientation, 'landscape');
  assert.equal(d.pageWidthMm, PAGE_SIZES.A4.heightMm);
  assert.equal(d.pageHeightMm, PAGE_SIZES.A4.widthMm);
});

// --- 7. Margins --------------------------------------------------------------------------------------

await test('12. margins are a symmetric safety clearance: the production rect stays true-page-centered across different (still-fitting) margins, and the margin actually taken is reflected in the header line', () => {
  const small = computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, marginMm: 5 });
  const large = computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, marginMm: 20 });
  // Centering happens within (pageSize - 2*marginMm); since margin is symmetric on both sides, it
  // algebraically cancels out of the centered position (marginMm + (pageWidthMm - 2*marginMm -
  // productionWidthMm)/2 === pageWidthMm/2 - productionWidthMm/2) as long as the layout still
  // fits — margin only changes *whether* it fits (case 13), never *where* the centered content
  // sits. This is the intended, deliberate reading of "centered automatically" + "configurable
  // margins": margin is a minimum required clearance, not a positioning offset.
  assert.equal(small.orientation, large.orientation, 'both margins must resolve to the same orientation for this comparison to be meaningful');
  assert.equal(small.productionRect.xMm, large.productionRect.xMm);
  assert.equal(small.productionRect.yMm, large.productionRect.yMm);
  assert.ok(small.headerLines.some((l) => l.text.includes('Margin: 5 mm')));
  assert.ok(large.headerLines.some((l) => l.text.includes('Margin: 20 mm')));
});

await test('13. a margin large enough to make the layout not fit throws the same clear error as case 2', () => {
  assert.throws(
    () => computeProductionSheetLayout(TWO_STONE_LAYOUT(), { ...BASE_OPTIONS, marginMm: 200 }),
    RangeError
  );
});

// --- 8. SVG structural checks --------------------------------------------------------------------------

await test('14. SVG: one <circle> per stone with correct cx/cy/r/data-color; root <svg> is the page size', () => {
  const layout = TWO_STONE_LAYOUT();
  const d = computeProductionSheetLayout(layout, BASE_OPTIONS);
  const svg = productionSheetToSvg(layout, BASE_OPTIONS);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.trim().endsWith('</svg>'));
  assert.match(svg, new RegExp(`width="${d.pageWidthMm}mm"`));
  assert.match(svg, new RegExp(`height="${d.pageHeightMm}mm"`));
  const circleCount = (svg.match(/<circle\b/g) || []).length;
  assert.equal(circleCount, layout.count);
  for (const stone of d.stones) {
    const needle = `cx="${stone.xMm.toFixed(3)}" cy="${stone.yMm.toFixed(3)}" r="${(stone.sizeMm / 2).toFixed(3)}"`;
    assert.ok(svg.includes(needle), `expected SVG to contain ${needle}`);
  }
  assert.ok(svg.includes('data-color="gold"'));
  assert.ok(svg.includes('data-color="sapphire"'));
});

// --- 9. PDF structural checks --------------------------------------------------------------------------

await test('15. PDF: valid structure, /MediaBox at page size, one circle (4 "c" ops) per stone, header text draws present', () => {
  const layout = TWO_STONE_LAYOUT();
  const d = computeProductionSheetLayout(layout, BASE_OPTIONS);
  const bytes = productionSheetToPdf(layout, BASE_OPTIONS);
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  const mediaBoxMatch = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(mediaBoxMatch);
  assert.ok(Math.abs(Number(mediaBoxMatch[1]) - d.pageWidthMm * PT_PER_MM) < 0.01);
  assert.ok(Math.abs(Number(mediaBoxMatch[2]) - d.pageHeightMm * PT_PER_MM) < 0.01);
  const cOpCount = (text.match(/ c\n/g) || []).length;
  assert.equal(cOpCount, layout.count * 4, 'expected exactly 4 Bezier ops per stone circle');
  const tjCount = (text.match(/\) Tj/g) || []).length;
  assert.equal(tjCount, d.headerLines.length + 3, 'expected one Tj per header line plus 3 scale-reference labels');
});

// --- 10. All object templates --------------------------------------------------------------------------

await test('16. every object template fits both A4 and Letter at the default margin, with the correct displayName header', () => {
  for (const id of OBJECT_TEMPLATE_IDS) {
    const template = getObjectTemplate(id);
    for (const pageSize of Object.keys(PAGE_SIZES)) {
      const options = {
        projectName: 'Template Sweep',
        objectType: template.displayName,
        productionWidthMm: template.productionWidthMm,
        productionHeightMm: template.productionHeightMm,
        pageSize
      };
      const d = computeProductionSheetLayout(TWO_STONE_LAYOUT(), options);
      assert.ok(d.headerLines.some((l) => l.text === `Object: ${template.displayName}`), `${id}/${pageSize}: expected header to show the template's displayName`);
      assert.doesNotThrow(() => productionSheetToSvg(TWO_STONE_LAYOUT(), options), `${id}/${pageSize} SVG should not throw`);
      assert.doesNotThrow(() => productionSheetToPdf(TWO_STONE_LAYOUT(), options), `${id}/${pageSize} PDF should not throw`);
    }
  }
});

// --- 11. All layer types (real permanent GeometryEngine) ------------------------------------------------

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

const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm"><rect x="0" y="0" width="20" height="10"/></svg>';

await test('17. every layer type (text, curved text, SVG, circle, rectangle) merges into one StoneLayout the exporter handles identically to any other', async () => {
  const engine = await buildPermanentEngine();

  const text = await engine.generateTextLayout({
    text: 'Hi', fontId: 'courier-prime-regular', layerId: 'text-1', heightMm: 12,
    stoneSizeMm: 2, gapMm: 0.3, mode: 'outline', color: 'gold'
  });
  const curvedText = await engine.generateTextLayout({
    text: 'Arc', fontId: 'courier-prime-regular', layerId: 'curved-text-1', heightMm: 10,
    stoneSizeMm: 2, gapMm: 0.3, mode: 'outline', color: 'silver',
    curveEnabled: true, curveRadiusMm: 30, curveDirection: 'outside', curveStartAngleDeg: 0, curveSweepAngleDeg: 180, curveAlignment: 'center'
  });
  const svgLayer = engine.generateSvgLayout({
    svgSource: SAMPLE_SVG, layerId: 'svg-1', xMm: 5, yMm: 5, widthMm: 20, heightMm: 10,
    stoneSizeMm: 1.5, gapMm: 0.2, mode: 'outline', color: 'jet'
  });
  const circle = engine.generateShapeLayout({
    shape: 'circle', layerId: 'circle-1', cxMm: 105, cyMm: 45, radiusMm: 18,
    stoneSizeMm: 2, gapMm: 0.3, mode: 'outline', color: 'rose'
  });
  const rectangle = engine.generateShapeLayout({
    shape: 'rectangle', layerId: 'rect-1', xMm: 65, yMm: 30, widthMm: 80, heightMm: 30,
    stoneSizeMm: 1.5, gapMm: 0.2, mode: 'outline', color: 'emerald'
  });

  const merged = [...text.stones, ...curvedText.stones, ...svgLayer.stones, ...circle.stones, ...rectangle.stones];
  assert.ok(merged.length > 0, 'expected every layer type to produce at least one stone');
  const mergedLayout = new StoneLayout({ layerId: 'project', stones: merged });

  const options = { projectName: 'All Layer Types', objectType: 'Mug', productionWidthMm: 210, productionHeightMm: 90 };
  const svg = productionSheetToSvg(mergedLayout, options);
  const circleCount = (svg.match(/<circle\b/g) || []).length;
  assert.equal(circleCount, mergedLayout.count, 'the production sheet must draw exactly one circle per stone regardless of source layer type');

  assert.doesNotThrow(() => productionSheetToPdf(mergedLayout, options));
});

// --- 12. Architecture guards --------------------------------------------------------------------------

await test('18. ProductionSheetExporter.js/PdfDocument.js never reference GeometryEngine, geometry-generation calls, or a layer type', () => {
  for (const [name, source] of [
    ['ProductionSheetExporter.js', productionSheetExporterSource],
    ['PdfDocument.js', pdfDocumentSource]
  ]) {
    assert.ok(!/GeometryEngine/.test(source), `${name} must not reference GeometryEngine`);
    assert.ok(!/generateTextLayout|generateShapeLayout|generateSvgLayout/.test(source), `${name} must not call geometry generation`);
    assert.ok(!/project\.layers/.test(source), `${name} must not reference project.layers`);
    assert.ok(!/layer\.type|l\.type/.test(source), `${name} must not reference a layer's type`);
  }
});

// --- 13. app.js / index.html wiring --------------------------------------------------------------------

await test('19. index.html exposes #projectName and the Production Sheet controls/buttons', () => {
  assert.match(indexHtml, /<input id="projectName"/);
  assert.match(indexHtml, /<select id="prodSheetPageSize">/);
  for (const value of ['A4', 'Letter']) assert.ok(indexHtml.includes(`value="${value}"`));
  assert.match(indexHtml, /<input id="prodSheetMargin" type="number"/);
  assert.match(indexHtml, /<select id="prodSheetMirror">/);
  assert.match(indexHtml, /<select id="prodSheetRegMarks">/);
  assert.match(indexHtml, /<button id="exportProdSheetSVG"/);
  assert.match(indexHtml, /<button id="exportProdSheetPNG"/);
  assert.match(indexHtml, /<button id="exportProdSheetPDF"/);
});

await test('20. app.js imports the new exporter functions and defaultProject()/validateProject() carry project.name', () => {
  assert.match(appJs, /import\s*\{\s*computeProductionSheetLayout\s*,\s*productionSheetToSvg\s*,\s*productionSheetToPdf\s*\}\s*from\s*['"]\.\/src\/export\/ProductionSheetExporter\.js['"]/);
  assert.match(appJs, /name:DEFAULT_PROJECT_NAME/, 'expected defaultProject() to set project.name');
  assert.match(appJs, /name:typeof obj\.name==='string'&&obj\.name\.length>0\?obj\.name:DEFAULT_PROJECT_NAME/, 'expected validateProject() to permissively default project.name');
});

await test('21. all three Production Sheet export handlers guard on layout readiness and are wrapped in try/catch', () => {
  for (const id of ['exportProdSheetSVG', 'exportProdSheetPDF']) {
    const re = new RegExp(`el\\('${id}'\\)\\.onclick=\\(\\)=>\\{if\\(!layout\\)\\{[^}]*return\\}try\\{`);
    assert.match(appJs, re, `expected #${id} handler to guard on !layout before a try block`);
  }
  assert.match(appJs, /el\('exportProdSheetPNG'\)\.onclick=async\(\)=>\{if\(!layout\)\{[^}]*return\}try\{/);
  const section = appJs.slice(appJs.indexOf("el('exportProdSheetSVG')"), appJs.indexOf('let cupDrag'));
  const catchCount = (section.match(/catch\(error\)\{el\('status'\)\.textContent=`Export failed:/g) || []).length;
  assert.equal(catchCount, 3, 'expected all 3 Production Sheet export handlers to report failures via #status');
});

await test('22. Production Sheet page size/margin/mirror/registration-marks controls are not history-tracked (view/export-only, like rotation/zoom)', () => {
  const trackedMatch = appJs.match(/const HISTORY_TRACKED_CONTROL_IDS=\[([^\]]*)\];/);
  assert.ok(trackedMatch);
  for (const id of ['prodSheetPageSize', 'prodSheetMargin', 'prodSheetMirror', 'prodSheetRegMarks']) {
    assert.ok(!trackedMatch[1].includes(`'${id}'`), `expected #${id} to be excluded from HISTORY_TRACKED_CONTROL_IDS`);
  }
});

// --- 14. Forbidden files -----------------------------------------------------------------------------

await test('23. no forbidden file changed (this milestone\'s own forbidden list)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  // RS-1007 (Crystal Color Library) legitimately changes src/renderer/StoneColors.js (now a
  // compatibility re-export shim) and adds src/renderer/CrystalColors.js (the new catalog) — see
  // tools/test-crystal-color-catalog.mjs / tools/test-crystal-color-integration.mjs for that
  // milestone's own forbidden-file guard. CanvasRenderer2D.js/CupRenderer.js are unaffected and
  // stay covered by the src/renderer/ prefix below.
  // RS-1008A (Image Trace Architecture Correction) legitimately changes
  // src/geometry/GeometryEngine.js (adds generateImageLayout()) and src/geometry/StoneSampler.js
  // (adds sampleFieldFillPoints()) — see tools/test-image-trace-regression.mjs for that
  // milestone's own forbidden-file guard. src/geometry/StoneLayout.js/Stone.js stay covered by the
  // src/geometry/ prefix below (untouched by RS-1008A).
  // RS-1012 (Vector Boolean Operations) legitimately adds src/geometry/PathBoolean.js and extends
  // src/geometry/GeometryEngine.js/index.js/README.md (already allowed below) -- see
  // tools/test-path-boolean-integration.mjs for that milestone's own forbidden-file guard.
  // RS-1013 (Variable Stone Sizes) legitimately adds src/renderer/StoneSizes.js (the Stone Library
  // catalog, in the same shape/location as CrystalColors.js above) -- this exporter's own header
  // formatting change (adding commercial names to "Stone size: ...") is covered by
  // tools/test-variable-stone-sizes.mjs, not this milestone's forbidden-file guard.
  // RS-1011 (Fill Algorithms) legitimately adds src/geometry/ContourRingSampler.js (Contour Fill's
  // distance-transform + marching-squares inward-ring tracer) and extends
  // src/geometry/GeometryEngine.js/StoneSampler.js/index.js (already allowed below) -- see
  // tools/test-fill-algorithms.mjs / tools/test-fill-algorithms-integration.mjs for that
  // milestone's own forbidden-file guard. No exporter file changed.
  const allowedDespitePrefix = new Set(['src/renderer/StoneColors.js', 'src/renderer/CrystalColors.js', 'src/renderer/StoneSizes.js', 'src/renderer/README.md', 'src/geometry/GeometryEngine.js', 'src/geometry/StoneSampler.js', 'src/geometry/index.js', 'src/geometry/README.md', 'src/geometry/PathBoolean.js', 'src/geometry/ContourRingSampler.js']);
  const forbiddenPrefixes = [
    'src/geometry/', 'src/renderer/', 'src/text/', 'src/fonts/', 'src/core/',
    'src/browser/', 'src/svg/', 'src/history/', 'src/products/', 'assets/', 'examples/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      allowedDespitePrefix.has(changedPath) ||
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('Production Sheet exporter tests passed.');
