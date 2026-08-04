import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FontManager, DEFAULT_FONT_ID } from '../src/fonts/index.js';

const manifest = JSON.parse(await readFile(new URL('../assets/fonts/manifest.json', import.meta.url), 'utf8'));

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test('FontManager loads deterministic manifest', () => {
  const manager = new FontManager(manifest);
  assert.equal(manager.manifest.version, 2);
  // RS-2002 expanded the bundled collection from 3 registry entries (2 enabled + 1 disabled
  // placeholder) to 10 (9 enabled + the same disabled RobotoMono placeholder). TXT-101B added
  // rs-block (providerId:'rhinestone') -- 11. FONT-002 added rs-modern alongside it as the second
  // Production Font -- 12. FONT-DECISION-001 added baloo2-variable-regular (providerId:'opentype',
  // rhinestoneValidated:true) -- 13. FONT-PORTFOLIO-001 added sacramento-regular and
  // dancing-script-regular (also rhinestoneValidated:true) -- 15 total.
  assert.equal(manager.listFonts({ includeDisabled: true }).length, 15);
});

test('FontManager enables every bundled font except the RobotoMono placeholder', () => {
  const manager = new FontManager(manifest);
  // RS-2000A flagged that the manifest's `enabled` flag previously gated nothing real -- app.js
  // loaded fonts by hardcoded id regardless of it. RS-2002 makes `enabled` the actual gate the
  // live app derives its font list from (see app.js's TEXT_ENGINE_FONT_IDS), so this manifest-level
  // invariant matters now: everything except the known-corrupt placeholder must be enabled.
  assert.equal(manager.listFonts().length, 14);
  assert.equal(manager.listFonts({ includeDisabled: true }).length - manager.listFonts().length, 1);
  assert.equal(manager.getFont('roboto-mono-regular').enabled, false);
});

test('FontManager defaults providerId to "opentype" for every bundled record, and the field still works generically for a future rhinestone-tagged record', () => {
  const manager = new FontManager(manifest);
  for (const id of ['courier-prime-regular', 'great-vibes-regular', 'anton-regular']) {
    assert.equal(manager.getFont(id).providerId, 'opentype');
  }
  // TXT-101A's providerId field (added for a future manifest-registered rhinestone font) still
  // works correctly even though no shipped manifest entry uses 'rhinestone' right now -- the
  // diagnostic-only prototype is intentionally not manifest-registered, see
  // src/text/rhinestoneFont/index.js.
  const withRhinestoneFont = new FontManager({
    version: 1,
    fonts: [{ id: 'future-rs-font', family: 'Future RS Font', path: 'internal:future', providerId: 'rhinestone' }]
  });
  assert.equal(withRhinestoneFont.getFont('future-rs-font').providerId, 'rhinestone');

  // A manifest record predating the providerId field entirely (no key at all) must still default
  // cleanly, not throw or produce undefined -- this is the actual backward-compatibility guarantee,
  // not just "the shipped manifest happens to work".
  const legacy = new FontManager({ version: 1, fonts: [{ id: 'legacy-font', family: 'Legacy', path: 'assets/fonts/Legacy.ttf' }] });
  assert.equal(legacy.getFont('legacy-font').providerId, 'opentype');
});

test('FontManager defaults rhinestoneValidated to false, and passes through true for baloo2-variable-regular', () => {
  const manager = new FontManager(manifest);
  assert.equal(manager.getFont('baloo2-variable-regular').rhinestoneValidated, true);
  assert.equal(manager.getFont('courier-prime-regular').rhinestoneValidated, false);
  const legacy = new FontManager({ version: 1, fonts: [{ id: 'legacy-font', family: 'Legacy', path: 'assets/fonts/Legacy.ttf' }] });
  assert.equal(legacy.getFont('legacy-font').rhinestoneValidated, false);
});

test('FontManager defaults unsupportedStoneSizes to [], and passes through FONT-PORTFOLIO-001\'s per-font SS30 gates', () => {
  const manager = new FontManager(manifest);
  assert.deepEqual(manager.getFont('baloo2-variable-regular').unsupportedStoneSizes, [], 'Baloo2Variable is the one portfolio font with no size disabled');
  for (const id of ['anton-regular', 'sacramento-regular', 'dancing-script-regular']) {
    assert.deepEqual(manager.getFont(id).unsupportedStoneSizes, ['ss30'], `${id} should have SS30 disabled`);
  }
  assert.deepEqual(manager.getFont('courier-prime-regular').unsupportedStoneSizes, [], 'a pre-existing record with no rating data must default to []');
  const legacy = new FontManager({ version: 1, fonts: [{ id: 'legacy-font', family: 'Legacy', path: 'assets/fonts/Legacy.ttf' }] });
  assert.deepEqual(legacy.getFont('legacy-font').unsupportedStoneSizes, [], 'a record predating this field entirely must still default cleanly, not throw');
});

test('FontManager resolves default font, still Courier Prime for backward compatibility', () => {
  const manager = new FontManager(manifest);
  const font = manager.getDefaultFont();
  assert.equal(font.id, DEFAULT_FONT_ID);
  assert.equal(font.family, 'Courier Prime');
});

test('FontManager exposes a category (role) for every enabled font, matching RS-2002\'s taxonomy', () => {
  const manager = new FontManager(manifest);
  const expectedCategories = new Set([
    'script', 'serif', 'sans-serif', 'display', 'monogram', 'decorative', 'block', 'handwritten', 'monospace', 'rhinestone', 'rounded-sans'
  ]);
  const seen = new Set(manager.listFonts().map((font) => font.role));
  assert.deepEqual(seen, expectedCategories);
});

test('every enabled font id remains stable and pre-existing ids are untouched (backward compatibility)', () => {
  const manager = new FontManager(manifest);
  for (const id of ['courier-prime-regular', 'great-vibes-regular']) {
    assert.ok(manager.hasFont(id), `expected pre-existing font id "${id}" to still resolve`);
    assert.equal(manager.getFont(id).enabled, true);
  }
});

test('FontManager rejects duplicate ids', () => {
  assert.throws(() => new FontManager({
    version: 1,
    fonts: [manifest.fonts[0], manifest.fonts[0]]
  }), /Duplicate font id/);
});

test('FontManager serializes without mutation', () => {
  const manager = new FontManager(manifest);
  const json = manager.toJSON();
  assert.equal(json.fonts.length, 15);
  json.fonts[0].family = 'Changed';
  assert.equal(manager.getFont(DEFAULT_FONT_ID).family, 'Courier Prime');
});
