// IMG-026I -- the design canvas background switch: renderProductionLayout()'s backgroundColor,
// app.js's canvasBackgroundColor() and its wiring, and the #canvasBackground control. See
// docs/specifications/IMG-026-StrassLayoutService.md, "Faces and eyes (build I)", the Build I
// acceptance figures and "Tests the builds must add" (I).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Stone } from '../src/geometry/Stone.js';
import { StoneLayout } from '../src/geometry/StoneLayout.js';
import { renderProductionLayout } from '../src/renderer/CanvasRenderer2D.js';
import { assertTestRegistered } from './lib/test-registration-assertions.mjs';

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

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const appJs = await read('../app.js');
const indexHtml = await read('../index.html');

function fakeCtx() {
  const calls = { arc: [], fills: [] };
  const target = {
    arc(x, y, r) { calls.arc.push({ x, y, r }); },
    fillRect(x, y, w, h) { calls.fills.push({ x, y, w, h, style: target.fillStyle }); },
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; }
  };
  const ctx = new Proxy(target, {
    get(obj, prop) { return prop in obj ? obj[prop] : () => {}; },
    set(obj, prop, value) { obj[prop] = value; return true; }
  });
  return { ctx, calls };
}

const layout = new StoneLayout({
  layerId: 'img',
  stones: [new Stone({ layerId: 'img', index: 0, xMm: 5, yMm: 6, sizeMm: 2, color: 'jet' }), new Stone({ layerId: 'img', index: 1, xMm: 9, yMm: 6, sizeMm: 1.5, color: 'silk' })]
});

function extractFunctionSource(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `expected to find ${startMarker} in app.js`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`expected the closing brace of ${startMarker}`);
}

await test('1. renderProductionLayout() fills the canvas with backgroundColor (default #fbfdff) first, and draws the same stones either way', () => {
  const plain = fakeCtx();
  renderProductionLayout(plain.ctx, layout, { widthPx: 400, heightPx: 300, paddingPx: 20 });
  assert.deepEqual(plain.calls.fills[0], { x: 0, y: 0, w: 400, h: 300, style: '#fbfdff' });
  const mug = fakeCtx();
  renderProductionLayout(mug.ctx, layout, { widthPx: 400, heightPx: 300, paddingPx: 20, backgroundColor: '#1f3556' });
  assert.deepEqual(mug.calls.fills[0], { x: 0, y: 0, w: 400, h: 300, style: '#1f3556' });
  assert.deepEqual(mug.calls.arc, plain.calls.arc);
});

await test('2. canvasBackgroundColor(): white by default, the project cupColor on Product, and white on Flat Sheet', () => {
  const source = extractFunctionSource(appJs, 'function canvasBackgroundColor(){');
  const make = (value, kind) => new Function('el', 'currentObjectTemplate', 'project', `${source}\nreturn canvasBackgroundColor();`)(
    () => ({ value }), () => ({ preview: { kind } }), { cupColor: '#1f3556' });
  assert.equal(make('white', 'cylinder'), '#fbfdff');
  assert.equal(make('product', 'cylinder'), '#1f3556');
  assert.equal(make('product', 'plate'), '#1f3556');
  assert.equal(make('product', 'sheet'), '#fbfdff');
});

await test('3. wiring: drawLayout() sets the canvas CSS background (also in Design) and passes canvasBackgroundColor(), the control redraws on change, and it is view-only (not history-tracked, not in the project)', () => {
  const draw = extractFunctionSource(appJs, 'function drawLayout(){');
  assert.ok(draw.includes('backgroundColor:canvasBackgroundColor()'));
  const css = draw.indexOf("layoutCanvas.style.background=canvasBackgroundColor()==='#fbfdff'?'':canvasBackgroundColor();");
  assert.ok(css !== -1 && css < draw.indexOf('if(drawingTool.isActive)return;'), 'the CSS background is set before the Design early return');
  assert.ok(appJs.includes("el('canvasBackground').addEventListener('change',()=>{drawLayout();"));
  const tracked = appJs.slice(appJs.indexOf('const HISTORY_TRACKED_CONTROL_IDS='), appJs.indexOf('];', appJs.indexOf('const HISTORY_TRACKED_CONTROL_IDS=')));
  assert.ok(!tracked.includes("'canvasBackground'"));
  assert.ok(!/project\.canvasBackground/.test(appJs));
});

await test('4. index.html: #canvasBackground follows #snapEnabled with White (selected) and Product', () => {
  const m = indexHtml.match(/<select id="canvasBackground"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(m, 'expected the #canvasBackground select');
  assert.deepEqual([...m[1].matchAll(/<option value="(\w+)"( selected)?>([^<]+)<\/option>/g)].map((o) => [o[1], Boolean(o[2]), o[3]]),
    [['white', true, 'Background: White'], ['product', false, 'Background: Product']]);
  assert.ok(indexHtml.indexOf('id="snapEnabled"') < indexHtml.indexOf('id="canvasBackground"'));
});

await test('5. registration: test-img-026-product-background.mjs is in the ui group and the default suite', () => {
  assertTestRegistered({ filename: 'test-img-026-product-background.mjs', group: 'ui', includedInDefault: true });
});
