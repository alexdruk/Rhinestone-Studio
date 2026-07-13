/**
 * RS-2000 — MVP Stabilization performance measurement harness.
 *
 * Not part of `npm test` (it prints measured numbers for a human/spec-doc to read, the same
 * "generate baselines"/"measure" role tools/generate-example-baselines.mjs and
 * tools/measure-boolean-precision.mjs already play). Run with:
 *
 *   node tools/measure-performance.mjs
 *
 * Measures, against the REAL production code path at production-representative scale
 * (210x90mm mug-wrap canvas, 2mm/0.3mm stone spacing):
 *   1. Text/shape geometry generation time, per fill mode (outline/fill/staggered/radial/contour).
 *   2. Boolean operation time (Union/Subtract/Intersect/Exclude of two overlapping rectangles).
 *   3. SVG export time (stoneLayoutToSvg) at a representative stone count.
 *   4. Production Sheet PDF export time (productionSheetToPdf) at a representative stone count.
 *   5. Design Library operations (add/search/filter/sort) at ~500 items.
 *
 * Browser-only metrics (page startup, project import/reload round-trip, thumbnail generation in
 * the live DOM) are measured separately over CDP against a running instance — see the RS-2000
 * validation report (docs/specifications/RS-2000-MVPStabilizationValidation.md) for those results;
 * they are not reproduced here since this file must run standalone under plain Node with no DOM.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine, combineShapeSources } from '../src/geometry/index.js';
import { stoneLayoutToSvg } from '../src/export/SvgExporter.js';
import { productionSheetToPdf } from '../src/export/ProductionSheetExporter.js';
import { DesignLibrary } from '../src/library/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function polySource(polygons) { return { kind: 'polygons', polygons }; }
function rect(xMm, yMm, widthMm, heightMm) {
  return [{ xMm, yMm }, { xMm: xMm + widthMm, yMm }, { xMm: xMm + widthMm, yMm: yMm + heightMm }, { xMm, yMm: yMm + heightMm }];
}

function timeMs(fn) {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

async function timeMsAsync(fn) {
  const start = performance.now();
  await fn();
  return performance.now() - start;
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

function report(label, ms, extra = '') {
  console.log(`${label.padEnd(52)} ${ms.toFixed(2).padStart(9)} ms${extra ? '  ' + extra : ''}`);
}

async function main() {
  console.log('RS-2000 performance measurements\n' + '='.repeat(70));
  const engine = await buildEngine();

  console.log('\n-- Text geometry generation, per fill mode (18mm height, 2mm stone, 0.3mm gap) --');
  for (const mode of ['stroke', 'fill', 'staggered', 'radial', 'contour']) {
    let result;
    const ms = await timeMsAsync(async () => {
      result = await engine.generateTextLayout({
        text: 'Vitalina Serbin', fontId: 'courier-prime-regular', layerId: 'perf-text',
        heightMm: 18, stoneSizeMm: 2, gapMm: 0.3, mode: mode === 'stroke' ? 'outline' : mode, color: 'gold'
      });
    });
    report(`text mode=${mode}`, ms, `(${result.count} stones)`);
  }

  console.log('\n-- Shape (rectangle) geometry generation, per fill mode (150x60mm, 2mm stone, 0.3mm gap) --');
  for (const mode of ['outline', 'fill', 'staggered', 'radial', 'contour']) {
    let result;
    const ms = timeMs(() => {
      result = engine.generateShapeLayout({
        shape: 'rectangle', layerId: 'perf-rect', xMm: 30, yMm: 15, widthMm: 150, heightMm: 60,
        stoneSizeMm: 2, gapMm: 0.3, mode, color: 'gold'
      });
    });
    report(`rectangle mode=${mode}`, ms, `(${result.count} stones)`);
  }

  console.log('\n-- Boolean operations (two overlapping 60x60mm rectangles) --');
  const a = polySource([rect(0, 0, 60, 60)]);
  const b = polySource([rect(30, 30, 60, 60)]);
  for (const op of ['union', 'subtract', 'intersect', 'xor']) {
    let result;
    const ms = timeMs(() => { result = combineShapeSources(a, b, op); });
    report(`boolean op=${op}`, ms, `(${result.contours.length} contour(s))`);
  }

  console.log('\n-- Export --');
  const exportLayout = engine.generateShapeLayout({
    shape: 'rectangle', layerId: 'perf-export', xMm: 5, yMm: 5, widthMm: 200, heightMm: 80,
    stoneSizeMm: 2, gapMm: 0.3, mode: 'fill', color: 'gold'
  });
  const svgMs = timeMs(() => stoneLayoutToSvg(exportLayout, { widthMm: 210, heightMm: 90 }));
  report('SVG export (stoneLayoutToSvg)', svgMs, `(${exportLayout.count} stones)`);
  const pdfMs = timeMs(() => productionSheetToPdf(exportLayout, { productionWidthMm: 210, productionHeightMm: 90 }));
  report('Production Sheet PDF export', pdfMs, `(${exportLayout.count} stones)`);

  console.log('\n-- Design Library at ~500 items --');
  const lib = new DesignLibrary();
  const addMs = timeMs(() => {
    const kinds = ['text', 'circle', 'rectangle', 'svg', 'image', 'path'];
    for (let i = 0; i < 500; i++) {
      const type = kinds[i % kinds.length];
      lib.add({ kind: 'selection', name: `Design ${i}`, data: { canvas: { width: 210, height: 90 }, layers: [{ id: `l${i}`, type, x: 0, y: 0 }] } });
    }
  });
  report('add 500 items', addMs);
  const queryMs = timeMs(() => {
    const filtered = lib.filterByCategory(lib.search('Design 4'), 'All');
    lib.sortByName(filtered, 'asc');
  });
  report('search+filter+sort over 500 items', queryMs);

  console.log('\n' + '='.repeat(70));
  console.log('Done. See docs/specifications/RS-2000-MVPStabilizationValidation.md for browser-measured startup/load/thumbnail timings and analysis.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
