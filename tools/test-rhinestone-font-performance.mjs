/**
 * TXT-101A — Original Rhinestone Font System Foundation: performance regression guard.
 *
 * An earlier version of RhinestoneStrokeGeometry.js built a capsule polygon per individual skeleton
 * *segment* (including every tiny segment a flattened arc was broken into, ~20 per curved stroke)
 * and unioned all of them together via the Geometry Engine's Boolean Operations, chaining up to ~20
 * sequential grid-rasterization passes per curved glyph. That measured 5-9 seconds for a single
 * 10-character preview string and ~30 seconds to pre-warm one family's full character set --
 * unusable for live typing or for the Browse Fonts panel's "stay responsive" requirement. The fix
 * (building each *stroke*'s ribbon directly, reserving the union for the few genuinely separate
 * strokes within a glyph) brought this down by roughly two orders of magnitude -- see
 * RhinestoneStrokeGeometry.js's own module doc for the full explanation. These thresholds guard
 * against that regression coming back, not against ordinary machine-to-machine variance -- they are
 * set well above measured times on this development machine, not tuned to the noise floor.
 */
import assert from 'node:assert/strict';
import { createDefaultRhinestoneFontRegistry, RhinestoneFontProvider, SKELETON_SUPPORTED_CHARACTERS } from '../src/text/rhinestoneFont/index.js';

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

const FAMILY_IDS = ['rs-block-regular', 'rs-modern-regular', 'rs-script-regular'];

await test('1. a single never-before-seen glyph resolves in well under one second (interactive typing latency)', async () => {
  for (const fontId of FAMILY_IDS) {
    const provider = new RhinestoneFontProvider({ registry: createDefaultRhinestoneFontRegistry() });
    const t0 = Date.now();
    await provider.getTextPath({ fontId, text: 'Q', heightMm: 20 });
    const elapsedMs = Date.now() - t0;
    assert.ok(elapsedMs < 1000, `expected a single new glyph to resolve in under 1000ms, ${fontId} took ${elapsedMs}ms`);
  }
});

await test('2. generating a full family\'s entire character set cold (nothing cached) completes in well under 15 seconds', async () => {
  for (const fontId of FAMILY_IDS) {
    const registry = createDefaultRhinestoneFontRegistry();
    const provider = new RhinestoneFontProvider({ registry });
    const characters = registry.getMetadata(fontId).supportedCharacters;
    const t0 = Date.now();
    for (const character of characters) {
      await provider.getTextPath({ fontId, text: character, heightMm: 20 });
    }
    const elapsedMs = Date.now() - t0;
    assert.ok(elapsedMs < 15000, `expected ${fontId}'s full ${characters.length}-character set to cold-generate in under 15s, took ${elapsedMs}ms`);
  }
});

await test('3. a warm (already-cached) glyph resolves essentially instantly, confirming the per-(family,character) cache is effective', async () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const provider = new RhinestoneFontProvider({ registry });
  await provider.getTextPath({ fontId: 'rs-block-regular', text: 'W', heightMm: 20 });
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) {
    await provider.getTextPath({ fontId: 'rs-block-regular', text: 'W', heightMm: 20 + (i % 10) });
  }
  const elapsedMs = Date.now() - t0;
  assert.ok(elapsedMs < 300, `expected 200 cached-glyph requests to be fast, took ${elapsedMs}ms`);
});

await test('4. SKELETON_SUPPORTED_CHARACTERS matches every family\'s reported supportedCharacters (no drift between the shared skeleton and per-family metadata)', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  for (const fontId of FAMILY_IDS) {
    assert.deepEqual(new Set(registry.getMetadata(fontId).supportedCharacters), new Set(SKELETON_SUPPORTED_CHARACTERS));
  }
});

console.log('Rhinestone Font Performance (TXT-101A) tests passed.');
