import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-2001 — permanent performance benchmark over every Gallery catalog fixture. Every Gallery
// project doubles as a regression fixture (tools/test-examples-regression.mjs) AND a benchmark
// project: this suite times geometry generation, SVG export, and Production Sheet (SVG + PDF)
// generation for each one, asserting success plus a generous sanity ceiling (to catch a
// catastrophic performance regression, not to pin exact numbers -- wall-clock time is
// machine-dependent, so this is intentionally not a tight assertion). Actual observed numbers are
// reported in TASK_RESULT.md, not committed as a baseline here.
//
// Thumbnail generation and PNG export need a real <canvas> (no bundled canvas implementation in
// Node) and are therefore benchmarked only during the manual browser verification pass, per the
// same constraint documented in tools/lib/rhsProject.mjs / tools/generate-example-baselines.mjs.
// Fixtures with an 'image' layer are skipped here for the same reason
// tools/test-examples-regression.mjs's checks 7-14 skip them (documented, not silently skipped;
// see check 18 there) -- decoding requires a real browser image decoder, which this suite (part of
// `npm test`) must not depend on.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const examplesDir = path.join(repoRoot, 'examples');

const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');
const { GeometryEngine } = await import('../src/geometry/index.js');
const { stoneLayoutToSvg } = await import('../src/export/SvgExporter.js');
const { computeProductionSheetLayout, productionSheetToSvg, productionSheetToPdf } = await import('../src/export/ProductionSheetExporter.js');
const { validateRhsProject, generateProjectStoneLayout, parseCatalog } = await import('../src/gallery/index.js');

const SANITY_CEILING_MS = 5000;

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

async function buildEngine() {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  async function loadFontBufferFromRepoRoot(relativePath) {
    const buffer = await readFile(path.join(repoRoot, relativePath));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
  return new GeometryEngine({ fontProviderRegistry });
}

const manifest = JSON.parse(await readFile(path.join(examplesDir, 'manifest.json'), 'utf8'));
const baselines = JSON.parse(await readFile(path.join(examplesDir, 'baselines.json'), 'utf8'));
const galleryMeta = JSON.parse(await readFile(path.join(examplesDir, 'gallery.json'), 'utf8'));
const fixtures = {};
for (const item of galleryMeta.items) {
  fixtures[item.file] = JSON.parse(await readFile(path.join(examplesDir, item.file), 'utf8'));
}
const catalog = parseCatalog({ manifest, baselines, galleryMeta, fixtures });
const engine = await buildEngine();

const results = [];

await test('benchmark every non-image Gallery fixture: geometry generation, SVG export, Production Sheet SVG+PDF', async () => {
  for (const entry of catalog) {
    const fixture = fixtures[entry.file];
    const hasImageLayer = fixture.layers.some((l) => l.type === 'image');
    if (hasImageLayer) {
      results.push({ file: entry.file, skipped: true });
      continue;
    }

    const rhsProject = validateRhsProject(fixture, entry.file);

    const t0 = performance.now();
    const stoneLayout = await generateProjectStoneLayout(rhsProject, engine);
    const geometryMs = performance.now() - t0;
    assert.equal(stoneLayout.count, entry.stoneCount, `${entry.file}: benchmark-time stoneCount must match the committed baseline`);
    assert.ok(geometryMs < SANITY_CEILING_MS, `${entry.file}: geometry generation took ${geometryMs.toFixed(1)}ms, exceeding the ${SANITY_CEILING_MS}ms sanity ceiling`);

    const t1 = performance.now();
    const svg = stoneLayoutToSvg(stoneLayout, { widthMm: rhsProject.canvas.width, heightMm: rhsProject.canvas.height });
    const svgExportMs = performance.now() - t1;
    assert.ok(typeof svg === 'string' && svg.length > 0);
    assert.ok(svgExportMs < SANITY_CEILING_MS, `${entry.file}: SVG export took ${svgExportMs.toFixed(1)}ms, exceeding the ${SANITY_CEILING_MS}ms sanity ceiling`);

    const prodSheetOptions = { projectName: entry.title, objectType: entry.objectType, productionWidthMm: rhsProject.canvas.width, productionHeightMm: rhsProject.canvas.height, gapMm: 0.3 };
    const t2 = performance.now();
    computeProductionSheetLayout(stoneLayout, prodSheetOptions);
    const prodSheetSvg = productionSheetToSvg(stoneLayout, prodSheetOptions);
    const prodSheetSvgMs = performance.now() - t2;
    assert.ok(typeof prodSheetSvg === 'string' && prodSheetSvg.length > 0);
    assert.ok(prodSheetSvgMs < SANITY_CEILING_MS, `${entry.file}: Production Sheet SVG generation took ${prodSheetSvgMs.toFixed(1)}ms, exceeding the ${SANITY_CEILING_MS}ms sanity ceiling`);

    const t3 = performance.now();
    const prodSheetPdf = productionSheetToPdf(stoneLayout, prodSheetOptions);
    const prodSheetPdfMs = performance.now() - t3;
    assert.ok(prodSheetPdf && prodSheetPdf.byteLength > 0);
    assert.ok(prodSheetPdfMs < SANITY_CEILING_MS, `${entry.file}: Production Sheet PDF generation took ${prodSheetPdfMs.toFixed(1)}ms, exceeding the ${SANITY_CEILING_MS}ms sanity ceiling`);

    results.push({
      file: entry.file,
      stoneCount: entry.stoneCount,
      geometryMs: Number(geometryMs.toFixed(2)),
      svgExportMs: Number(svgExportMs.toFixed(2)),
      prodSheetSvgMs: Number(prodSheetSvgMs.toFixed(2)),
      prodSheetPdfMs: Number(prodSheetPdfMs.toFixed(2))
    });
  }
});

await test('the Large Projects flagship (highest stoneCount) was actually benchmarked, not skipped', () => {
  const largest = [...catalog].sort((a, b) => b.stoneCount - a.stoneCount)[0];
  const measured = results.find((r) => r.file === largest.file);
  assert.ok(measured && !measured.skipped, `expected the flagship benchmark fixture (${largest.file}, ${largest.stoneCount} stones) to be measured, not skipped`);
});

console.log('\nGallery benchmark results (Node, this machine):');
console.table(results);
console.log('Gallery benchmark suite passed.');
