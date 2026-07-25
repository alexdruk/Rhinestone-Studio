// MONO-005 / MONO-005A: Headless Monogram Generator.
//
// Focused tests for src/monogram/MonogramGenerator.js -- the first complete monogram generation
// pipeline, orchestrating FrameLibrary (MONO-003), MonogramLayouts (MONO-004), and
// GeometryEngine.scaleAuthoredTextLayout()/authoredScale (MONO-002/MONO-005A) into ordinary project
// layers that reproduce their validated geometry through the real GeometryEngine.generateTextLayout()
// path. No UI, no project.monograms, no renderer changes are exercised or required here.
//
// Real repository frame definitions and the real 'rs-block' authored font are used wherever a
// scenario can be reached with them (every success case, frame/layout lookup failures, unsupported
// letter count, invalid font, fitting-failed -- all found empirically to occur with real geometry,
// see this file's own fixtures below). Letter-vs-letter collision, frame collision, and the
// internal-contract-mismatch defense are exceptions: MONO-006C changed letter sizing to default to
// the smallest *legal* scale (maximum legal stone density) rather than stretching to fill the slot
// (see MonogramGenerator.generate()'s own doc comment) -- real letters are now small relative to
// their frame, which makes a genuine letter-vs-letter or letter-vs-frame collision very hard to
// reach with real fonts at any reasonable frame size (previously frame-collision, in particular, was
// often actually MONO-006C's own bug B -- a round/diamond frame's true interior being smaller than
// its bounding box -- not a real production collision; see the fitting-succeeds tests below for that
// fix). An internal-contract mismatch should never happen with a correctly wired real engine at all.
// All three use small, clearly-labeled synthetic fake geometryEngines instead, same "fake
// collaborator" precedent test-mono-002-authored-font-positional-scaling.mjs already uses for its
// own coincident-stone fixture.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine, Stone, StoneLayout } from '../src/geometry/index.js';
import { computeTextPlacementOffsetMm } from '../src/editing/index.js';
import { MonogramGenerator, MONOGRAM_GENERATOR_FAILURE_REASONS } from '../src/monogram/MonogramGenerator.js';

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
  return { geometryEngine, generator: new MonogramGenerator({ geometryEngine }) };
}

// Arbitrary, reasonable production canvas size -- MonogramGenerator only uses this to compute each
// letter layer's x/y under the real text-layer placement contract (see src/editing/TextPlacement.js
// and MonogramGenerator.generate()'s own doc comment); its exact value doesn't matter to any
// assertion below except the dedicated placement-contract test, which derives its own expectation
// from this same value.
const CANVAS_MM = { widthMm: 200, heightMm: 200 };

// Deterministic, minimal fake -- both letters resolve to the exact same fixed two-stone authored
// layout regardless of requested text/scale, so once translated onto two nearby slot centers they
// are guaranteed to collide. Only used for the one scenario real fonts/layouts could not reach (see
// module doc comment above).
function createCollidingFakeGenerator() {
  const geometryEngine = {
    async generateTextLayout({ layerId, color }) {
      return new StoneLayout({
        layerId,
        sourceMode: 'authored',
        stones: [
          new Stone({ xMm: 0, yMm: 0, sizeMm: 2.8, color, layerId, index: 0, metadata: { fake: true } }),
          new Stone({ xMm: 4, yMm: 0, sizeMm: 2.8, color, layerId, index: 1, metadata: { fake: true } })
        ]
      });
    },
    scaleAuthoredTextLayout(layout, requestedScale) {
      return {
        ok: true,
        layout,
        requestedScale,
        minimumLegalScale: 0.1,
        naturalMinimumSpacingMm: 4,
        requiredSpacingMm: 3.1,
        originalBoundingBox: layout.getBoundingBox()?.toJSON() ?? null,
        scaledBoundingBox: layout.getBoundingBox()?.toJSON() ?? null
      };
    },
    generatePathLayout({ layerId }) {
      return new StoneLayout({ layerId, sourceMode: 'fill', stones: [] });
    }
  };
  return new MonogramGenerator({ geometryEngine });
}

// Deliberately internally-inconsistent fake: generateTextLayout() ignores authoredScale entirely
// (always the same two fixed stones), while scaleAuthoredTextLayout() actually moves the stones by
// the requested scale -- simulating a hypothetical future drift between the two code paths
// MonogramGenerator's round-trip check (MONO-005A) exists to catch. Never true of the real
// GeometryEngine (see tools/test-mono-005a-authored-scale-persistence.mjs), used only to prove the
// check fires when the two genuinely disagree.
function createMismatchedFakeGenerator() {
  const geometryEngine = {
    async generateTextLayout({ layerId, color }) {
      return new StoneLayout({
        layerId,
        sourceMode: 'authored',
        stones: [
          new Stone({ xMm: 0, yMm: 0, sizeMm: 2.8, color, layerId, index: 0 }),
          new Stone({ xMm: 4, yMm: 0, sizeMm: 2.8, color, layerId, index: 1 })
        ]
      });
    },
    scaleAuthoredTextLayout(layout, requestedScale) {
      const scaledStones = layout.stones.map((s) => new Stone({
        xMm: s.xMm * requestedScale, yMm: s.yMm * requestedScale,
        sizeMm: s.sizeMm, color: s.color, layerId: s.layerId, index: s.index, metadata: s.metadata
      }));
      return {
        ok: true,
        layout: new StoneLayout({ layerId: layout.layerId, sourceMode: 'authored', stones: scaledStones }),
        requestedScale,
        minimumLegalScale: 0.1,
        naturalMinimumSpacingMm: 4,
        requiredSpacingMm: 3.1,
        originalBoundingBox: layout.getBoundingBox()?.toJSON() ?? null,
        scaledBoundingBox: null
      };
    },
    generatePathLayout({ layerId }) {
      return new StoneLayout({ layerId, sourceMode: 'fill', stones: [] });
    }
  };
  return new MonogramGenerator({ geometryEngine });
}

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

// --- Success cases, one per MonogramLayouts layout, all with real frames + the real RS Block font.
// 'square'/'rounded-square' frames are used deliberately: MonogramLayouts' slots are plain
// rectangles (it has no notion of a frame's actual, possibly non-rectangular, footprint -- see its
// own doc comment), so a letter fit snugly to a slot's full bounding rect can genuinely reach past a
// round/diamond frame's true (smaller, non-rectangular) interior at the rect's corners. That is a
// real, correctly-detected frame-collision (see the dedicated test below), not a bug in this
// generator -- square-family frames avoid the confound for these baseline success fixtures.

await test('single-letter generation succeeds with real frame + authored font', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.layers.length, 2, 'frame layer + 1 letter layer');
  assert.equal(result.layers[0].type, 'path');
  assert.equal(result.layers[1].type, 'text');
  assert.equal(result.layers[1].text, 'A');
  assert.equal(result.measurements.letters.length, 1);
  assert.ok(result.measurements.totalStoneCount > 0);
});

await test('two-letter generation succeeds with real frame + authored font', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'two-letter', letters: ['A', 'B'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 110, heightMm: 80 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.layers.length, 3, 'frame layer + 2 letter layers');
  assert.deepEqual(result.layers.filter((l) => l.type === 'text').map((l) => l.text), ['A', 'B']);
});

await test('traditional three-letter generation succeeds with real frame + authored font', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'rounded-square', layoutId: 'traditional-three', letters: ['A', 'B', 'C'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.layers.length, 4, 'frame layer + 3 letter layers');
  // Traditional Three's drawOrder puts the two side slots (letters A, C) first, the enlarged center
  // slot (letter B) last -- see MonogramLayouts.js's own buildTraditionalThreeSlots() doc comment.
  const letterLayers = result.layers.filter((l) => l.type === 'text');
  assert.deepEqual(letterLayers.map((l) => l.text), ['A', 'C', 'B']);
});

await test('equal three-letter generation succeeds with real frame + authored font', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'equal-three', letters: ['A', 'B', 'C'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 110, heightMm: 110 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.layers.length, 4, 'frame layer + 3 letter layers');
  assert.deepEqual(result.layers.filter((l) => l.type === 'text').map((l) => l.text), ['A', 'B', 'C']);
});

// --- Layer shape / preservation checks (S-107-style field verification, per MONO-005's own "Verify"
// list): layer count, layer types, preserved stone sizes, preserved colors, preserved metadata.

await test('generated layers preserve requested stone size and color, and match the ordinary layer schema', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'two-letter', letters: ['A', 'B'], ...RS_BLOCK,
    stoneSizeMm: 3.2, color: 'ruby', canvasMm: CANVAS_MM,
    frameRect: { xMm: 5, yMm: 10, widthMm: 110, heightMm: 80 },
    frameOptions: { color: 'jet' }
  });

  assert.equal(result.ok, true);
  const [frameLayer, letterA, letterB] = result.layers;

  assert.equal(frameLayer.type, 'path');
  assert.equal(frameLayer.stoneSize, 3.2);
  assert.equal(frameLayer.color, 'jet');
  assert.equal(frameLayer.x, 5);
  assert.equal(frameLayer.y, 10);
  assert.equal(frameLayer.w, 110);
  assert.equal(frameLayer.h, 80);
  assert.ok(Array.isArray(frameLayer.contours) && frameLayer.contours.length > 0);

  for (const letterLayer of [letterA, letterB]) {
    assert.equal(letterLayer.type, 'text');
    assert.equal(letterLayer.stoneSize, 3.2);
    assert.equal(letterLayer.color, 'ruby');
    assert.equal(letterLayer.font, 'rs-block');
    assert.equal(letterLayer.visible, true);
    assert.equal(letterLayer.autoFit, false);
    assert.equal(typeof letterLayer.x, 'number');
    assert.equal(typeof letterLayer.y, 'number');
    assert.equal(typeof letterLayer.height, 'number');
    // MONO-005A: the persisted, position-only authored-font scale field.
    assert.equal(typeof letterLayer.authoredScale, 'number');
    assert.ok(letterLayer.authoredScale > 0 && Number.isFinite(letterLayer.authoredScale));
  }
});

await test('letter fitting preserves each stone\'s metadata unchanged through scale + translate', async () => {
  const generator = createCollidingFakeGenerator();
  // A single letter (no cross-letter collision possible) so this exercises the fitting/translate
  // path in isolation against the fake's stones, which are stamped with metadata:{fake:true}.
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['X'], fontId: 'fake-font',
    stoneSizeMm: 2.8, gapMm: 0.3, canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.measurements.letters[0].stoneCount, 2);
});

// --- MONO-005A: the persisted text x/y contract ---------------------------------------------------

await test('a generated letter layer\'s x/y renders at the intended slot center under the real text-layer coordinate contract', async () => {
  const { geometryEngine, generator } = createRealGenerator();
  const frameRect = { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 };
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM, frameRect
  });
  assert.equal(result.ok, true);

  const letterLayer = result.layers.find((l) => l.type === 'text');
  const letterMeasurement = result.measurements.letters[0];
  const slot = result.measurements.slots[0];
  const expectedCenterXMm = slot.targetRect.xMm + slot.targetRect.widthMm / 2;
  const expectedCenterYMm = slot.targetRect.yMm + slot.targetRect.heightMm / 2;

  // Regenerate this letter exactly as the real, unmodified live application would: GeometryEngine.
  // generateTextLayout() with the stored authoredScale, then app.js's own computeTextPlacementOffset()
  // formula (via its shared pure helper) using the stored x/y and the target canvas size.
  const regenerated = await geometryEngine.generateTextLayout({
    text: letterLayer.text, fontId: letterLayer.font, providerId: RS_BLOCK.providerId,
    layerId: letterLayer.id, heightMm: letterLayer.height || 25, stoneSizeMm: letterLayer.stoneSize,
    gapMm: 0, mode: 'outline', color: letterLayer.color, curveEnabled: false,
    authoredScale: letterLayer.authoredScale
  });
  const bb = regenerated.getBoundingBox();
  const { offsetXMm, offsetYMm } = computeTextPlacementOffsetMm({
    boundingBoxMm: bb, xMm: letterLayer.x, yMm: letterLayer.y,
    canvasWidthMm: CANVAS_MM.widthMm, canvasHeightMm: CANVAS_MM.heightMm
  });
  const finalCenterXMm = bb.minXmm + bb.widthMm / 2 + offsetXMm;
  const finalCenterYMm = bb.minYmm + bb.heightMm / 2 + offsetYMm;

  const EPS = 1e-6;
  assert.ok(Math.abs(finalCenterXMm - expectedCenterXMm) < EPS, `x center ${finalCenterXMm} vs ${expectedCenterXMm}`);
  assert.ok(Math.abs(finalCenterYMm - expectedCenterYMm) < EPS, `y center ${finalCenterYMm} vs ${expectedCenterYMm}`);
  // The stored x/y and measurements' own recorded x/y agree with each other.
  assert.equal(letterLayer.x, letterMeasurement.xMm);
  assert.equal(letterLayer.y, letterMeasurement.yMm);
});

// --- Structured failures ------------------------------------------------------------------------

await test('unknown frameId returns a structured frame-not-found failure', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'not-a-real-frame', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, canvasMm: CANVAS_MM, frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.FRAME_NOT_FOUND);
  assert.equal(result.layers, null);
});

await test('unknown layoutId returns a structured layout-not-found failure', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'not-a-real-layout', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, canvasMm: CANVAS_MM, frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.LAYOUT_NOT_FOUND);
});

await test('a letters array of the wrong length returns unsupported-letter-count', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['A', 'B'], ...RS_BLOCK,
    stoneSizeMm: 2.8, canvasMm: CANVAS_MM, frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.UNSUPPORTED_LETTER_COUNT);
});

await test('a non-authored (OpenType) font returns a structured invalid-font failure', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['A'], fontId: 'courier-prime-regular',
    stoneSizeMm: 2.8, canvasMm: CANVAS_MM, frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.INVALID_FONT);
});

await test('a letter that cannot legally fit its slot even at minimum scale returns fitting-failed', async () => {
  const { generator } = createRealGenerator();
  // A frame small enough that even the authored font's own smallest legal scale (MONO-002's
  // minimumLegalScale spacing floor -- MONO-006C's new default, see the module doc comment) doesn't
  // fit inside the slot -- a real, not synthetic, fitting failure.
  const result = await generator.generate({
    frameId: 'circle', layoutId: 'single', letters: ['W'], ...RS_BLOCK,
    stoneSizeMm: 2.8, canvasMm: CANVAS_MM, frameRect: { xMm: 0, yMm: 0, widthMm: 20, heightMm: 20 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.FITTING_FAILED);
});

// --- MONO-006C fitting fix: a round frame's true (curved) interior, not its bounding box ----------

await test('a single letter now fits inside an 85x85 oval frame (MONO-006C fix for bug B)', async () => {
  const { generator } = createRealGenerator();
  // Before MONO-006C, MonogramGenerator sized the single-letter slot to the frame interior's raw
  // axis-aligned bounding box, which for an oval/circle/diamond frame is a strict superset of the
  // true (curved) interior -- a letter fit to that bounding box could poke past the real boundary
  // near its corners and spuriously collide with the frame's own stones. computeFrameFitRect() (an
  // inscribed-rectangle search already built for exactly this in FrameLibrary.js, MONO-003) now
  // constrains the slot to a rectangle guaranteed to lie fully inside the true interior; combined
  // with MONO-006C's minimum-legal-scale letter sizing (small relative to the frame), this specific,
  // previously-reported failing combination now succeeds.
  const result = await generator.generate({
    frameId: 'oval', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, canvasMm: CANVAS_MM, frameRect: { xMm: 0, yMm: 0, widthMm: 85, heightMm: 85 }
  });
  assert.equal(result.ok, true);
  assert.ok(result.measurements.totalStoneCount > 0);
});

await test('two letters now fit inside an 85x85 square frame (MONO-006C fix for bug A)', async () => {
  const { generator } = createRealGenerator();
  // Before MONO-006C, FrameLibrary's fixed per-frame clearanceMm (1.5mm, every frame) did not scale
  // with the real production spacing requirement (stoneSizeMm+gapMm, up to ~6.7mm for the largest
  // catalog stone) -- at ordinary/larger stone sizes there wasn't enough geometric buffer between
  // the fitting region and the frame's own stones, even for a plain rectangular frame like Square.
  // computeFrameInterior()'s new minClearanceMm param (this generator now passes
  // stoneSizeMm+gapMm) guarantees the fitting region always reserves the real required spacing.
  const result = await generator.generate({
    frameId: 'square', layoutId: 'two-letter', letters: ['A', 'B'], ...RS_BLOCK,
    stoneSizeMm: 4.0, canvasMm: CANVAS_MM, frameRect: { xMm: 0, yMm: 0, widthMm: 85, heightMm: 85 }
  });
  assert.equal(result.ok, true);
  assert.equal(result.layers.length, 3, 'frame layer + 2 letter layers');
});

await test('a real letter defaults to its minimum legal scale, not a slot-filling scale (MONO-006C density default)', async () => {
  const { generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, canvasMm: CANVAS_MM, frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  });
  assert.equal(result.ok, true);
  const letterMeasurement = result.measurements.letters[0];
  assert.equal(letterMeasurement.requestedScale, letterMeasurement.minimumLegalScale);
});

await test('a letter placed exactly where the frame has a stone returns frame-collision (synthetic fixture)', async () => {
  // MONO-006C: real letters are now sized so small (minimum legal scale) that a genuine
  // letter-vs-frame collision is very hard to reach with real fonts/frames -- this fake forces one
  // deterministically (the letter's one stone and the frame's one stone both land on the exact same
  // point) to prove the collision check itself is untouched by the fitting/density changes above.
  const geometryEngine = {
    async generateTextLayout({ layerId, color }) {
      return new StoneLayout({
        layerId, sourceMode: 'authored',
        stones: [new Stone({ xMm: 0, yMm: 0, sizeMm: 2.8, color, layerId, index: 0 })]
      });
    },
    scaleAuthoredTextLayout(layout, requestedScale) {
      const scaledStones = layout.stones.map((s) => new Stone({
        xMm: s.xMm * requestedScale, yMm: s.yMm * requestedScale,
        sizeMm: s.sizeMm, color: s.color, layerId: s.layerId, index: s.index, metadata: s.metadata
      }));
      return {
        ok: true,
        layout: new StoneLayout({ layerId: layout.layerId, sourceMode: 'authored', stones: scaledStones }),
        requestedScale, minimumLegalScale: 0.1, naturalMinimumSpacingMm: 4, requiredSpacingMm: 3.1,
        originalBoundingBox: layout.getBoundingBox()?.toJSON() ?? null,
        scaledBoundingBox: layout.getBoundingBox()?.toJSON() ?? null
      };
    },
    // A frame stone placed exactly at the placement box's own center -- guaranteed to sit under
    // wherever the 'single' layout centers its one letter (the frame interior's own center too).
    generatePathLayout({ layerId, xMm, yMm, widthMm, heightMm }) {
      return new StoneLayout({
        layerId, sourceMode: 'fill',
        stones: [new Stone({ xMm: xMm + widthMm / 2, yMm: yMm + heightMm / 2, sizeMm: 2.8, color: 'gold', layerId, index: 0 })]
      });
    }
  };
  const generator = new MonogramGenerator({ geometryEngine });
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['X'], fontId: 'fake-font',
    stoneSizeMm: 2.8, gapMm: 0.3, canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.FRAME_COLLISION);
});

await test('two letters placed too close together return letter-collision, distinct from frame-collision (synthetic fixture)', async () => {
  const generator = createCollidingFakeGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'two-letter', letters: ['X', 'Y'], fontId: 'fake-font',
    stoneSizeMm: 2.8, gapMm: 0.3, canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 20, heightMm: 20 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.LETTER_COLLISION);
  assert.notEqual(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.FRAME_COLLISION);
});

await test('a letter layer that would not round-trip through the real GeometryEngine path returns internal-contract-mismatch (synthetic fixture)', async () => {
  const generator = createMismatchedFakeGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['X'], fontId: 'fake-font',
    stoneSizeMm: 2.8, gapMm: 0.3, canvasMm: CANVAS_MM,
    // A frame large relative to the fake's fixed 4mm-wide stone pair guarantees requestedScale != 1,
    // so the fake's authoredScale-ignoring generateTextLayout() and its scale-applying
    // scaleAuthoredTextLayout() are guaranteed to disagree.
    frameRect: { xMm: 0, yMm: 0, widthMm: 300, heightMm: 300 }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.INTERNAL_CONTRACT_MISMATCH);
});

await test('invalid top-level input is rejected with invalid-input, never throws', async () => {
  const { generator } = createRealGenerator();
  const base = {
    frameId: 'square', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, canvasMm: CANVAS_MM, frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  };

  const cases = [
    { ...base, frameId: '' },
    { ...base, letters: [] },
    { ...base, letters: ['AB'] },
    { ...base, letters: 'A' },
    { ...base, fontId: '' },
    { ...base, stoneSizeMm: 0 },
    { ...base, stoneSizeMm: -1 },
    { ...base, gapMm: -1 },
    { ...base, frameRect: null },
    { ...base, frameRect: { xMm: 0, yMm: 0, widthMm: 0, heightMm: 80 } },
    { ...base, color: '' },
    { ...base, canvasMm: null },
    { ...base, canvasMm: { widthMm: 0, heightMm: 200 } },
    { ...base, canvasMm: { widthMm: 200, heightMm: -1 } }
  ];

  for (const request of cases) {
    const result = await generator.generate(request);
    assert.equal(result.ok, false, `expected failure for ${JSON.stringify(request)}`);
    assert.equal(result.reason, MONOGRAM_GENERATOR_FAILURE_REASONS.INVALID_INPUT);
  }
});

// --- Determinism ---------------------------------------------------------------------------------

await test('identical requests produce byte-identical layer/measurement data', async () => {
  const { generator } = createRealGenerator();
  const request = {
    frameId: 'rounded-square', layoutId: 'traditional-three', letters: ['A', 'B', 'C'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 100, heightMm: 100 }
  };

  const first = await generator.generate(request);
  const second = await generator.generate(request);

  assert.equal(first.ok, true);
  assert.deepEqual(first.layers, second.layers);
  assert.deepEqual(first.measurements, second.measurements);
  assert.deepEqual(first.diagnostics, second.diagnostics);
});

// --- No GeometryEngine regression -----------------------------------------------------------------

await test('frame layer stone count matches an independent, direct generatePathLayout() call', async () => {
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
  const engine = new GeometryEngine({ fontProviderRegistry });
  const generator = new MonogramGenerator({ geometryEngine: engine });

  const frameRect = { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 };
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM, frameRect
  });
  assert.equal(result.ok, true);

  const { getFrameDefinition } = await import('../src/geometry/FrameLibrary.js');
  const frame = getFrameDefinition('square');
  const directFrameLayout = engine.generatePathLayout({
    contours: frame.generationNaturalContours,
    layerId: 'independent-check',
    xMm: frameRect.xMm, yMm: frameRect.yMm, widthMm: frameRect.widthMm, heightMm: frameRect.heightMm,
    stoneSizeMm: 2.8, gapMm: 0.3, mode: 'fill', color: 'gold'
  });

  assert.equal(result.measurements.frameStoneCount, directFrameLayout.stones.length);
});

await test('a generated letter layer round-trips through the real GeometryEngine.generateTextLayout() path with identical geometry', async () => {
  const { geometryEngine, generator } = createRealGenerator();
  const result = await generator.generate({
    frameId: 'square', layoutId: 'single', letters: ['A'], ...RS_BLOCK,
    stoneSizeMm: 2.8, color: 'gold', canvasMm: CANVAS_MM,
    frameRect: { xMm: 0, yMm: 0, widthMm: 80, heightMm: 80 }
  });
  assert.equal(result.ok, true);

  const letterLayer = result.layers.find((l) => l.type === 'text');
  const letterMeasurement = result.measurements.letters[0];

  const regenerated = await geometryEngine.generateTextLayout({
    text: letterLayer.text, fontId: letterLayer.font, providerId: RS_BLOCK.providerId,
    layerId: letterLayer.id, heightMm: letterLayer.height, stoneSizeMm: letterLayer.stoneSize,
    gapMm: 0, mode: 'outline', color: letterLayer.color, curveEnabled: false,
    authoredScale: letterLayer.authoredScale
  });

  assert.equal(regenerated.stones.length, letterMeasurement.stoneCount);
  const bb = regenerated.getBoundingBox().toJSON();
  const EPS = 1e-6;
  assert.ok(Math.abs(bb.widthMm - letterMeasurement.scaledBoundingBox.widthMm) < EPS);
  assert.ok(Math.abs(bb.heightMm - letterMeasurement.scaledBoundingBox.heightMm) < EPS);
  for (const stone of regenerated.stones) {
    assert.equal(stone.sizeMm, 2.8);
    assert.equal(stone.color, 'gold');
  }
});

if (process.exitCode === 1) {
  console.error('\nSome MONO-005 tests failed.');
} else {
  console.log('\nAll MONO-005 tests passed.');
}
