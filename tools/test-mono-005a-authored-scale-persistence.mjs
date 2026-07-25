// MONO-005A: Persistable Authored Text Fitting Contract -- GeometryEngine.generateTextLayout()'s
// new `authoredScale` param.
//
// Focused tests proving `authoredScale` is the correct, backward-compatible, project-schema-
// persistable counterpart to MONO-002's scaleAuthoredTextLayout(): reuses that exact method
// internally (see GeometryEngine.js's own doc comment on generateTextLayout()), defaults to 1
// (byte-identical to every pre-MONO-005A caller), never silently clamps an illegal value, and has no
// effect on sampled/OpenType text.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);

async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function createEngine() {
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: loadFontBufferFromRepoRoot
  });
  return new GeometryEngine({ fontProviderRegistry });
}

const RS_BLOCK_BASE_PARAMS = {
  text: 'Vitalina', fontId: 'rs-block', providerId: 'rhinestone', layerId: 'layer-1',
  heightMm: 12, stoneSizeMm: 2.8, gapMm: 0.3, mode: 'outline'
};

// SS6, the same authored SS10 3.1mm pitch, real shrink headroom (~0.74) per MONO-002's own test
// fixture -- reused here as this milestone's "legal persisted shrink" fixture.
const SS6_PARAMS = {
  text: 'AV', fontId: 'rs-block-prototype-ss10', providerId: 'rhinestone', layerId: 'layer-1',
  heightMm: 12, stoneSizeMm: 2.0, gapMm: 0.3, mode: 'outline'
};

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

function assertStonesEqual(a, b, label) {
  assert.equal(a.length, b.length, `${label}: stone count`);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].xMm, b[i].xMm, `${label}: stone ${i} xMm`);
    assert.equal(a[i].yMm, b[i].yMm, `${label}: stone ${i} yMm`);
    assert.equal(a[i].sizeMm, b[i].sizeMm, `${label}: stone ${i} sizeMm`);
    assert.equal(a[i].color, b[i].color, `${label}: stone ${i} color`);
  }
}

await test('existing authored text with no authoredScale remains byte-identical', async () => {
  const engine = createEngine();
  const withoutParam = await engine.generateTextLayout(RS_BLOCK_BASE_PARAMS);
  const withExplicitDefault = await engine.generateTextLayout({ ...RS_BLOCK_BASE_PARAMS, authoredScale: undefined });
  assertStonesEqual(withoutParam.stones, withExplicitDefault.stones, 'omitted vs explicit undefined');
});

await test('persisted authoredScale 1.0 reproduces the natural (unscaled) layout exactly', async () => {
  const engine = createEngine();
  const natural = await engine.generateTextLayout(RS_BLOCK_BASE_PARAMS);
  const scaledAtOne = await engine.generateTextLayout({ ...RS_BLOCK_BASE_PARAMS, authoredScale: 1 });
  assertStonesEqual(natural.stones, scaledAtOne.stones, 'natural vs authoredScale:1');
  assert.equal(scaledAtOne.sourceMode, 'authored');
});

await test('persisted authoredScale above 1.0 reproduces GeometryEngine.scaleAuthoredTextLayout()\'s own output exactly', async () => {
  const engine = createEngine();
  const natural = await engine.generateTextLayout(RS_BLOCK_BASE_PARAMS);
  const externallyScaled = engine.scaleAuthoredTextLayout(natural, 2.0);
  assert.equal(externallyScaled.ok, true);

  const internallyScaled = await engine.generateTextLayout({ ...RS_BLOCK_BASE_PARAMS, authoredScale: 2.0 });
  assertStonesEqual(externallyScaled.layout.stones, internallyScaled.stones, 'external scaleAuthoredTextLayout vs internal authoredScale');
});

await test('a legal persisted shrink (SS6 on the SS10 pitch) reproduces scaleAuthoredTextLayout()\'s own output exactly', async () => {
  const engine = createEngine();
  const natural = await engine.generateTextLayout(SS6_PARAMS);
  const legalShrinkScale = 0.8; // real headroom per MONO-002's own SS6 fixture (minimumLegalScale ~0.74)
  const externallyScaled = engine.scaleAuthoredTextLayout(natural, legalShrinkScale);
  assert.equal(externallyScaled.ok, true, 'expected the fixture scale to remain legal -- test fixture drifted from MONO-002\'s own assumption');

  const internallyScaled = await engine.generateTextLayout({ ...SS6_PARAMS, authoredScale: legalShrinkScale });
  assertStonesEqual(externallyScaled.layout.stones, internallyScaled.stones, 'external vs internal legal shrink');
});

await test('an illegal persisted shrink fails safely -- a hard, descriptive throw, never silently accepted or clamped', async () => {
  const engine = createEngine();
  const natural = await engine.generateTextLayout(RS_BLOCK_BASE_PARAMS);
  const externalCheck = engine.scaleAuthoredTextLayout(natural, 0.5);
  assert.equal(externalCheck.ok, false, 'expected 0.5 to be illegal for RS Block at its native pitch -- test fixture drifted from MONO-002\'s own assumption');

  await assert.rejects(
    () => engine.generateTextLayout({ ...RS_BLOCK_BASE_PARAMS, authoredScale: 0.5 }),
    /authoredScale 0\.5 is invalid/
  );
});

await test('sizeMm never changes regardless of authoredScale', async () => {
  const engine = createEngine();
  // RS Block at its native 2.8mm/3.1mm-pitch has ~zero legal shrink headroom (MONO-002), so every
  // value here is >= 1; SS6's own legal shrink is already covered by the dedicated fixture above.
  for (const authoredScale of [1, 1.5, 3]) {
    const layout = await engine.generateTextLayout({ ...RS_BLOCK_BASE_PARAMS, authoredScale });
    for (const stone of layout.stones) {
      assert.equal(stone.sizeMm, RS_BLOCK_BASE_PARAMS.stoneSizeMm, `authoredScale=${authoredScale}`);
    }
  }
});

await test('an invalid authoredScale (non-finite/non-positive) throws a clear, parameter-naming error', async () => {
  const engine = createEngine();
  for (const badScale of [0, -1, NaN, Infinity, 'two']) {
    await assert.rejects(
      () => engine.generateTextLayout({ ...RS_BLOCK_BASE_PARAMS, authoredScale: badScale }),
      /authoredScale/
    );
  }
});

await test('save/export/import-shaped layer data retains the authoredScale field (plain JSON round-trip, and validateProject()\'s spread never strips unknown fields)', async () => {
  const layer = {
    id: 'text1', type: 'text', visible: true, text: 'Hi', font: 'rs-block',
    height: 12, textMode: 'stroke', stoneSize: 2.8, gap: 0.3, color: 'gold',
    autoFit: false, authoredScale: 1.6, x: 0, y: 0
  };
  const roundTripped = JSON.parse(JSON.stringify(layer));
  assert.equal(roundTripped.authoredScale, 1.6);

  // Structural proof (not a full functional extraction, which validateProject()'s many product/
  // vessel dependencies make disproportionate for this milestone's narrow scope): every text layer
  // it returns is built via `{...l}` (see app.js's own defaultProject-adjacent validateProject()),
  // which preserves every field a stored layer carries, known or not -- authoredScale included.
  const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
  assert.match(appJs, /layers:obj\.layers\.map\(l=>\(\{\.\.\.l,visible:l\.visible!==false\}\)\)/);
});

await test('authoredScale has no effect on sampled/OpenType text (ignored, not applied or rejected differently)', async () => {
  const engine = createEngine();
  const openTypeParams = {
    text: 'Vitalina', fontId: 'courier-prime-regular', layerId: 'layer-1',
    heightMm: 12, stoneSizeMm: 2.8, gapMm: 0.3, mode: 'outline'
  };
  const withoutScale = await engine.generateTextLayout(openTypeParams);
  const withScale = await engine.generateTextLayout({ ...openTypeParams, authoredScale: 2 });
  assertStonesEqual(withoutScale.stones, withScale.stones, 'OpenType with vs without authoredScale');
  assert.equal(withScale.sourceMode, 'outline');
});

await test('deterministic repeated calls with authoredScale produce identical results', async () => {
  const engine = createEngine();
  const first = await engine.generateTextLayout({ ...RS_BLOCK_BASE_PARAMS, authoredScale: 1.75 });
  const second = await engine.generateTextLayout({ ...RS_BLOCK_BASE_PARAMS, authoredScale: 1.75 });
  assert.deepEqual(first.toJSON(), second.toJSON());
});

await test('a rotated authored layer with authoredScale != 1 still rotates around its own bounding-box center (order-independence)', async () => {
  const engine = createEngine();
  const scaledOnly = await engine.generateTextLayout({ ...RS_BLOCK_BASE_PARAMS, authoredScale: 1.5 });
  const scaledAndRotated = await engine.generateTextLayout({ ...RS_BLOCK_BASE_PARAMS, authoredScale: 1.5, rotationDeg: 180 });
  assert.equal(scaledOnly.stones.length, scaledAndRotated.stones.length);
  // 180-degree rotation around the shared bounding-box center point-reflects every stone.
  const centerXMm = (Math.min(...scaledOnly.stones.map((s) => s.xMm)) + Math.max(...scaledOnly.stones.map((s) => s.xMm))) / 2;
  const centerYMm = (Math.min(...scaledOnly.stones.map((s) => s.yMm)) + Math.max(...scaledOnly.stones.map((s) => s.yMm))) / 2;
  for (let i = 0; i < scaledOnly.stones.length; i++) {
    const expectedXMm = 2 * centerXMm - scaledOnly.stones[i].xMm;
    const expectedYMm = 2 * centerYMm - scaledOnly.stones[i].yMm;
    assert.ok(Math.abs(scaledAndRotated.stones[i].xMm - expectedXMm) < 1e-9);
    assert.ok(Math.abs(scaledAndRotated.stones[i].yMm - expectedYMm) < 1e-9);
  }
});

if (process.exitCode === 1) {
  console.error('\nSome MONO-005A authoredScale tests failed.');
} else {
  console.log('\nAll MONO-005A authoredScale tests passed.');
}
