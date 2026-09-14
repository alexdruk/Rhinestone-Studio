// READ-009 — the Gallery fixture bridge's auto-fit path shares app.js's legibility floor.
//
// Before READ-009, src/gallery/RhsFixtureBridge.js's generateTextStonesForLayer() had its own
// separate, floor-less fit-to-width auto-fit implementation, so a committed fixture whose auto-fit
// genuinely needed READ-008's MIN_HEIGHT_TO_STONE_RATIO floor got silently over-shrunk by the
// bridge instead of floor-clamped like the live app already did. READ-009 extracted the floor into
// src/geometry/TextAutoFit.js and wired both call sites through it.
//
// tools/test-read-008-ratio-floor.mjs proves the *committed fixture corpus* never needs the floor
// clamped (a live invariant, re-verified every run) — which means no committed fixture can prove
// the bridge's floor actually clamps anything. This suite closes that gap directly, against a
// synthetic in-memory project built from the exact parameters long-name-autofit.rhs used before
// READ-009 re-authored it ("Alexandria Konstantinova" @ heightMm 30, stoneSizeMm 1.8) — the last
// known case where the floor and a naive fit-to-width shrink disagree.

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const examplesDir = path.join(repoRoot, 'examples');

const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');
const { GeometryEngine, maxAutoFitWidthMm, computeTextAutoFitScale } = await import('../src/geometry/index.js');
const { validateRhsProject, generateProjectStoneLayout, resolveFontId } = await import('../src/gallery/RhsFixtureBridge.js');

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

const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);
async function loadFontBuffer(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
const permanentEngine = new GeometryEngine({
  fontProviderRegistry: createDefaultFontProviderRegistry(fontManager, { loadFontBuffer })
});

// The retired long-name-autofit.rhs parameters (pre-READ-009 re-authoring): the last committed
// case whose auto-fit genuinely needed the floor clamp rather than plain fit-to-width.
const RETIRED_TEXT = 'Alexandria Konstantinova';
const RETIRED_FONT_ID = 'courier-prime-regular';
const RETIRED_HEIGHT_MM = 30;
const RETIRED_STONE_SIZE_MM = 1.8;
const RETIRED_GAP_MM = 0.3;
const RETIRED_CANVAS_WIDTH_MM = 210;
const RETIRED_CANVAS_HEIGHT_MM = 90;

await test('1. the real bridge (generateProjectStoneLayout) produces the floor-clamped stone count for a fixture whose auto-fit needs the floor, not the naive fit-to-width count', async () => {
  const providerId = fontManager.getFont(RETIRED_FONT_ID).providerId;
  const baseParams = {
    text: RETIRED_TEXT,
    fontId: RETIRED_FONT_ID,
    providerId,
    layerId: 'read-009-probe',
    stoneSizeMm: RETIRED_STONE_SIZE_MM,
    gapMm: RETIRED_GAP_MM,
    mode: 'outline',
    color: 'silver'
  };

  // Straight (unscaled) measured width, and the two candidate scales computed from it: plain
  // fit-to-width (no floor -- what the pre-READ-009 bridge would have produced) and the real,
  // floor-aware computeTextAutoFitScale() (what app.js and the post-READ-009 bridge both produce).
  const unscaled = await permanentEngine.generateTextLayout({ ...baseParams, heightMm: RETIRED_HEIGHT_MM });
  const maxWidthMm = maxAutoFitWidthMm(RETIRED_CANVAS_WIDTH_MM);
  assert.ok(unscaled.widthMm > maxWidthMm, 'the retired parameters must still genuinely overflow the canvas for this to be a meaningful probe');

  const fitToWidthScale = maxWidthMm / unscaled.widthMm;
  const floorAwareScale = computeTextAutoFitScale({
    measuredWidthMm: unscaled.widthMm,
    maxWidthMm,
    heightMm: RETIRED_HEIGHT_MM,
    stoneSizeMm: RETIRED_STONE_SIZE_MM
  }).scale;
  assert.ok(floorAwareScale > fitToWidthScale, 'the floor must raise the scale above plain fit-to-width for this probe to distinguish the two paths');

  const fitToWidthLayout = await permanentEngine.generateTextLayout({ ...baseParams, heightMm: RETIRED_HEIGHT_MM * fitToWidthScale });
  const floorClampedLayout = await permanentEngine.generateTextLayout({ ...baseParams, heightMm: RETIRED_HEIGHT_MM * floorAwareScale });
  assert.notEqual(fitToWidthLayout.stones.length, floorClampedLayout.stones.length,
    'the probe must be sensitive: fit-to-width and floor-clamped heights must not coincidentally produce the same stone count');

  // The real bridge, end to end, against a synthetic in-memory .rhs project (never written to
  // disk, never added to examples/).
  const syntheticProject = {
    version: 1,
    product: 'mug',
    units: 'mm',
    canvas: { width: RETIRED_CANVAS_WIDTH_MM, height: RETIRED_CANVAS_HEIGHT_MM },
    cupColor: '#1f3556',
    wrap: 'wide',
    layers: [{
      id: 'text-read-009-probe',
      type: 'text',
      name: RETIRED_TEXT,
      visible: true,
      text: RETIRED_TEXT,
      font: 'Courier Prime',
      mode: 'centerline',
      heightMm: RETIRED_HEIGHT_MM,
      stoneSizeMm: RETIRED_STONE_SIZE_MM,
      gapMm: RETIRED_GAP_MM,
      color: 'silver',
      autoFit: true
    }]
  };
  const validated = validateRhsProject(syntheticProject, 'read-009-synthetic-probe');
  const bridgeLayout = await generateProjectStoneLayout(validated, permanentEngine);

  assert.equal(bridgeLayout.stones.length, floorClampedLayout.stones.length,
    `expected the real bridge to produce the floor-clamped stone count (${floorClampedLayout.stones.length}), got ${bridgeLayout.stones.length}`);
  assert.notEqual(bridgeLayout.stones.length, fitToWidthLayout.stones.length,
    `expected the real bridge NOT to fall back to the pre-READ-009 floor-less fit-to-width count (${fitToWidthLayout.stones.length})`);
});

await test('2. computeTextAutoFitScale() reports degenerate:true when handed app-schema field names instead of the .rhs schema it is actually called with', () => {
  // The bridge's schema uses heightMm/stoneSizeMm; app.js's live layer objects use height/stoneSize.
  // Passing the wrong pair silently produces a plain fit-to-width result with every other test still
  // green (see src/geometry/TextAutoFit.js's own module comment) -- this is the regression that
  // property is meant to catch, demonstrated with the exact field-name mistake it exists to catch.
  const wrongFieldNames = {
    measuredWidthMm: 300,
    maxWidthMm: 200,
    height: RETIRED_HEIGHT_MM, // wrong: should be heightMm
    stoneSize: RETIRED_STONE_SIZE_MM // wrong: should be stoneSizeMm
  };
  const result = computeTextAutoFitScale(wrongFieldNames);
  assert.equal(result.degenerate, true, 'expected degenerate:true when heightMm/stoneSizeMm are absent');
  assert.equal(result.floored, false, 'a degenerate result must never claim to be floor-clamped');
});

await test('3. every autoFit text layer across the real examples/*.rhs corpus yields degenerate:false (the bridge always supplies real heightMm/stoneSizeMm)', async () => {
  const exampleFiles = (await readdir(examplesDir)).filter((f) => f.endsWith('.rhs')).sort();
  let measured = 0;
  for (const file of exampleFiles) {
    const raw = JSON.parse(await readFile(path.join(examplesDir, file), 'utf8'));
    const rhsProject = validateRhsProject(raw, file);
    for (const layer of rhsProject.layers) {
      if (layer.type !== 'text' || layer.visible === false || !layer.autoFit) continue;
      measured += 1;
      const fontId = resolveFontId(layer.font);
      const result = await permanentEngine.generateTextLayout({
        text: layer.text,
        fontId,
        providerId: fontManager.getFont(fontId).providerId,
        layerId: layer.id,
        heightMm: layer.heightMm,
        stoneSizeMm: layer.stoneSizeMm,
        gapMm: layer.gapMm,
        mode: layer.mode === 'fill' ? 'fill' : 'outline',
        color: layer.color
      });
      const fit = computeTextAutoFitScale({
        measuredWidthMm: result.widthMm,
        maxWidthMm: maxAutoFitWidthMm(rhsProject.canvas.width),
        heightMm: layer.heightMm,
        stoneSizeMm: layer.stoneSizeMm
      });
      assert.equal(fit.degenerate, false, `${file} (layer ${layer.id}): expected degenerate:false -- heightMm/stoneSizeMm must both be real, positive numbers`);
    }
  }
  assert.ok(measured > 0, 'expected to measure at least one autoFit text layer across the fixture set');
});

await test('4. this file is registered in test:gallery and the default suite (via tools/test-groups.mjs + tools/run-tests.mjs)', () => {
  assertTestRegistered({
    filename: 'test-read-009-bridge-autofit-floor.mjs',
    group: 'gallery',
    includedInDefault: true
  });
});

console.log('READ-009 bridge auto-fit floor tests passed.');
