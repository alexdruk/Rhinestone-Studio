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
  // RS-2002: the Typography & Font Library milestone expanded the bundled collection from 3
  // registry entries (2 enabled + 1 disabled placeholder) to 10 (9 enabled + the same disabled
  // RobotoMono placeholder, kept untouched -- see assets/fonts/README.md).
  assert.equal(manager.listFonts({ includeDisabled: true }).length, 10);
});

test('FontManager enables every bundled font except the RobotoMono placeholder', () => {
  const manager = new FontManager(manifest);
  // RS-2000A flagged that the manifest's `enabled` flag previously gated nothing real -- app.js
  // loaded fonts by hardcoded id regardless of it. RS-2002 makes `enabled` the actual gate the
  // live app derives its font list from (see app.js's TEXT_ENGINE_FONT_IDS), so this manifest-level
  // invariant matters now: everything except the known-corrupt placeholder must be enabled.
  assert.equal(manager.listFonts().length, 9);
  assert.equal(manager.listFonts({ includeDisabled: true }).length - manager.listFonts().length, 1);
  assert.equal(manager.getFont('roboto-mono-regular').enabled, false);
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
    'script', 'serif', 'sans-serif', 'display', 'monogram', 'decorative', 'block', 'handwritten', 'monospace'
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
  assert.equal(json.fonts.length, 10);
  json.fonts[0].family = 'Changed';
  assert.equal(manager.getFont(DEFAULT_FONT_ID).family, 'Courier Prime');
});
