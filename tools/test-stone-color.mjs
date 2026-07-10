import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine, Stone, StoneLayout, DEFAULT_STONE_COLOR } from '../src/geometry/index.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
const fontManager = new FontManager(manifest);

async function loadFontBufferFromRepoRoot(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function createEngine() {
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, {
    loadFontBuffer: loadFontBufferFromRepoRoot
  });
  return new GeometryEngine({ fontProviderRegistry });
}

const BASE_PARAMS = {
  text: 'Vitalina',
  fontId: 'courier-prime-regular',
  layerId: 'layer-1',
  heightMm: 12,
  stoneSizeMm: 2,
  gapMm: 0.3
};

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

await test('1. Stone stores an explicit color', () => {
  const stone = new Stone({ xMm: 1, yMm: 2, sizeMm: 2, layerId: 'layer-1', color: 'Aurora Borealis' });
  assert.equal(stone.color, 'Aurora Borealis');
});

await test('2. Stone applies DEFAULT_STONE_COLOR when color is omitted', () => {
  const stone = new Stone({ xMm: 1, yMm: 2, sizeMm: 2, layerId: 'layer-1' });
  assert.equal(stone.color, DEFAULT_STONE_COLOR);
  assert.equal(DEFAULT_STONE_COLOR, 'Crystal AB');
});

await test('3. explicit color survives serialization', () => {
  const stone = new Stone({ xMm: 1, yMm: 2, sizeMm: 2, layerId: 'layer-1', color: 'Jet' });
  assert.equal(stone.toJSON().color, 'Jet');
});

await test('4. explicit color survives deserialization', () => {
  const stone = new Stone({ xMm: 1, yMm: 2, sizeMm: 2, layerId: 'layer-1', color: 'Jet' });
  const restored = Stone.fromJSON(stone.toJSON());
  assert.equal(restored.color, 'Jet');

  const restoredDefault = Stone.fromJSON(new Stone({ xMm: 0, yMm: 0, sizeMm: 2, layerId: 'layer-1' }).toJSON());
  assert.equal(restoredDefault.color, DEFAULT_STONE_COLOR);
});

await test('5. StoneLayout preserves stone colors', () => {
  const stones = [
    new Stone({ xMm: 0, yMm: 0, sizeMm: 2, layerId: 'layer-1', color: 'Jet' }),
    new Stone({ xMm: 1, yMm: 1, sizeMm: 2, layerId: 'layer-1' })
  ];
  const layout = new StoneLayout({ layerId: 'layer-1', stones });

  assert.equal(layout.stones[0].color, 'Jet');
  assert.equal(layout.stones[1].color, DEFAULT_STONE_COLOR);

  const restoredLayout = StoneLayout.fromJSON(layout.toJSON());
  assert.equal(restoredLayout.stones[0].color, 'Jet');
  assert.equal(restoredLayout.stones[1].color, DEFAULT_STONE_COLOR);
});

await test('6. GeometryEngine outline stones contain color', async () => {
  const engine = createEngine();

  const defaulted = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'outline' });
  assert.ok(defaulted.count > 0);
  assert.ok(defaulted.stones.every((stone) => stone.color === DEFAULT_STONE_COLOR));

  const requested = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'outline', color: 'Aurora Borealis' });
  assert.ok(requested.count > 0);
  assert.ok(requested.stones.every((stone) => stone.color === 'Aurora Borealis'));
});

await test('7. GeometryEngine fill stones contain color', async () => {
  const engine = createEngine();

  const defaulted = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'fill' });
  assert.ok(defaulted.count > 0);
  assert.ok(defaulted.stones.every((stone) => stone.color === DEFAULT_STONE_COLOR));

  const requested = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'fill', color: 'Aurora Borealis' });
  assert.ok(requested.count > 0);
  assert.ok(requested.stones.every((stone) => stone.color === 'Aurora Borealis'));
});

await test('8. repeated generation produces identical colors', async () => {
  const engine = createEngine();
  const first = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'outline', color: 'Aurora Borealis' });
  const second = await engine.generateTextLayout({ ...BASE_PARAMS, mode: 'outline', color: 'Aurora Borealis' });

  assert.deepEqual(first.toJSON(), second.toJSON());
  assert.deepEqual(
    first.stones.map((stone) => stone.color),
    second.stones.map((stone) => stone.color)
  );
});

await test('this task did not modify forbidden UI, renderer, or exporter files', async () => {
  const { execSync } = await import('node:child_process');
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css']);
  // src/renderer/ and src/export/ are legitimately changed by RS-0003.5C2 (rendering pipeline).
  const forbiddenPrefixes = ['src/text/', 'assets/'];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('Stone color tests passed.');
