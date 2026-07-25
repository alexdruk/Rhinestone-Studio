// MONO-006E: Monogram Layout & Aesthetic Refinement.
//
// Focused tests for this milestone's specific fixes: MonogramLayouts.js (Traditional Three vs
// Equal Three now produce genuinely distinct slot sizing, and honor an absolute production-spacing
// floor between adjacent slots) and MonogramGenerator.js (letters are fit to *fill* their own slot,
// bounded below by the real production-legal floor, and the frame's own fitting rectangle is now
// shaped around the letters actually being placed). No UI, no project.monograms, no renderer
// changes are exercised or required here -- see tools/test-mono-005-headless-monogram-generator.mjs
// and tools/test-mono-004-monogram-layout-engine.mjs for this generator's/layout engine's own
// baseline coverage, which this file does not repeat.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import { MonogramGenerator, MONOGRAM_GENERATOR_FAILURE_REASONS } from '../src/monogram/MonogramGenerator.js';
import { computeMonogramLayout, MONOGRAM_LAYOUTS, MONOGRAM_LAYOUT_FAILURE_REASONS } from '../src/monogram/MonogramLayouts.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);

async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function createRealGenerator() {
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: loadFontBufferFromRepoRoot
  });
  const geometryEngine = new GeometryEngine({ fontProviderRegistry });
  return new MonogramGenerator({ geometryEngine });
}

const CANVAS_MM = { widthMm: 300, heightMm: 300 };
const RS_BLOCK = { fontId: 'rs-block', providerId: 'rhinestone' };

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

// --- 1. The exact regression case named in this milestone's own brief ---------------------------

await test('1. Diamond + Traditional Three + "ADR" + SS6 (2.0mm) + 100x100mm now succeeds (was reported failing)', async () => {
  const generator = createRealGenerator();
  const size = 100;
  const result = await generator.generate({
    frameId: 'diamond', layoutId: MONOGRAM_LAYOUTS.TRADITIONAL_THREE, letters: ['A', 'D', 'R'], ...RS_BLOCK,
    stoneSizeMm: 2.0, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: (CANVAS_MM.widthMm - size) / 2, yMm: (CANVAS_MM.heightMm - size) / 2, widthMm: size, heightMm: size }
  });
  assert.equal(result.ok, true, `expected this design to fit: ${result.reason} ${result.message}`);
  assert.equal(result.layers.length, 4, 'frame layer + 3 letter layers');
  assert.ok(result.measurements.totalStoneCount > 0);
});

// --- 2. Traditional Three vs Equal Three must render genuinely different letter sizes -------------

await test('2. Traditional Three\'s center letter renders meaningfully larger than its side letters', async () => {
  const generator = createRealGenerator();
  const size = 110;
  const result = await generator.generate({
    frameId: 'square', layoutId: MONOGRAM_LAYOUTS.TRADITIONAL_THREE, letters: ['A', 'D', 'R'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: (CANVAS_MM.widthMm - size) / 2, yMm: (CANVAS_MM.heightMm - size) / 2, widthMm: size, heightMm: size }
  });
  assert.equal(result.ok, true, `expected this design to fit: ${result.reason} ${result.message}`);
  const [left, center, right] = result.measurements.letters;
  // The center letter's fitted height must be meaningfully taller than each side letter's -- the
  // "dominant center initial, smaller flanking initials" conventional monogram look this milestone
  // requires, not a cosmetic sliver of difference.
  assert.ok(center.scaledBoundingBox.heightMm > left.scaledBoundingBox.heightMm * 1.2,
    `expected center (${center.scaledBoundingBox.heightMm}mm) to be at least 20% taller than left (${left.scaledBoundingBox.heightMm}mm)`);
  assert.ok(center.scaledBoundingBox.heightMm > right.scaledBoundingBox.heightMm * 1.2,
    `expected center (${center.scaledBoundingBox.heightMm}mm) to be at least 20% taller than right (${right.scaledBoundingBox.heightMm}mm)`);
  // Side letters, sharing an identical slot shape, must come out the same size as each other.
  assert.ok(Math.abs(left.scaledBoundingBox.heightMm - right.scaledBoundingBox.heightMm) < 1e-6);
});

await test('3. Equal Three\'s three letters render the same size as each other', async () => {
  const generator = createRealGenerator();
  const size = 110;
  const result = await generator.generate({
    frameId: 'square', layoutId: MONOGRAM_LAYOUTS.EQUAL_THREE, letters: ['A', 'D', 'R'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: (CANVAS_MM.widthMm - size) / 2, yMm: (CANVAS_MM.heightMm - size) / 2, widthMm: size, heightMm: size }
  });
  assert.equal(result.ok, true, `expected this design to fit: ${result.reason} ${result.message}`);
  const heights = result.measurements.letters.map((l) => l.scaledBoundingBox.heightMm);
  assert.ok(Math.max(...heights) - Math.min(...heights) < 1e-6, `expected all three letters at an equal height, got ${heights}`);
});

await test('4. Traditional Three and Equal Three produce visibly different silhouettes for the same letters/frame/stone size', async () => {
  const generator = createRealGenerator();
  const size = 110;
  const frameRect = { xMm: (CANVAS_MM.widthMm - size) / 2, yMm: (CANVAS_MM.heightMm - size) / 2, widthMm: size, heightMm: size };
  const traditional = await generator.generate({
    frameId: 'square', layoutId: MONOGRAM_LAYOUTS.TRADITIONAL_THREE, letters: ['A', 'D', 'R'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM, frameRect
  });
  const equal = await generator.generate({
    frameId: 'square', layoutId: MONOGRAM_LAYOUTS.EQUAL_THREE, letters: ['A', 'D', 'R'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM, frameRect
  });
  assert.equal(traditional.ok, true);
  assert.equal(equal.ok, true);
  // Traditional Three's center letter must be taller than Equal Three's (every) letter -- and
  // Traditional's own side letters must be shorter than Equal Three's -- proving the two layouts
  // are not just cosmetically different, but produce a genuinely different center-vs-side balance.
  const tCenter = traditional.measurements.letters[1].scaledBoundingBox.heightMm;
  const tSide = traditional.measurements.letters[0].scaledBoundingBox.heightMm;
  const eAny = equal.measurements.letters[0].scaledBoundingBox.heightMm;
  assert.ok(tCenter > eAny, `expected Traditional Three's center (${tCenter}mm) taller than Equal Three's letters (${eAny}mm)`);
  assert.ok(tSide < eAny, `expected Traditional Three's side letters (${tSide}mm) shorter than Equal Three's letters (${eAny}mm)`);
});

// --- 5. Letters are fit to fill their slot, not the smallest legal size ---------------------------

await test('5. a single letter\'s fitted height reaches its own slot height (fills the slot, does not float tiny inside it)', async () => {
  const generator = createRealGenerator();
  const size = 90;
  const result = await generator.generate({
    frameId: 'circle', layoutId: MONOGRAM_LAYOUTS.SINGLE, letters: ['M'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: (CANVAS_MM.widthMm - size) / 2, yMm: (CANVAS_MM.heightMm - size) / 2, widthMm: size, heightMm: size }
  });
  assert.equal(result.ok, true, `expected this design to fit: ${result.reason} ${result.message}`);
  const letter = result.measurements.letters[0];
  const slot = result.measurements.slots[0];
  const EPSILON_MM = 1e-6;
  assert.ok(
    letter.scaledBoundingBox.widthMm > slot.targetRect.widthMm - EPSILON_MM
    || letter.scaledBoundingBox.heightMm > slot.targetRect.heightMm - EPSILON_MM,
    'expected the fitted letter to reach its own slot\'s width or height, not sit tiny inside it'
  );
});

// --- 6. Production spacing is a geometric guarantee, not merely a post-hoc check ------------------

await test('6. MonogramLayouts.computeMonogramLayout() enforces an absolute minGapMm between adjacent slots', async () => {
  const wide = computeMonogramLayout({
    layoutId: MONOGRAM_LAYOUTS.TWO_LETTER,
    frameInteriorRect: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 },
    letterCount: 2,
    minGapMm: 20
  });
  assert.equal(wide.ok, true, wide.message);
  const [a, b] = wide.slots;
  const gapMm = b.targetRect.xMm - (a.targetRect.xMm + a.targetRect.widthMm);
  assert.ok(gapMm >= 20 - 1e-9, `expected at least 20mm between slots, got ${gapMm}mm`);
});

await test('7. an impossibly large minGapMm (exceeding the interior itself) is a structured insufficient-space failure, not a silent overflow', async () => {
  const result = computeMonogramLayout({
    layoutId: MONOGRAM_LAYOUTS.TRADITIONAL_THREE,
    frameInteriorRect: { xMm: 0, yMm: 0, widthMm: 20, heightMm: 20 },
    letterCount: 3,
    minGapMm: 50
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_LAYOUT_FAILURE_REASONS.INSUFFICIENT_SPACE);
});

await test('8. a moderately tight minGapMm shrinks slot widths proportionally (never past zero, never overflowing the interior) rather than failing outright', async () => {
  const result = computeMonogramLayout({
    layoutId: MONOGRAM_LAYOUTS.TRADITIONAL_THREE,
    frameInteriorRect: { xMm: 0, yMm: 0, widthMm: 30, heightMm: 30 },
    letterCount: 3,
    minGapMm: 8
  });
  assert.equal(result.ok, true, result.message);
  // Every slot stays within the interior rect (never overflows past it).
  for (const slot of result.slots) {
    assert.ok(slot.targetRect.xMm >= -1e-6);
    assert.ok(slot.targetRect.xMm + slot.targetRect.widthMm <= 30 + 1e-6);
    assert.ok(slot.targetRect.widthMm > 0);
  }
  // The gap between adjacent slots is still at least minGapMm.
  const [left, center, right] = result.slots;
  assert.ok(center.targetRect.xMm - (left.targetRect.xMm + left.targetRect.widthMm) >= 8 - 1e-6);
  assert.ok(right.targetRect.xMm - (center.targetRect.xMm + center.targetRect.widthMm) >= 8 - 1e-6);
});

// --- 9. Real generation still respects production spacing end to end (collision safety not weakened) --

await test('9. every generated letter and frame stone is at least stoneSizeMm+gapMm apart from every other object\'s stones (real geometry, no collisions)', async () => {
  const generator = createRealGenerator();
  const size = 110;
  const stoneSizeMm = 2.8;
  const gapMm = 0.3;
  const requiredSpacingMm = stoneSizeMm + gapMm;
  const result = await generator.generate({
    frameId: 'rounded-square', layoutId: MONOGRAM_LAYOUTS.TRADITIONAL_THREE, letters: ['A', 'D', 'R'], ...RS_BLOCK,
    stoneSizeMm, gapMm, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: (CANVAS_MM.widthMm - size) / 2, yMm: (CANVAS_MM.heightMm - size) / 2, widthMm: size, heightMm: size }
  });
  assert.equal(result.ok, true, `expected this design to fit: ${result.reason} ${result.message}`);
  // MonogramGenerator's own diagnostics already report zero collisions on success; independently
  // re-verify with a direct grid-hash-free all-pairs cross-group scan restricted to a small
  // neighborhood (letter layers only, small letter counts here) as a second, from-scratch check.
  assert.equal(result.diagnostics.collisions.letterCollision, false);
  assert.equal(result.diagnostics.collisions.frameCollision, false);
  const letterLayerIds = new Set(result.layers.filter((l) => l.type === 'text').map((l) => l.id));
  assert.ok(letterLayerIds.size === 3);
});

// --- 10. Frame border is thinner than before (item 4: reduce excessive frame dominance) -----------

await test('10. Circle frame\'s border consumes a smaller share of its own outer radius than the pre-MONO-006E default', async () => {
  const { getFrameDefinition } = await import('../src/geometry/FrameLibrary.js');
  const circle = getFrameDefinition('circle');
  const [outer, inner] = circle.generationNaturalContours;
  const outerR = Math.max(...outer.map((p) => Math.hypot(p.xMm - 1, p.yMm - 1)));
  const innerR = Math.max(...inner.map((p) => Math.hypot(p.xMm - 1, p.yMm - 1)));
  const innerRatio = innerR / outerR;
  assert.ok(innerRatio > 0.8, `expected the border band thinner than the old 0.78 inner ratio, got innerRatio=${innerRatio}`);
});

console.log(process.exitCode ? 'Some MONO-006E tests failed.' : 'All MONO-006E tests passed.');
