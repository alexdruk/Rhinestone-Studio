import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);

async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

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

await test('OpenTypeProvider is registered by default', () => {
  const registry = createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: loadFontBufferFromRepoRoot
  });

  assert.equal(registry.has('opentype'), true);
  assert.equal(registry.defaultProviderId, 'opentype');
  assert.deepEqual(registry.list(), [{ id: 'opentype', displayName: 'OpenType' }]);
});

await test('default registry resolves text through the OpenType provider', async () => {
  const registry = createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: loadFontBufferFromRepoRoot
  });

  const result = await registry.getTextPath({
    fontId: 'courier-prime-regular',
    text: 'Vitalina',
    heightMm: 10
  });

  assert.equal(result.text, 'Vitalina');
  assert.ok(result.path.contours.length > 0);
});

console.log('Default font provider registry tests passed.');
