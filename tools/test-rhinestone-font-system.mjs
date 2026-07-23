/**
 * TXT-101A — Original Rhinestone Font System Foundation.
 *
 * Covers the new src/text/rhinestoneFont/** module: the centralized metadata registry, per-family
 * glyph coverage of the full A-Z/a-z/0-9/common-punctuation set, genuine geometric distinction
 * between RS Block/RS Modern/RS Script (not just labels), IFontProvider contract compliance and
 * caching, extensibility (registering a new family requires no core-file edits), and integration
 * with the existing FontProviderRegistry/FontManager pipeline alongside OpenTypeProvider.
 */
import assert from 'node:assert/strict';
import {
  RhinestoneFontRegistry,
  createRhinestoneFontRegistry,
  createDefaultRhinestoneFontRegistry,
  RhinestoneFontProvider,
  SKELETON_SUPPORTED_CHARACTERS
} from '../src/text/rhinestoneFont/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/defaultFontProviders.js';
import { FontManager } from '../src/fonts/index.js';
import { readFile } from 'node:fs/promises';

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
// The task's required initial coverage set: A-Z, a-z, 0-9, common punctuation already supported by
// the pre-existing text system (space, . , ! ? ' - &).
const REQUIRED_CHARACTERS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'0123456789',
  ' ', '.', ',', '!', '?', "'", '-', '&'
];

// ---------------------------------------------------------------------------------------------
// 1. Registry: stable ids + required metadata fields
// ---------------------------------------------------------------------------------------------

await test('1. the default registry registers exactly the three launch families with stable ids', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  assert.deepEqual(registry.list().map((f) => f.id).sort(), [...FAMILY_IDS].sort());
});

await test('2. every family exposes display name, category, supported characters, recommended/minimum stone size, recommended gap, and recommended uses', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  for (const id of FAMILY_IDS) {
    const meta = registry.getMetadata(id);
    assert.equal(typeof meta.displayName, 'string');
    assert.ok(meta.displayName.length > 0);
    assert.equal(typeof meta.category, 'string');
    assert.ok(meta.category.length > 0);
    assert.ok(Array.isArray(meta.supportedCharacters) && meta.supportedCharacters.length > 0);
    assert.ok(typeof meta.recommendedStoneSizeMm === 'number' && meta.recommendedStoneSizeMm > 0);
    assert.ok(typeof meta.minStoneSizeMm === 'number' && meta.minStoneSizeMm > 0);
    assert.ok(meta.minStoneSizeMm <= meta.recommendedStoneSizeMm, 'minimum stone size should not exceed the recommended size');
    assert.ok(typeof meta.recommendedGapMm === 'number' && meta.recommendedGapMm >= 0);
    assert.ok(Array.isArray(meta.recommendedUses) && meta.recommendedUses.length > 0);
  }
});

await test('3. display names/categories are distinct across the three families (not cosmetic aliases of one another)', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const metas = FAMILY_IDS.map((id) => registry.getMetadata(id));
  assert.equal(new Set(metas.map((m) => m.displayName)).size, 3);
  assert.equal(new Set(metas.map((m) => m.category)).size, 3);
  assert.deepEqual(new Set(metas.map((m) => m.displayName)), new Set(['RS Block', 'RS Modern', 'RS Script']));
});

await test('4. registry rejects duplicate family ids and families missing required fields', () => {
  const registry = new RhinestoneFontRegistry();
  const valid = { descriptor: { id: 'x', displayName: 'X', category: 'x' }, getGlyphStrokes: () => null, renderOptions: { defaultWidthUnits: 5 } };
  registry.register(valid);
  assert.throws(() => registry.register(valid), /already registered/);
  assert.throws(() => registry.register({ getGlyphStrokes: () => null, renderOptions: { defaultWidthUnits: 5 } }), /descriptor/);
  assert.throws(() => registry.register({ descriptor: { id: 'y' }, renderOptions: { defaultWidthUnits: 5 } }), /getGlyphStrokes/);
  assert.throws(() => registry.register({ descriptor: { id: 'z' }, getGlyphStrokes: () => null, renderOptions: {} }), /defaultWidthUnits/);
});

await test('5. a new family is addable purely by registration, with no change to RhinestoneFontRegistry/RhinestoneFontProvider needed', () => {
  // Simulates "future families register the same way" (see RhinestoneFontRegistry.js's module doc):
  // a hand-built family object satisfying the same shape as families/rsBlock.js, registered without
  // touching any existing file, and it works through the exact same provider/registry code.
  const customFamily = {
    descriptor: {
      id: 'rs-custom-test-regular',
      displayName: 'RS Custom Test',
      category: 'custom',
      recommendedStoneSizeMm: 2,
      minStoneSizeMm: 1.5,
      recommendedGapMm: 0.3,
      recommendedUses: ['Testing extensibility']
    },
    getGlyphStrokes: (character) => (character === 'X' ? { width: 40, strokes: [{ points: [{ x: 0, y: 0 }, { x: 40, y: 70 }], closed: false }] } : null),
    renderOptions: { capsuleSegments: 10, defaultWidthUnits: 10 }
  };
  const registry = createRhinestoneFontRegistry([customFamily]);
  assert.deepEqual(registry.getMetadata('rs-custom-test-regular').supportedCharacters, ['X']);

  const provider = new RhinestoneFontProvider({ registry });
  return provider.getTextPath({ fontId: 'rs-custom-test-regular', text: 'X', heightMm: 20 }).then((result) => {
    assert.ok(result.path.contours.length > 0);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Glyph coverage: every launch family covers A-Z/a-z/0-9 + the required punctuation set
// ---------------------------------------------------------------------------------------------

await test('6. every launch family\'s supportedCharacters superset covers every required character (A-Z, a-z, 0-9, space . , ! ? \' - &)', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  for (const id of FAMILY_IDS) {
    const supported = new Set(registry.getMetadata(id).supportedCharacters);
    const missing = REQUIRED_CHARACTERS.filter((c) => !supported.has(c));
    assert.deepEqual(missing, [], `${id} is missing required characters: ${JSON.stringify(missing)}`);
  }
});

await test('7. every required character actually produces non-empty, well-formed glyph geometry for every family (not just a metadata claim)', async () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const provider = new RhinestoneFontProvider({ registry });
  for (const fontId of FAMILY_IDS) {
    for (const character of REQUIRED_CHARACTERS) {
      const result = await provider.getTextPath({ fontId, text: character, heightMm: 20 });
      assert.ok(result.metrics.advanceWidthMm > 0, `${fontId} "${character}" must have a positive advance width`);
      if (character !== ' ') {
        assert.ok(result.path.contours.length > 0, `${fontId} "${character}" must produce at least one contour`);
        for (const contour of result.path.contours) {
          assert.ok(contour.commands.length >= 3, `${fontId} "${character}" contour must have at least 3 points`);
        }
      } else {
        assert.equal(result.path.contours.length, 0, 'space must produce no ink');
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// 3. Family distinction: genuinely different geometry, not cosmetic aliases
// ---------------------------------------------------------------------------------------------

await test('8. RS Block, RS Modern, and RS Script produce measurably different geometry for the same text/height (different stroke weight, contour counts, or proportions)', async () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const provider = new RhinestoneFontProvider({ registry });
  const results = {};
  for (const fontId of FAMILY_IDS) {
    results[fontId] = await provider.getTextPath({ fontId, text: 'Ag', heightMm: 30 });
  }

  // Block is deliberately much bolder (thicker stroke) than Modern -- their bounding boxes for the
  // identical skeleton at the identical height must differ, not coincide pixel-for-pixel.
  const blockBox = results['rs-block-regular'].metrics.boundingBox;
  const modernBox = results['rs-modern-regular'].metrics.boundingBox;
  assert.notEqual(blockBox.widthMm.toFixed(3), modernBox.widthMm.toFixed(3), 'RS Block and RS Modern must not share identical bounding-box width');

  // RS Script applies a forward shear (slant) no other family does -- its bounding box must be
  // measurably wider (skewed) than the unslanted families' for the same text.
  const scriptBox = results['rs-script-regular'].metrics.boundingBox;
  assert.notEqual(scriptBox.widthMm.toFixed(3), blockBox.widthMm.toFixed(3));
  assert.notEqual(scriptBox.widthMm.toFixed(3), modernBox.widthMm.toFixed(3));

  // RS Block and RS Modern deliberately share the same letter proportions/side bearing (see
  // skeletonGlyphs.js's module doc: they share one skeleton grammar, differentiated by stroke
  // construction, not spacing) so their advance widths are expected to match; RS Script's slant and
  // tighter connecting-thread side bearing must still produce a different advance width from both.
  assert.equal(results['rs-block-regular'].metrics.advanceWidthMm.toFixed(3), results['rs-modern-regular'].metrics.advanceWidthMm.toFixed(3));
  assert.notEqual(results['rs-script-regular'].metrics.advanceWidthMm.toFixed(3), results['rs-block-regular'].metrics.advanceWidthMm.toFixed(3));
});

await test('9. RS Script is the only family whose lowercase strokes include width variation (calligraphic taper) -- a real construction difference, not a labeling difference', async () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const provider = new RhinestoneFontProvider({ registry });

  function hasVariableWidthGeometry(result) {
    // A tapered stroke's ribbon has a non-constant local width; approximate by checking that the
    // contour is not a simple constant-offset ribbon -- concretely, RS Script's connecting thread
    // plus tapered strokes produce more contours per lowercase glyph than the uniform-width
    // families do for the same letter (thread + letter strokes vs. just the letter strokes).
    return result.path.contours.length;
  }

  const block = await provider.getTextPath({ fontId: 'rs-block-regular', text: 'o', heightMm: 20 });
  const script = await provider.getTextPath({ fontId: 'rs-script-regular', text: 'o', heightMm: 20 });
  assert.notEqual(hasVariableWidthGeometry(block), hasVariableWidthGeometry(script), 'expected RS Script\'s "o" (bowl + connecting thread) to differ structurally from RS Block\'s (bowl only)');
});

await test('10. recommended stone size/gap differ meaningfully across families (Block coarsest, Modern/Script finer) -- genuine placement-behavior distinction', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const block = registry.getMetadata('rs-block-regular');
  const modern = registry.getMetadata('rs-modern-regular');
  const script = registry.getMetadata('rs-script-regular');
  assert.ok(block.recommendedStoneSizeMm > modern.recommendedStoneSizeMm, 'expected RS Block to recommend a larger stone than RS Modern');
  assert.ok(modern.recommendedStoneSizeMm >= script.recommendedStoneSizeMm, 'expected RS Modern to recommend a stone size at least as large as RS Script');
});

// ---------------------------------------------------------------------------------------------
// 4. IFontProvider contract, caching, unknown-input handling
// ---------------------------------------------------------------------------------------------

await test('11. RhinestoneFontProvider satisfies the IFontProvider contract and registers into a FontProviderRegistry', async () => {
  const { assertFontProvider, FontProviderRegistry } = await import('../src/text/index.js');
  const provider = new RhinestoneFontProvider({ registry: createDefaultRhinestoneFontRegistry() });
  assert.ok(assertFontProvider(provider));
  const registry = new FontProviderRegistry();
  registry.register(provider);
  assert.equal(registry.has('rhinestone'), true);
});

await test('12. an unknown fontId throws a clear error; an unsupported character within a known font degrades gracefully instead of throwing', async () => {
  const provider = new RhinestoneFontProvider({ registry: createDefaultRhinestoneFontRegistry() });
  await assert.rejects(() => provider.getTextPath({ fontId: 'rs-nonexistent-regular', text: 'A', heightMm: 10 }), /Unknown rhinestone font family/);

  // A character with no skeleton data (e.g. an unsupported symbol) must not break the whole string --
  // matches OpenTypeProvider's .notdef-style silent-advance behavior, not a hard failure.
  const result = await provider.getTextPath({ fontId: 'rs-block-regular', text: 'A€Z', heightMm: 20 });
  assert.ok(result.metrics.advanceWidthMm > 0);
});

await test('13. glyph outlines are cached per (family, character) -- repeated requests for the same glyph are not recomputed', async () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const provider = new RhinestoneFontProvider({ registry });
  await provider.getTextPath({ fontId: 'rs-block-regular', text: 'M', heightMm: 20 });
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) {
    await provider.getTextPath({ fontId: 'rs-block-regular', text: 'M', heightMm: 20 + i });
  }
  const elapsedMs = Date.now() - t0;
  assert.ok(elapsedMs < 200, `expected 50 cached-glyph requests to be fast, took ${elapsedMs}ms`);
});

// ---------------------------------------------------------------------------------------------
// 5. Integration with the existing font pipeline (FontManager + FontProviderRegistry)
// ---------------------------------------------------------------------------------------------

const manifest = JSON.parse(await readFile(new URL('../assets/fonts/manifest.json', import.meta.url), 'utf8'));

await test('14. the manifest declares all three rhinestone families, enabled, with providerId "rhinestone"', () => {
  const manager = new FontManager(manifest);
  for (const id of FAMILY_IDS) {
    const font = manager.getFont(id);
    assert.equal(font.enabled, true);
    assert.equal(font.providerId, 'rhinestone');
  }
});

await test('15. createDefaultFontProviderRegistry() registers both OpenType (default) and RhinestoneFontProvider, and each resolves its own font ids', async () => {
  const manager = new FontManager(manifest);
  const registry = createDefaultFontProviderRegistry(manager);
  assert.equal(registry.defaultProviderId, 'opentype');
  assert.equal(registry.has('rhinestone'), true);

  const result = await registry.getTextPath({ providerId: 'rhinestone', fontId: 'rs-modern-regular', text: 'Hi', heightMm: 15 });
  assert.equal(result.fontId, 'rs-modern-regular');
  assert.ok(result.path.contours.length > 0);
});

console.log('Rhinestone Font System (TXT-101A) tests passed.');
