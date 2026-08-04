import assert from 'node:assert/strict';
import {
  Point2D,
  Contour,
  VectorPath,
  BoundingBox,
  GlyphMetrics,
  FontProviderResult,
  createCircleVectorPath,
  createRectangleVectorPath,
  IFontProvider,
  assertFontProvider
} from '../src/text/index.js';

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

test('Point2D stores millimeter coordinates and distances', () => {
  const a = new Point2D(0, 0);
  const b = new Point2D(3, 4);
  assert.equal(a.distanceTo(b), 5);
  assert.deepEqual(b.toJSON(), { xMm: 3, yMm: 4 });
});

test('Contour validates command shapes', () => {
  const contour = new Contour()
    .moveTo(0, 0)
    .lineTo(10, 0)
    .lineTo(10, 5)
    .closePath();

  assert.equal(contour.commands.length, 4);
  assert.equal(contour.isClosed, true);
});

test('VectorPath computes deterministic bounding box', () => {
  const contour = new Contour()
    .moveTo(2, 3)
    .lineTo(12, 3)
    .lineTo(12, 8)
    .closePath();

  const path = new VectorPath({ id: 'test', source: 'unit', contours: [contour] });
  const box = path.getBoundingBox();

  assert(box instanceof BoundingBox);
  assert.equal(box.minXmm, 2);
  assert.equal(box.minYmm, 3);
  assert.equal(box.maxXmm, 12);
  assert.equal(box.maxYmm, 8);
  assert.equal(box.widthMm, 10);
  assert.equal(box.heightMm, 5);
});

test('VectorPath serializes and loads deterministically', () => {
  const original = createRectangleVectorPath({ xMm: 1, yMm: 2, widthMm: 30, heightMm: 12, id: 'rect-1' });
  const json = original.toJSON();
  const loaded = VectorPath.fromJSON(json);

  assert.deepEqual(loaded.toJSON(), json);
});

test('Rectangle helper creates closed vector path', () => {
  const path = createRectangleVectorPath({ xMm: 0, yMm: 0, widthMm: 20, heightMm: 10 });
  assert.equal(path.contours.length, 1);
  assert.equal(path.contours[0].isClosed, true);
  assert.equal(path.getBoundingBox().widthMm, 20);
  assert.equal(path.getBoundingBox().heightMm, 10);
});

test('Circle helper creates cubic vector path with correct bounding box', () => {
  const path = createCircleVectorPath({ cxMm: 10, cyMm: 20, radiusMm: 5 });
  const box = path.getBoundingBox();

  assert.equal(path.contours.length, 1);
  assert.equal(path.contours[0].commands.filter((c) => c.type === 'cubicTo').length, 4);
  assert.equal(box.minXmm, 5);
  assert.equal(box.minYmm, 15);
  assert.equal(box.maxXmm, 15);
  assert.equal(box.maxYmm, 25);
});

test('FontProviderResult requires VectorPath and GlyphMetrics', () => {
  const path = createRectangleVectorPath({ xMm: 0, yMm: 0, widthMm: 10, heightMm: 5 });
  const metrics = new GlyphMetrics({ advanceWidthMm: 11, boundingBox: path.getBoundingBox() });
  const result = new FontProviderResult({ path, metrics, fontId: 'test-font', text: 'A', heightMm: 5 });

  assert.equal(result.fontId, 'test-font');
  assert.equal(result.metrics.advanceWidthMm, 11);
  assert.equal(result.toJSON().text, 'A');
});

test('IFontProvider contract validation accepts conforming provider', () => {
  class MockProvider extends IFontProvider {
    get id() { return 'mock'; }
    get displayName() { return 'Mock'; }
    async load() {}
    async getTextPath() {
      const path = createRectangleVectorPath({ xMm: 0, yMm: 0, widthMm: 10, heightMm: 5 });
      return new FontProviderResult({
        path,
        metrics: new GlyphMetrics({ advanceWidthMm: 10, boundingBox: path.getBoundingBox() }),
        fontId: 'mock-font',
        text: 'A',
        heightMm: 5
      });
    }
  }

  assert.equal(assertFontProvider(new MockProvider()), true);
});

test('IFontProvider contract validation rejects incomplete provider', () => {
  assert.throws(() => assertFontProvider({ id: 'bad' }), /missing method/);
});
