import assert from 'node:assert/strict';
import {
  IFontProvider,
  FontProviderRegistry,
  FontProviderResult,
  GlyphMetrics,
  createRectangleVectorPath
} from '../src/text/index.js';

class MockProvider extends IFontProvider {
  constructor({ id = 'mock-provider', displayName = 'Mock Provider', available = true } = {}) {
    super();
    this._id = id;
    this._displayName = displayName;
    this._available = available;
    this.loadCount = 0;
    this.requested = [];
  }

  get id() {
    return this._id;
  }

  get displayName() {
    return this._displayName;
  }

  async isAvailable() {
    return this._available;
  }

  async load() {
    this.loadCount += 1;
  }

  async getTextPath(options) {
    this.requested.push({ ...options });
    const path = createRectangleVectorPath({ xMm: 0, yMm: 0, widthMm: 20, heightMm: options.heightMm, id: 'mock-text' });
    const metrics = new GlyphMetrics({
      advanceWidthMm: 22,
      ascenderMm: options.heightMm * 0.8,
      descenderMm: -options.heightMm * 0.2,
      boundingBox: path.getBoundingBox()
    });

    return new FontProviderResult({
      path,
      metrics,
      fontId: options.fontId,
      text: options.text,
      heightMm: options.heightMm
    });
  }
}

function testRegistersAndListsProviders() {
  const registry = new FontProviderRegistry();
  const provider = new MockProvider();

  registry.register(provider);

  assert.equal(registry.has('mock-provider'), true);
  assert.deepEqual(registry.list(), [{ id: 'mock-provider', displayName: 'Mock Provider' }]);
  assert.equal(registry.defaultProviderId, 'mock-provider');
}

function testRejectsDuplicateProviders() {
  const registry = new FontProviderRegistry();
  registry.register(new MockProvider());

  assert.throws(() => registry.register(new MockProvider()), /already registered/);
}

function testDefaultProviderCanBeChanged() {
  const registry = new FontProviderRegistry();
  registry.register(new MockProvider({ id: 'one', displayName: 'One' }));
  registry.register(new MockProvider({ id: 'two', displayName: 'Two' }));

  registry.setDefault('two');

  assert.equal(registry.defaultProviderId, 'two');
  assert.equal(registry.get().id, 'two');
}

async function testCreatesTextPathThroughProvider() {
  const provider = new MockProvider();
  const registry = new FontProviderRegistry();
  registry.register(provider);

  const result = await registry.getTextPath({
    fontId: 'courier-prime',
    text: 'Vitalina',
    heightMm: 18
  });

  assert.equal(provider.loadCount, 1);
  assert.equal(provider.requested.length, 1);
  assert.equal(result.text, 'Vitalina');
  assert.equal(result.fontId, 'courier-prime');
  assert.equal(result.heightMm, 18);
  assert.equal(result.path.contours.length, 1);
  assert.equal(result.metrics.advanceWidthMm, 22);
}

async function testUnavailableProviderFailsClearly() {
  const registry = new FontProviderRegistry();
  registry.register(new MockProvider({ available: false }));

  await assert.rejects(
    () => registry.getTextPath({ fontId: 'courier-prime', text: 'Vitalina', heightMm: 18 }),
    /not available/
  );
}

function testUnknownProviderFailsClearly() {
  const registry = new FontProviderRegistry();

  assert.throws(() => registry.get('missing'), /Unknown font provider/);
}

await testCreatesTextPathThroughProvider();
await testUnavailableProviderFailsClearly();
testRegistersAndListsProviders();
testRejectsDuplicateProviders();
testDefaultProviderCanBeChanged();
testUnknownProviderFailsClearly();

console.log('FontProviderRegistry tests passed.');
