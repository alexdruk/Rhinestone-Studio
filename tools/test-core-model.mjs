import assert from 'node:assert/strict';
import { Project, TextLayer, CircleLayer, RectangleLayer } from '../src/core/index.js';

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

test('Project creates default millimeter canvas', () => {
  const project = new Project();
  assert.equal(project.units, 'mm');
  assert.deepEqual(project.canvas, { width: 210, height: 90 });
  assert.equal(project.layers.length, 0);
});

test('Project adds text, circle, and rectangle layers', () => {
  const project = new Project();
  const text = project.addLayer({ type: 'text', text: 'Vitalina Serbin' });
  const circle = project.addLayer({ type: 'circle', radiusMm: 12 });
  const rectangle = project.addLayer({ type: 'rectangle', widthMm: 50, heightMm: 20 });

  assert.ok(text instanceof TextLayer);
  assert.ok(circle instanceof CircleLayer);
  assert.ok(rectangle instanceof RectangleLayer);
  assert.equal(project.layers.length, 3);
  assert.equal(text.params.text, 'Vitalina Serbin');
  assert.equal(circle.params.radiusMm, 12);
  assert.equal(rectangle.params.widthMm, 50);
});

test('Project updates layer parameters without replacing entire layer', () => {
  const project = new Project();
  const layer = project.addLayer({ type: 'text', text: 'Vitalina' });

  project.updateLayer(layer.id, {
    name: 'Customer name',
    params: { text: 'Alex', gapMm: 0.4 }
  });

  assert.equal(layer.name, 'Customer name');
  assert.equal(layer.params.text, 'Alex');
  assert.equal(layer.params.gapMm, 0.4);
  assert.equal(layer.params.stoneSizeMm, 2);
});

test('Project duplicates and removes layers', () => {
  const project = new Project();
  const layer = project.addLayer({ type: 'circle', radiusMm: 10 });
  const copy = project.duplicateLayer(layer.id);

  assert.notEqual(copy.id, layer.id);
  assert.equal(copy.params.radiusMm, 10);
  assert.equal(project.layers.length, 2);

  const removed = project.removeLayer(layer.id);
  assert.equal(removed.id, layer.id);
  assert.equal(project.layers.length, 1);
});

test('Project serializes and loads deterministically', () => {
  const original = new Project({
    product: 'mug',
    canvas: { width: 210, height: 90 },
    layers: [
      { id: 'text-1', type: 'text', text: 'Vitalina', font: 'Courier Prime' },
      { id: 'circle-1', type: 'circle', radiusMm: 14 }
    ]
  });

  const loaded = Project.fromJSONString(original.toJSONString());
  assert.deepEqual(loaded.toJSON(), original.toJSON());
});

test('Project validation catches duplicate layer ids', () => {
  const project = new Project({ layers: [{ id: 'same', type: 'text' }] });
  assert.throws(() => project.addLayer({ id: 'same', type: 'circle' }), /already exists/);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
