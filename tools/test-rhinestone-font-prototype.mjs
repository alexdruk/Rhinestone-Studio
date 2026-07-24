/**
 * TXT-101A restart -- RS Block Prototype (SS10), a diagnostic-only hand-authored stone-position
 * font. Two earlier full-coverage approaches (centerline-stroke skeleton; vector-outline union of
 * primitives) failed manual readability QA -- see families/rsBlockPrototypeSS10.js's module doc.
 * A third approach (this file's original version) delivered authored positions by encoding each
 * stone as a placeholder triangle contour and relying on StoneSampler's outline-mode sampler always
 * taking its first sample at a contour's first vertex -- a real-geometry-pipeline workaround, not a
 * legitimate contract. That was replaced with FontProviderResult.stoneCenters: a font may return
 * explicit stone-center positions instead of glyph contours, and GeometryEngine converts them
 * directly into ordinary Stone objects with no contour flattening and no StoneSampler involvement at
 * all (see GeometryEngine.js's _buildPositionedContours()/generateTextLayout() and
 * RhinestoneFontProvider.js's module doc). This suite covers what tests *can* verify (registration,
 * deterministic authored maps, supported/unsupported character handling, no dependency on contour
 * sampling, fill-mode independence, minimum stone separation, serialization, legacy compatibility)
 * -- it does not and cannot establish visual readability; that is the QA sheet's job
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
import { StoneLayout } from '../src/geometry/StoneLayout.js';
import { Stone } from '../src/geometry/Stone.js';
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

function makeEngine() {
  const registry = createDefaultRhinestoneFontRegistry();
  const provider = new RhinestoneFontProvider({ registry });
  const engine = new GeometryEngine({ fontProviderRegistry: { getTextPath: (o) => provider.getTextPath(o) } });
  return { registry, provider, engine };
}

// ---------------------------------------------------------------------------------------------
// 1. Registration
// ---------------------------------------------------------------------------------------------

await test('1. the default registry registers the prototype family, with a stable id (alongside TXT-101B\'s production RS Block family -- see tools/test-rs-block.mjs)', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  assert.ok(registry.list().map((f) => f.id).includes('rs-block-prototype-ss10'));
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
  assert.equal(result.stoneCenters.length, 1);
  // TXT-102: RhinestoneFontProvider negates authored yMm into the engine's Y-down space (see its
  // module doc) -- -0 for an authored yMm of 0, arithmetically identical to 0 everywhere it is used.
  assert.deepEqual(result.stoneCenters[0], { xMm: 0, yMm: -0 });
});

await test('4. RhinestoneFontProvider is registered in the FontProviderRegistry alongside OpenTypeProvider (providerId compatibility retained)', async () => {
  const manager = new FontManager({ version: 1, fonts: [] });
  const registry = createDefaultFontProviderRegistry(manager);
  assert.equal(registry.defaultProviderId, 'opentype');
  assert.equal(registry.has('rhinestone'), true);
});

await test('5. RhinestoneFontProvider never produces glyph contours -- stones arrive solely via stoneCenters (no dependency on contour sampling, no placeholder/triangle contours)', async () => {
  const { provider } = makeEngine();
  for (const text of ['A', 'ABCD', 'RHINESTONE']) {
    const result = await provider.getTextPath({ fontId: 'rs-block-prototype-ss10', text, heightMm: 20 });
    assert.equal(result.path.contours.length, 0, `expected "${text}" to produce zero glyph contours`);
    assert.ok(Array.isArray(result.stoneCenters), `expected "${text}" to produce a stoneCenters array`);
  }
});

// ---------------------------------------------------------------------------------------------
// 2. Deterministic authored maps
// ---------------------------------------------------------------------------------------------

await test('6. every diagnostic glyph\'s stone map is deterministic across repeated calls (frozen, not regenerated)', () => {
  for (const character of DIAGNOSTIC_CHARACTERS) {
    const first = getGlyphStoneMap(character);
    const second = getGlyphStoneMap(character);
    assert.deepEqual(first, second);
    assert.ok(Object.isFrozen(first.stones), `expected ${character}'s stone list to be frozen (authored, not derived)`);
  }
});

await test('7. every diagnostic glyph is non-empty and every stone sits on the fixed pitch grid', () => {
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

await test('8. supportedCharacters is exactly the 12 diagnostic glyphs -- no lowercase, no other digits/punctuation', () => {
  const registry = createDefaultRhinestoneFontRegistry();
  const meta = registry.getMetadata('rs-block-prototype-ss10');
  assert.deepEqual([...meta.supportedCharacters].sort(), [...DIAGNOSTIC_CHARACTERS].sort());
});

await test('9. an unsupported character returns null from getGlyphStoneMap() (never a malformed/empty-but-present glyph)', () => {
  for (const character of ['a', 'z', 'E', 'H', 'I', 'T', 'U', '0', '1', '2', ' ', '.', '!']) {
    assert.equal(getGlyphStoneMap(character), null, `expected "${character}" to be unsupported`);
  }
});

await test('10. an unsupported character advances the pen without throwing and without producing stones (never a silently malformed glyph)', async () => {
  const { provider } = makeEngine();
  const supportedOnly = await provider.getTextPath({ fontId: 'rs-block-prototype-ss10', text: 'A', heightMm: 20 });
  const withUnsupported = await provider.getTextPath({ fontId: 'rs-block-prototype-ss10', text: 'AZ', heightMm: 20 });
  assert.equal(withUnsupported.stoneCenters.length, supportedOnly.stoneCenters.length, 'the unsupported "Z" must contribute zero stones');
  assert.ok(withUnsupported.metrics.advanceWidthMm > supportedOnly.metrics.advanceWidthMm, 'the unsupported "Z" must still advance the pen');
});

// ---------------------------------------------------------------------------------------------
// 4. Exact reproduction through the real GeometryEngine pipeline (no contour sampling)
// ---------------------------------------------------------------------------------------------

await test('11. every authored stone position reproduces exactly through the real GeometryEngine pipeline (no drift, no loss, no duplication)', async () => {
  const { engine } = makeEngine();

  for (const character of DIAGNOSTIC_CHARACTERS) {
    const layout = await engine.generateTextLayout({
      text: character, fontId: 'rs-block-prototype-ss10', providerId: 'rhinestone', layerId: 'x',
      heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
    });
    const authored = getGlyphStoneMap(character).stones;
    assert.equal(layout.stones.length, authored.length, `expected ${character}'s sampled stone count to match its authored count exactly`);
    assert.equal(layout.sourceMode, 'authored', `expected ${character}'s layout to record sourceMode 'authored'`);

    const sampled = new Set(layout.stones.map((s) => `${s.xMm.toFixed(3)},${s.yMm.toFixed(3)}`));
    for (const stone of authored) {
      // TXT-102: RhinestoneFontProvider negates authored yMm into the engine's Y-down space (see its
      // module doc), so the real pipeline's output is the negated authored position.
      const key = `${stone.xMm.toFixed(3)},${(-stone.yMm).toFixed(3)}`;
      assert.ok(sampled.has(key), `expected authored stone (${key}) for "${character}" to survive unchanged`);
    }
  }
});

await test('12. both fill-mode selections (outline and fill) produce the identical authored-stone result -- the stored mode has no effect', async () => {
  const { engine } = makeEngine();
  const base = {
    text: 'RHINESTONE', fontId: 'rs-block-prototype-ss10', providerId: 'rhinestone', layerId: 'x',
    heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, color: 'gold'
  };
  const outlineLayout = await engine.generateTextLayout({ ...base, mode: 'outline' });
  const fillLayout = await engine.generateTextLayout({ ...base, mode: 'fill' });

  assert.equal(outlineLayout.stones.length, fillLayout.stones.length);
  assert.equal(outlineLayout.sourceMode, 'authored');
  assert.equal(fillLayout.sourceMode, 'authored');
  const asKey = (s) => `${s.xMm.toFixed(6)},${s.yMm.toFixed(6)}`;
  assert.deepEqual(outlineLayout.stones.map(asKey).sort(), fillLayout.stones.map(asKey).sort());
  assert.ok(descriptor.fillModeIndependent === true, 'expected the family descriptor to declare fillModeIndependent, so a future UI can hide/disable the selector rather than let it silently do nothing');
});

await test('13. curved text combined with an authored-stone font fails explicitly rather than silently ignoring the curve settings', async () => {
  const { engine } = makeEngine();
  await assert.rejects(
    () => engine.generateTextLayout({
      text: 'A', fontId: 'rs-block-prototype-ss10', providerId: 'rhinestone', layerId: 'x',
      heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold',
      curveEnabled: true, curveRadiusMm: 40, curveSweepAngleDeg: 90
    }),
    /curved text is not supported/
  );
});

await test('14. resolveTextPolygons fails explicitly for an authored-stone font -- it has no vector outline for a Boolean Operation to consume', async () => {
  const { engine } = makeEngine();
  await assert.rejects(
    () => engine.resolveTextPolygons({ text: 'A', fontId: 'rs-block-prototype-ss10', providerId: 'rhinestone', layerId: 'x', heightMm: 30 }),
    /authored stone centers, not a vector outline/
  );
});

// ---------------------------------------------------------------------------------------------
// 5. Minimum stone separation
// ---------------------------------------------------------------------------------------------

await test('15. no two stones within any single diagnostic glyph are closer than the recommended stone size (no accidental overlap in the authored data itself)', () => {
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

await test('16. two adjacent letters in a word never place stones closer than the recommended stone size at the pen boundary', async () => {
  const { engine } = makeEngine();
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
// 6. Single source of truth (2D/3D/SVG/PNG/JSON export all consume the same StoneLayout)
// ---------------------------------------------------------------------------------------------

await test('17. generateTextLayout returns an ordinary StoneLayout of ordinary Stone instances -- the exact same product type every 2D/3D/SVG/PNG/JSON consumer already reads for every other layer type, with no parallel rendering/export path', async () => {
  const { engine } = makeEngine();
  const layout = await engine.generateTextLayout({
    text: 'ABCD', fontId: 'rs-block-prototype-ss10', providerId: 'rhinestone', layerId: 'x',
    heightMm: 30, stoneSizeMm: descriptor.recommendedStoneSizeMm, gapMm: descriptor.recommendedGapMm, mode: 'outline', color: 'gold'
  });

  assert.ok(layout instanceof StoneLayout);
  assert.ok(layout.stones.length > 0);
  for (const stone of layout.stones) {
    assert.ok(stone instanceof Stone);
  }

  // Round-trips through the same JSON contract every StoneLayout/Stone uses -- the shape every
  // exporter (SVG/PNG/JSON/production sheet) and the 2D/3D renderers already consume.
  const roundTripped = StoneLayout.fromJSON(JSON.parse(JSON.stringify(layout.toJSON())));
  assert.equal(roundTripped.stones.length, layout.stones.length);
  assert.deepEqual(
    roundTripped.stones.map((s) => [s.xMm, s.yMm, s.sizeMm, s.color]),
    layout.stones.map((s) => [Number(s.xMm.toFixed(6)), Number(s.yMm.toFixed(6)), Number(s.sizeMm.toFixed(6)), s.color])
  );
});

// ---------------------------------------------------------------------------------------------
// 7. Serialization
// ---------------------------------------------------------------------------------------------

await test('18. a project containing this prototype\'s font id serializes and deserializes cleanly through JSON.stringify/parse', () => {
  const project = {
    version: 2, units: 'mm', name: 'Prototype QA', product: 'mug', canvas: { width: 210, height: 90 },
    layers: [{ id: 'text1', type: 'text', visible: true, text: 'ABCD', font: 'rs-block-prototype-ss10', height: 30, textMode: 'stroke', stoneSize: 2.8, gap: 0.3, color: 'gold', autoFit: false, x: 0, y: 0 }]
  };
  const roundTripped = JSON.parse(JSON.stringify(project));
  assert.deepEqual(roundTripped, project);
  assert.equal(roundTripped.layers[0].font, 'rs-block-prototype-ss10');
});

// ---------------------------------------------------------------------------------------------
// 8. Legacy compatibility
// ---------------------------------------------------------------------------------------------

const manifest = JSON.parse(await readFile(new URL('../assets/fonts/manifest.json', import.meta.url), 'utf8'));

await test('19. the SS10 prototype remains manifest-unregistered even though TXT-101B\'s RS Block is now manifest-registered (see tools/test-rs-block.mjs)', () => {
  const manager = new FontManager(manifest);
  assert.equal(manager.hasFont('rs-block-prototype-ss10'), false);
  assert.equal(manager.listFonts({ includeDisabled: true }).length, 12);
  // The two originally pre-existing font ids (predating any rhinestone work) are still untouched.
  for (const id of ['courier-prime-regular', 'great-vibes-regular']) {
    assert.ok(manager.hasFont(id));
  }
});

await test('20. an old project JSON with a plain desktop-font id (no providerId concept at all) still resolves through the unmodified OpenType path', () => {
  const manager = new FontManager(manifest);
  assert.equal(manager.getFont('courier-prime-regular').providerId, 'opentype');
});

console.log('RS Block Prototype (SS10) tests passed.');
