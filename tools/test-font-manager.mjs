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
  // placeholder) to 10 (9 enabled + the same disabled RobotoMono placeholder). TXT-101A adds the
  // 3 original rhinestone-native families (rs-block-regular/rs-modern-regular/rs-script-regular,
  // all enabled), bringing the total to 13.
  assert.equal(manager.listFonts({ includeDisabled: true }).length, 13);
});

test('FontManager enables every bundled font except the RobotoMono placeholder', () => {
  const manager = new FontManager(manifest);
  // RS-2000A flagged that the manifest's `enabled` flag previously gated nothing real -- app.js
  // loaded fonts by hardcoded id regardless of it. RS-2002 makes `enabled` the actual gate the
  // live app derives its font list from (see app.js's TEXT_ENGINE_FONT_IDS), so this manifest-level
  // invariant matters now: everything except the known-corrupt placeholder must be enabled.
  assert.equal(manager.listFonts().length, 12);
  assert.equal(manager.listFonts({ includeDisabled: true }).length - manager.listFonts().length, 1);
  assert.equal(manager.getFont('roboto-mono-regular').enabled, false);
});

test('FontManager defaults providerId to "opentype" for every pre-TXT-101A font record, and TXT-101A rhinestone fonts declare "rhinestone"', () => {
  const manager = new FontManager(manifest);
  for (const id of ['courier-prime-regular', 'great-vibes-regular', 'anton-regular']) {
    assert.equal(manager.getFont(id).providerId, 'opentype');
  }
  for (const id of ['rs-block-regular', 'rs-modern-regular', 'rs-script-regular']) {
    assert.equal(manager.getFont(id).providerId, 'rhinestone');
  }
  // A manifest record predating the providerId field entirely (no key at all) must still default
  // cleanly, not throw or produce undefined -- this is the actual backward-compatibility guarantee,
  // not just "the shipped manifest happens to work".
  const legacy = new FontManager({ version: 1, fonts: [{ id: 'legacy-font', family: 'Legacy', path: 'assets/fonts/Legacy.ttf' }] });
  assert.equal(legacy.getFont('legacy-font').providerId, 'opentype');
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
    'script', 'serif', 'sans-serif', 'display', 'monogram', 'decorative', 'block', 'handwritten', 'monospace', 'rhinestone'
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
  assert.equal(json.fonts.length, 13);
  json.fonts[0].family = 'Changed';
  assert.equal(manager.getFont(DEFAULT_FONT_ID).family, 'Courier Prime');
});
