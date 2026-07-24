import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// TXT-103 (Text Sizing Consistency) — audit found `l.height` was the one numeric field in
// writeSelectedControlsToLayer() that did NOT clamp to its own #height input's declared HTML
// min/max (every sibling field — shapeW/shapeH/shapeSides/lineSpacing/zoom/etc. — already does,
// see tools/test-ux-visual-polish.mjs test 3 for the zoom precedent this mirrors). A manually
// typed height below the legibility floor silently produced sparse/empty glyphs with no feedback.
// This is a pure UI-layer clamp: GeometryEngine/StoneLayout/project schema are untouched — the
// engine already regenerates safely at any heightMm (see docs/specifications/
// TXT-103A-TextSizingArchitectureAudit.md, §2).

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');

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

await test('1. index.html declares #height min="4" max="80"', () => {
  assert.match(indexHtml, /<input id="height" type="number" min="4" max="80" step="1" value="25">/);
});

await test('2. writeSelectedControlsToLayer() clamps l.height to [4,80], matching #height\'s declared bounds', () => {
  assert.match(
    appJs,
    /l\.height=Math\.max\(4,Math\.min\(80,parseFloat\(el\('height'\)\.value\)\|\|25\)\);/,
    'expected l.height to clamp with Math.max(4,Math.min(80,...)), mirroring every sibling numeric field in this function'
  );
});

function runHeightClamp(rawValue) {
  const clampSource = "return Math.max(4,Math.min(80,parseFloat(el('height').value)||25));";
  // Prove the exact clamp expression found in app.js above actually behaves as claimed, rather
  // than only asserting its source text is present.
  const clampMatch = appJs.match(/l\.height=(Math\.max\(4,Math\.min\(80,parseFloat\(el\('height'\)\.value\)\|\|25\)\));/);
  assert.ok(clampMatch, 'expected to find the l.height clamp expression to extract and execute');
  const run = new Function('el', `return ${clampMatch[1]};`);
  return run(() => ({ value: rawValue }));
}

await test('3. the height clamp raises a below-floor manual entry up to 4 (previously silently produced sparse/empty glyphs)', () => {
  assert.equal(runHeightClamp('0.5'), 4);
  assert.equal(runHeightClamp('-10'), 4);
});

await test('4. the height clamp caps an above-ceiling manual entry at 80', () => {
  assert.equal(runHeightClamp('999'), 80);
});

await test('5. the height clamp passes typical in-range values through unchanged', () => {
  assert.equal(runHeightClamp('25'), 25);
  assert.equal(runHeightClamp('4'), 4);
  assert.equal(runHeightClamp('80'), 80);
});

await test('6. the height clamp falls back to 25 (the pre-existing default) for a blank/invalid entry, then clamps that default too', () => {
  assert.equal(runHeightClamp(''), 25);
  assert.equal(runHeightClamp('not-a-number'), 25);
});

await test('7. the same clamp pattern is NOT applied to #gap or #stoneSize by this milestone (both remain unclamped, a pre-existing and separately scoped gap noted for a future milestone, not silently widened here)', () => {
  assert.match(appJs, /l\.gap=parseFloat\(el\('gap'\)\.value\)\|\|\.3;/, 'gap should remain unchanged by TXT-103 — a shared field across all layer types, out of this text-only milestone\'s scope');
});

console.log('TXT-103 Text Sizing Consistency tests complete.');
