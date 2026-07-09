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
  assert.equal(manager.manifest.version, 1);
  assert.equal(manager.listFonts({ includeDisabled: true }).length, 3);
});

test('FontManager hides disabled fonts by default', () => {
  const manager = new FontManager(manifest);
  assert.equal(manager.listFonts().length, 0);
  assert.equal(manager.listFonts({ includeDisabled: true }).length, 3);
});

test('FontManager resolves default font even before font files are enabled', () => {
  const manager = new FontManager(manifest);
  const font = manager.getDefaultFont();
  assert.equal(font.id, DEFAULT_FONT_ID);
  assert.equal(font.family, 'Courier Prime');
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
  assert.equal(json.fonts.length, 3);
  json.fonts[0].family = 'Changed';
  assert.equal(manager.getFont(DEFAULT_FONT_ID).family, 'Courier Prime');
});
