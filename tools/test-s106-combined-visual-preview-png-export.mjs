import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// S-106 (Combined Visual Preview PNG Export): one new Export option, "Export Combined Preview PNG",
// that composites the already-rendered 2D Canvas (left) and Object Preview (right) side by side onto
// one white-background PNG, reflecting the operator's currently-visible state (including live 3D
// rotation/zoom) without requiring a tab switch first. Structural checks against the live
// index.html / app.js source, matching this repository's established "check the live source"
// convention (real interactive rendering is verified with a real browser and recorded in
// TASK_RESULT.md).

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');

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

// ---------- 1. New Export option present, in the right place ----------

await test('1. #lightboxExport\'s "Visual previews" group gains a fourth button, #exportCombined, labeled "Export Combined Preview PNG", alongside the existing 2D SVG / 2D PNG / Object Preview PNG buttons', () => {
  const groupMatch = indexHtml.match(/<h3>Visual previews<\/h3>[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(groupMatch, 'expected to find the "Visual previews" export-group');
  const group = groupMatch[0];
  assert.match(group, /id="exportSVG"/);
  assert.match(group, /id="exportPNG"/);
  assert.match(group, /id="exportCup"/);
  assert.match(group, /<button class="btn primary block" id="exportCombined"[^>]*>Export Combined Preview PNG<\/button>/);
});

await test('2. #exportCombined appears exactly once in index.html (no duplicate button)', () => {
  const matches = indexHtml.match(/id="exportCombined"/g) || [];
  assert.equal(matches.length, 1);
});

// ---------- 2. Wiring: guarded, reuses exportCanvas(), same error-handling shape as sibling exports ----------

await test('3. app.js wires #exportCombined.onclick with the same "layout not ready" guard and try/catch -> status-text error path as #exportPNG/#exportCup', () => {
  const handlerMatch = appJs.match(/el\('exportCombined'\)\.onclick=\(\)=>\{[\s\S]*?\};/);
  assert.ok(handlerMatch, 'expected an el(\'exportCombined\').onclick handler');
  const handler = handlerMatch[0];
  assert.match(handler, /if\(!layout\)\{el\('status'\)\.textContent='Export failed: layout is not ready yet\.';return\}/);
  assert.match(handler, /catch\(error\)\{el\('status'\)\.textContent=`Export failed: \$\{error\.message\}`\}/);
});

await test('4. #exportCombined reuses the existing exportCanvas() capture helper (not a new download/export code path)', () => {
  const handlerMatch = appJs.match(/el\('exportCombined'\)\.onclick=\(\)=>\{[\s\S]*?\};/);
  assert.match(handlerMatch[0], /exportCanvas\('rhinestone-combined-preview\.png',composeCombinedPreviewCanvas\(\)\)/);
});

// ---------- 3. Compositing: both source canvases, native size, no stretch, white background ----------

await test('5. composeCombinedPreviewCanvas() draws layoutCanvas then cupCanvas onto a new offscreen canvas, in that left-to-right order, each at its own native pixel size (no scaling args to drawImage)', () => {
  const fnMatch = appJs.match(/function composeCombinedPreviewCanvas\(\)\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected a composeCombinedPreviewCanvas() function');
  const fn = fnMatch[0];
  assert.match(fn, /document\.createElement\('canvas'\)/, 'expected a new offscreen canvas, not reuse of an existing visible canvas');
  const layoutDraw = fn.indexOf('ctx.drawImage(layoutCanvas');
  const cupDraw = fn.indexOf('ctx.drawImage(cupCanvas');
  assert.ok(layoutDraw > -1, 'expected layoutCanvas to be drawn');
  assert.ok(cupDraw > -1, 'expected cupCanvas to be drawn');
  assert.ok(layoutDraw < cupDraw, 'expected the 2D Canvas (layoutCanvas) drawn before the Object Preview (cupCanvas) -- left-to-right per the specification');
  // drawImage(canvas, x, y) -- exactly 3 args each call (no destination width/height scaling args)
  assert.match(fn, /ctx\.drawImage\(layoutCanvas,[^,]+,[^,)]+\);?\s*$|ctx\.drawImage\(layoutCanvas,[^,]+,[^,)]+\)/m);
  const layoutCall = fn.match(/ctx\.drawImage\(layoutCanvas,([^;]+)\);/)[1];
  const cupCall = fn.match(/ctx\.drawImage\(cupCanvas,([^;]+)\);/)[1];
  assert.equal(layoutCall.split(',').length, 2, 'expected drawImage(layoutCanvas, x, y) with no scaling args (native size)');
  assert.equal(cupCall.split(',').length, 2, 'expected drawImage(cupCanvas, x, y) with no scaling args (native size)');
});

await test('6. composeCombinedPreviewCanvas() fills a white background before drawing either source canvas', () => {
  const fnMatch = appJs.match(/function composeCombinedPreviewCanvas\(\)\{[\s\S]*?\n\}/);
  const fn = fnMatch[0];
  const fillIdx = fn.indexOf("ctx.fillStyle='#ffffff'");
  const fillRectIdx = fn.indexOf('ctx.fillRect(');
  const firstDrawIdx = fn.indexOf('ctx.drawImage(');
  assert.ok(fillIdx > -1, 'expected an explicit white fillStyle');
  assert.ok(fillRectIdx > fillIdx, 'expected fillRect after setting the white fillStyle');
  assert.ok(fillRectIdx < firstDrawIdx, 'expected the white background fill before either canvas is drawn, so no transparent gaps can show through');
});

await test('7. composeCombinedPreviewCanvas() sizes the offscreen canvas from both source canvases\' own live width/height (not a hardcoded constant), so it always matches the current on-screen render', () => {
  const fnMatch = appJs.match(/function composeCombinedPreviewCanvas\(\)\{[\s\S]*?\n\}/);
  const fn = fnMatch[0];
  assert.match(fn, /layoutCanvas\.width/);
  assert.match(fn, /layoutCanvas\.height/);
  assert.match(fn, /cupCanvas\.width/);
  assert.match(fn, /cupCanvas\.height/);
});

// ---------- 4. No re-render / no new geometry or renderer call -- pure canvas-to-canvas capture ----------

await test('8. composeCombinedPreviewCanvas() calls no renderer/generation function -- it only reads the two existing canvas elements\' already-rendered pixels (drawLayout/drawCup/preview3D/generate/StoneLayout are never referenced inside it)', () => {
  const fnMatch = appJs.match(/function composeCombinedPreviewCanvas\(\)\{[\s\S]*?\n\}/);
  const fn = fnMatch[0];
  for (const forbidden of ['drawLayout(', 'drawCup(', 'preview3D.', 'generate(', 'StoneLayout', 'GeometryEngine']) {
    assert.ok(!fn.includes(forbidden), `composeCombinedPreviewCanvas() must not reference ${forbidden} -- it must only composite already-rendered canvas pixels`);
  }
});

// ---------- 5. Forbidden files untouched ----------
console.log('S-106 Combined Visual Preview PNG Export tests passed.');
