import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayValueToMm } from '../src/units/index.js';

// TXT-103 (Text Sizing Consistency) — audit found `l.height` was the one numeric field in
// writeSelectedControlsToLayer() that did NOT clamp to its own #height input's declared HTML
// min/max (every sibling field — shapeW/shapeH/shapeSides/lineSpacing/zoom/etc. — already does,
// see tools/test-ux-visual-polish.mjs test 3 for the zoom precedent this mirrors). A manually
// typed height below the legibility floor silently produced sparse/empty glyphs with no feedback.
// This is a pure UI-layer clamp: GeometryEngine/StoneLayout/project schema are untouched — the
// engine already regenerates safely at any heightMm (see docs/specifications/
// TXT-103A-TextSizingArchitectureAudit.md, §2).
//
// FONT-DECISION-001 (Studio Integration follow-up): the ceiling was raised from this milestone's
// original 80 to 111 -- the true max across every StoneSizes.js catalog entry's
// supportedHeightRangeMm (SS30's [106,111]) -- so that stone size's own auto-set midpoint (see
// tools/test-stone-size-library.mjs) is never clamped back down below its own valid range. The
// floor (4) is unchanged: it predates per-size validation and also covers custom/legacy stoneSize
// values outside the named catalog.

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

await test('1. index.html declares #height min="4" max="111"', () => {
  assert.match(indexHtml, /<input id="height" type="number" min="4" max="111" step="1" value="25">/);
});

await test('2. writeSelectedControlsToLayer() clamps l.height to [4,111], matching #height\'s declared bounds', () => {
  assert.match(
    appJs,
    /l\.height=Math\.max\(RAW_ENGINE_HEIGHT_MM_MIN,Math\.min\(RAW_ENGINE_HEIGHT_MM_MAX,readLengthField\('height'\)\|\|25\)\);/,
    'expected l.height to clamp with Math.max(RAW_ENGINE_HEIGHT_MM_MIN,Math.min(RAW_ENGINE_HEIGHT_MM_MAX,...)), mirroring every sibling numeric field in this function'
  );
});

// RAW_ENGINE_HEIGHT_MM_MIN/MAX below are literal stand-ins for the same-named constants defined
// in app.js (currently 4/111, see TXT-104 step 4a) -- they must be kept in sync with app.js's
// values so the extracted expression below runs with the same bounds it has in production.
const RAW_ENGINE_HEIGHT_MM_MIN = 4;
const RAW_ENGINE_HEIGHT_MM_MAX = 111;

function runHeightClamp(rawValue) {
  // Prove the exact clamp expression found in app.js above actually behaves as claimed, rather
  // than only asserting its source text is present.
  const clampMatch = appJs.match(/l\.height=(Math\.max\(RAW_ENGINE_HEIGHT_MM_MIN,Math\.min\(RAW_ENGINE_HEIGHT_MM_MAX,readLengthField\('height'\)\|\|25\)\));/);
  assert.ok(clampMatch, 'expected to find the l.height clamp expression to extract and execute');
  // RS-3019: the extracted expression now calls readLengthField('height') instead of raw
  // parseFloat(el('height').value) -- inject a local wrapper (matching app.js's own
  // readLengthField() formula) closed over the same `el` stub, fixed at 'mm' units so rawValue is
  // interpreted as a plain mm digit, exactly like this test's pre-RS-3019 parseFloat behavior.
  const el = () => ({ value: rawValue });
  function readLengthField(id) { return displayValueToMm(el(id).value, 'mm'); }
  const run = new Function(
    'el',
    'RAW_ENGINE_HEIGHT_MM_MIN',
    'RAW_ENGINE_HEIGHT_MM_MAX',
    'readLengthField',
    `return ${clampMatch[1]};`
  );
  return run(el, RAW_ENGINE_HEIGHT_MM_MIN, RAW_ENGINE_HEIGHT_MM_MAX, readLengthField);
}

await test('3. the height clamp raises a below-floor manual entry up to 4 (previously silently produced sparse/empty glyphs)', () => {
  assert.equal(runHeightClamp('0.5'), 4);
  assert.equal(runHeightClamp('-10'), 4);
});

await test('4. the height clamp caps an above-ceiling manual entry at 111', () => {
  assert.equal(runHeightClamp('999'), 111);
});

await test('5. the height clamp passes typical in-range values through unchanged', () => {
  assert.equal(runHeightClamp('25'), 25);
  assert.equal(runHeightClamp('4'), 4);
  assert.equal(runHeightClamp('111'), 111);
});

await test('6. the height clamp falls back to 25 (the pre-existing default) for a blank/invalid entry, then clamps that default too', () => {
  assert.equal(runHeightClamp(''), 25);
  assert.equal(runHeightClamp('not-a-number'), 25);
});

await test('7. the same clamp pattern is NOT applied to #gap or #stoneSize by this milestone (both remain unclamped, a pre-existing and separately scoped gap noted for a future milestone, not silently widened here)', () => {
  // MONO-006A wrapped this read in a nextGap local (to detect changes for authoredScale
  // invalidation, see invalidateAuthoredScaleForGeometryChange()) -- still no Math.max/min clamp.
  assert.match(appJs, /const nextGap=parseFloat\(el\('gap'\)\.value\)\|\|\.3;/, 'gap should remain unclamped — a shared field across all layer types, out of this text-only milestone\'s scope');
});

console.log('TXT-103 Text Sizing Consistency tests complete.');
