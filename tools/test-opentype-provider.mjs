import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { FontProviderRegistry, OpenTypeProvider, createDefaultFontProviderRegistry } from '../src/text/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);

async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function createProvider() {
  return new OpenTypeProvider({ fontManager, loadFontBuffer: loadFontBufferFromRepoRoot });
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

await test('provider registers with the FontProviderRegistry', async () => {
  const registry = new FontProviderRegistry();
  registry.register(createProvider());

  assert.equal(registry.has('opentype'), true);
  assert.deepEqual(registry.list(), [{ id: 'opentype', displayName: 'OpenType' }]);
});

await test('throws a clear error for an unknown font id', async () => {
  const provider = createProvider();

  await assert.rejects(
    () => provider.getTextPath({ fontId: 'does-not-exist', text: 'Vitalina', heightMm: 10 }),
    /Unknown font id/
  );
});

await test('throws a clear error for a corrupt or unparsable font file', async () => {
  const provider = createProvider();

  // assets/fonts/RobotoMono-Regular.ttf is a placeholder fixture, not a real
  // font file. It exercises the "font is registered but unusable" path.
  await assert.rejects(
    () => provider.getTextPath({ fontId: 'roboto-mono-regular', text: 'Vitalina', heightMm: 10 }),
    /could not parse font file/
  );
});

await test('generates vector-path-compatible glyph outlines', async () => {
  const provider = createProvider();
  const result = await provider.getTextPath({ fontId: 'courier-prime-regular', text: 'Vi', heightMm: 10 });

  assert.ok(result.path.contours.length > 0, 'expected at least one contour');
  for (const contour of result.path.contours) {
    assert.equal(contour.commands[0].type, 'moveTo');
    assert.ok(contour.isClosed, 'expected each glyph contour to be closed');
  }
});

await test('reports bounding box and advance width in millimeters', async () => {
  const provider = createProvider();
  const small = await provider.getTextPath({ fontId: 'courier-prime-regular', text: 'Vitalina', heightMm: 10 });
  const large = await provider.getTextPath({ fontId: 'courier-prime-regular', text: 'Vitalina', heightMm: 20 });

  assert.ok(small.metrics.boundingBox.widthMm > 0);
  assert.ok(small.metrics.boundingBox.heightMm > 0);

  // Doubling the requested height should double every linear measurement.
  assert.ok(Math.abs(large.metrics.boundingBox.widthMm - small.metrics.boundingBox.widthMm * 2) < 1e-6);
  assert.ok(Math.abs(large.metrics.boundingBox.heightMm - small.metrics.boundingBox.heightMm * 2) < 1e-6);
  assert.ok(Math.abs(large.metrics.advanceWidthMm - small.metrics.advanceWidthMm * 2) < 1e-6);
});

await test('produces deterministic output for the same text, font, and size', async () => {
  const provider = createProvider();
  const first = await provider.getTextPath({ fontId: 'courier-prime-regular', text: 'Vitalina', heightMm: 12 });
  const second = await provider.getTextPath({ fontId: 'courier-prime-regular', text: 'Vitalina', heightMm: 12 });

  assert.deepEqual(first.toJSON(), second.toJSON());
});

await test('works end-to-end through the FontProviderRegistry', async () => {
  const registry = new FontProviderRegistry();
  registry.register(createProvider());

  const result = await registry.getTextPath({ fontId: 'great-vibes-regular', text: 'Vitalina', heightMm: 15 });

  assert.equal(result.text, 'Vitalina');
  assert.equal(result.fontId, 'great-vibes-regular');
  assert.ok(result.path.contours.length > 0);
});

await test('createDefaultFontProviderRegistry() registers OpenTypeProvider as the default provider, alongside TXT-101A\'s RhinestoneFontProvider', async () => {
  const registry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });

  assert.equal(registry.has('opentype'), true);
  // OpenType stays the *default* provider (registered first) so every pre-TXT-101A call site that
  // never passes providerId keeps resolving through it, unchanged.
  assert.equal(registry.defaultProviderId, 'opentype');
  assert.deepEqual(registry.list(), [
    { id: 'opentype', displayName: 'OpenType' },
    { id: 'rhinestone', displayName: 'Rhinestone Native' }
  ]);

  const result = await registry.getTextPath({ fontId: 'courier-prime-regular', text: 'Vitalina', heightMm: 10 });
  assert.equal(result.text, 'Vitalina');
  assert.ok(result.path.contours.length > 0);
});

console.log('OpenTypeProvider tests passed.');
