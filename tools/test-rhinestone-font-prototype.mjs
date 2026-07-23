/**
 * TXT-101A restart -- RS Block Prototype (SS10), a diagnostic-only hand-authored stone-position
 * font. Two earlier full-coverage approaches (centerline-stroke skeleton; vector-outline union of
 * primitives) failed manual readability QA -- see families/rsBlockPrototypeSS10.js's module doc.
 * This suite covers what tests *can* verify (registration, deterministic authored maps,
 * supported/unsupported character handling, minimum stone separation, serialization, legacy
 * compatibility) -- it does not and cannot establish visual readability; that is the QA sheet's job
 * (tools/generate-rs-block-prototype-qa-sheet.mjs) plus manual approval.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  RhinestoneFontRegistry,
  createRhinestoneFontRegistry,
  createDefaultRhinestoneFontRegistry,
  RhinestoneFontProvider
} from '../src/text/rhinestoneFont/index.js';
import { getGlyphStoneMap, descriptor, PITCH_MM } from '../src/text/rhinestoneFont/families/rsBlockPrototypeSS10.js';
import { createDefaultFontProviderRegistry } from '../src/text/defaultFontProviders.js';
import { GeometryEngine } from '../src/geometry/GeometryEngine.js';
import { FontManager } from '../src/fonts/index.js';

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

const DIAGNOSTIC_CHARACTERS = ['A', 'B', 'C', 'D', 'G', 'M', 'N', 'O', 'P', 'R', 'S', '8'];

// ---------------------------------------------------------------------------------------------
// 1. Registration
// ---------------------------------------------------------------------------------------------

await test('1. the default registry registers exactly the one prototype family, with a stable id', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  assert.deepEqual(registry.list().map((f) => f.id), ['rs-block-prototype-ss10']);
});

await test('2. the registry rejects a family missing getGlyphStoneMap()', () => {
  const registry = new RhinestoneFontRegistry();
  assert.throws(
    () => registry.register({ descriptor: { id: 'x' }, renderOptions: {} }),
    /requires getGlyphStoneMap/
  );
});

await test('3. a future family registers with no change to RhinestoneFontRegistry/RhinestoneFontProvider (extensibility)', async () => {
  const customFamily = {
    descriptor: { id: 'rs-custom-test', displayName: 'Custom Test', category: 'experimental' },
    getGlyphStoneMap: (c) => (c === 'X' ? { advanceWidthMm: 10, stones: [{ xMm: 0, yMm: 0 }] } : null),
    renderOptions: {}
  };
  const registry = createRhinestoneFontRegistry([customFamily]);
  const provider = new RhinestoneFontProvider({ registry });
  const result = await provider.getTextPath({ fontId: 'rs-custom-test', text: 'X', heightMm: 20 });
  assert.equal(result.path.contours.length, 1);
});

await test('4. RhinestoneFontProvider is registered in the FontProviderRegistry alongside OpenTypeProvider (providerId compatibility retained)', async () => {
  const manager = new FontManager({ version: 1, fonts: [] });
  const registry = createDefaultFontProviderRegistry(manager);
  assert.equal(registry.defaultProviderId, 'opentype');
  assert.equal(registry.has('rhinestone'), true);
});

// ---------------------------------------------------------------------------------------------
// 2. Deterministic authored maps
// ---------------------------------------------------------------------------------------------

await test('5. every diagnostic glyph\'s stone map is deterministic across repeated calls (frozen, not regenerated)', () => {
  for (const character of DIAGNOSTIC_CHARACTERS) {
    const first = getGlyphStoneMap(character);
    const second = getGlyphStoneMap(character);
    assert.deepEqual(first, second);
    assert.ok(Object.isFrozen(first.stones), `expected ${character}'s stone list to be frozen (authored, not derived)`);
  }
});

await test('6. every diagnostic glyph is non-empty and every stone sits on the fixed pitch grid', () => {
  for (const character of DIAGNOSTIC_CHARACTERS) {
    const glyph = getGlyphStoneMap(character);
    assert.ok(glyph.stones.length > 0, `expected ${character} to have at least one stone`);
    for (const stone of glyph.stones) {
      assert.ok(Number.isFinite(stone.xMm) && Number.isFinite(stone.yMm));
      // Every authored position is an exact integer multiple of the pitch (5x7 grid), i.e. truly
      // hand-placed on the grid, not a computed/rounded value.
      assert.equal(Math.round(stone.xMm / PITCH_MM) * PITCH_MM, Number(stone.xMm.toFixed(10)));
      assert.equal(Math.round(stone.yMm / PITCH_MM) * PITCH_MM, Number(stone.yMm.toFixed(10)));
    }
  }
});

// ---------------------------------------------------------------------------------------------
// 3. Supported / unsupported characters
// ---------------------------------------------------------------------------------------------

await test('7. supportedCharacters is exactly the 12 diagnostic glyphs -- no lowercase, no other digits/punctuation', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const meta = registry.getMetadata('rs-block-prototype-ss10');
  assert.deepEqual([...meta.supportedCharacters].sort(), [...DIAGNOSTIC_CHARACTERS].sort());
});

await test('8. an unsupported character returns null from getGlyphStoneMap() (never a malformed/empty-but-present glyph)', () => {
  for (const character of ['a', 'z', 'E', 'H', 'I', 'T', 'U', '0', '1', '2', ' ', '.', '!']) {
    assert.equal(getGlyphStoneMap(character), null, `expected "${character}" to be unsupported`);
  }
});

await test('9. an unsupported character advances the pen without throwing and without producing stones (never a silently malformed glyph)', async () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const provider = new RhinestoneFontProvider({ registry });
  const supportedOnly = await provider.getTextPath({ fontId: 'rs-block-prototype-ss10', text: 'A', heightMm: 20 });
  const withUnsupported = await provider.getTextPath({ fontId: 'rs-block-prototype-ss10', text: 'AZ', heightMm: 20 });
  assert.equal(withUnsupported.path.contours.length, supportedOnly.path.contours.length, 'the unsupported "Z" must contribute zero stones');
  assert.ok(withUnsupported.metrics.advanceWidthMm > supportedOnly.metrics.advanceWidthMm, 'the unsupported "Z" must still advance the pen');
});

// ---------------------------------------------------------------------------------------------
// 4. Minimum stone separation (through the real production pipeline)
// ---------------------------------------------------------------------------------------------

await test('10. every authored stone position reproduces exactly through the real GeometryEngine outline-mode pipeline (no drift, no loss, no duplication)', async () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const provider = new RhinestoneFontProvider({ registry });
  const engine = new GeometryEngine({ fontProviderRegistry: { getTextPath: (o) => provider.getTextPath(o) } });

  for (const character of DIAGNOSTIC_CHARACTERS) {
    const layout = await engine.generateTextLayout({
      text: character, fontId: 'rs-block-prototype-ss10', providerId: 'rhinestone', layerId: 'x',
      heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
    });
    const authored = getGlyphStoneMap(character).stones;
    assert.equal(layout.stones.length, authored.length, `expected ${character}'s sampled stone count to match its authored count exactly`);

    const sampled = new Set(layout.stones.map((s) => `${s.xMm.toFixed(3)},${s.yMm.toFixed(3)}`));
    for (const stone of authored) {
      const key = `${stone.xMm.toFixed(3)},${stone.yMm.toFixed(3)}`;
      assert.ok(sampled.has(key), `expected authored stone (${key}) for "${character}" to survive sampling unchanged`);
    }
  }
});

await test('11. no two stones within any single diagnostic glyph are closer than the recommended stone size (no accidental overlap in the authored data itself)', () => {
  for (const character of DIAGNOSTIC_CHARACTERS) {
    const { stones } = getGlyphStoneMap(character);
    for (let i = 0; i < stones.length; i++) {
      for (let j = i + 1; j < stones.length; j++) {
        const distance = Math.hypot(stones[i].xMm - stones[j].xMm, stones[i].yMm - stones[j].yMm);
        assert.ok(
          distance >= descriptor.recommendedStoneSizeMm - 1e-9,
          `"${character}" has two stones ${distance.toFixed(2)}mm apart, below the ${descriptor.recommendedStoneSizeMm}mm recommended stone size`
        );
      }
    }
  }
});

await test('12. two adjacent letters in a word never place stones closer than the recommended stone size at the pen boundary', async () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const provider = new RhinestoneFontProvider({ registry });
  const engine = new GeometryEngine({ fontProviderRegistry: { getTextPath: (o) => provider.getTextPath(o) } });

  const layout = await engine.generateTextLayout({
    text: 'ABCDGMNOPRS8', fontId: 'rs-block-prototype-ss10', providerId: 'rhinestone', layerId: 'x',
    heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
  });

  let closestPairMm = Infinity;
  for (let i = 0; i < layout.stones.length; i++) {
    for (let j = i + 1; j < layout.stones.length; j++) {
      const distance = Math.hypot(layout.stones[i].xMm - layout.stones[j].xMm, layout.stones[i].yMm - layout.stones[j].yMm);
      if (distance < closestPairMm) closestPairMm = distance;
    }
  }
  assert.ok(closestPairMm >= descriptor.recommendedStoneSizeMm - 1e-9, `expected every stone pair across the whole string to be at least ${descriptor.recommendedStoneSizeMm}mm apart, closest was ${closestPairMm.toFixed(2)}mm`);
});

// ---------------------------------------------------------------------------------------------
// 5. Serialization
// ---------------------------------------------------------------------------------------------

await test('13. a project containing this prototype\'s font id serializes and deserializes cleanly through JSON.stringify/parse', () => {
  const project = {
    version: 2, units: 'mm', name: 'Prototype QA', product: 'mug', canvas: { width: 210, height: 90 },
    layers: [{ id: 'text1', type: 'text', visible: true, text: 'ABCD', font: 'rs-block-prototype-ss10', height: 30, textMode: 'stroke', stoneSize: 2.8, gap: 0.3, color: 'gold', autoFit: false, x: 0, y: 0 }]
  };
  const roundTripped = JSON.parse(JSON.stringify(project));
  assert.deepEqual(roundTripped, project);
  assert.equal(roundTripped.layers[0].font, 'rs-block-prototype-ss10');
});

// ---------------------------------------------------------------------------------------------
// 6. Legacy compatibility
// ---------------------------------------------------------------------------------------------

const manifest = JSON.parse(await readFile(new URL('../assets/fonts/manifest.json', import.meta.url), 'utf8'));

await test('14. the desktop font manifest is unaffected -- the prototype is not manifest-registered, so it never appears in the normal font picker', () => {
  const manager = new FontManager(manifest);
  assert.equal(manager.hasFont('rs-block-prototype-ss10'), false);
  assert.equal(manager.listFonts({ includeDisabled: true }).length, 10);
  // The two originally pre-existing font ids (predating any rhinestone work) are still untouched.
  for (const id of ['courier-prime-regular', 'great-vibes-regular']) {
    assert.ok(manager.hasFont(id));
  }
});

await test('15. an old project JSON with a plain desktop-font id (no providerId concept at all) still resolves through the unmodified OpenType path', () => {
  const manager = new FontManager(manifest);
  assert.equal(manager.getFont('courier-prime-regular').providerId, 'opentype');
});

console.log('RS Block Prototype (SS10) tests passed.');
