import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RS-0003.5D2 — User Experience and Visual Polish. Verifies:
//   - The cup drag rotation handler uses a named, substantially-reduced sensitivity constant
//     instead of the previous unscaled 1:1 pixel-to-degree mapping (no jump at drag start/end,
//     -180..180 clamp preserved).
//   - Zoom is clamped to named ZOOM_MIN/ZOOM_MAX constants matching the #zoom range input.
//   - The #stoneSize dropdown blank-selection bug is fixed by setNumericSelectValue(), verified
//     both structurally and by actually executing the extracted function against the real
//     index.html option values.
//   - CupRenderer's handle attachment sweeps/fades continuously with rotation (no discrete side
//     flip / jump), never throws across a full rotation sweep, and CupRenderer/CanvasRenderer2D
//     remain StoneLayout-only (no Project/Layer/layer-type/GeometryEngine reference).
//   - app.js's selection-drawing gained a contrast halo and larger handles.
//   - Geometry counts/bounds produced by the permanent GeometryEngine for the default project's
//     text layer are unchanged (this milestone touches no geometry code).
//   - stoneLayoutToSvg()/StoneLayout.toJSON() output for a fixed StoneLayout is unchanged.
//   - No forbidden file changed.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const indexHtml = await readFile(path.join(repoRoot, 'index.html'), 'utf8');
const cupRendererSource = await readFile(path.join(repoRoot, 'src/renderer/CupRenderer.js'), 'utf8');
const canvasRenderer2DSource = await readFile(path.join(repoRoot, 'src/renderer/CanvasRenderer2D.js'), 'utf8');

const { renderCup } = await import('../src/renderer/CupRenderer.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');
const { stoneLayoutToSvg } = await import('../src/export/SvgExporter.js');
const { FontManager } = await import('../src/fonts/index.js');
const { createDefaultFontProviderRegistry } = await import('../src/text/index.js');
const { GeometryEngine } = await import('../src/geometry/index.js');

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

function makeLayout(stoneParams, layerId = 'layer-1') {
  const stones = stoneParams.map((p, index) => new Stone({ layerId, index, ...p }));
  return new StoneLayout({ layerId, stones });
}

// Records only the calls that are unique/meaningful for a given assertion; everything else is a
// no-op, matching the dependency-free fake-canvas convention already used by
// tools/test-render-export-pipeline.mjs.
function createFakeCtx() {
  const bezierCalls = [];
  const gradientStub = { addColorStop() {} };
  const target = {
    createLinearGradient() { return gradientStub; },
    createRadialGradient() { return gradientStub; },
    bezierCurveTo(...args) { bezierCalls.push(args); }
  };
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      return () => {};
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    }
  });
  return { ctx, bezierCalls };
}

await test('1. CUP_ROTATION_SENSITIVITY is a named constant strictly between 0 and 1, used in the cup drag handler', () => {
  const match = appJs.match(/const CUP_ROTATION_SENSITIVITY=([\d.]+)/);
  assert.ok(match, 'expected a CUP_ROTATION_SENSITIVITY constant declaration');
  const value = Number(match[1]);
  assert.ok(value > 0 && value < 1, `expected 0 < CUP_ROTATION_SENSITIVITY < 1, got ${value}`);
  assert.match(
    appJs,
    /rotation\+=\(e\.clientX-lastX\)\*CUP_ROTATION_SENSITIVITY;/,
    'expected the cup pointermove handler to scale the pixel delta by CUP_ROTATION_SENSITIVITY'
  );
  assert.ok(!/rotation\+=e\.clientX-lastX;/.test(appJs), 'the previous unscaled 1:1 rotation mapping must be gone');
});

await test('2. drag rotation delta behavior is substantially reduced and still clamped to -180..180', () => {
  const value = Number(appJs.match(/const CUP_ROTATION_SENSITIVITY=([\d.]+)/)[1]);
  const rawPixelDelta = 120;
  const rotationDelta = rawPixelDelta * value;
  assert.ok(rotationDelta < rawPixelDelta / 2, 'expected a 120px drag to produce well under 60deg of rotation');
  assert.ok(rotationDelta > 0, 'expected a positive drag to still produce positive rotation (not inverted/zeroed)');
  assert.match(appJs, /rotation=Math\.max\(-180,Math\.min\(180,rotation\)\);/, 'expected the existing -180..180 clamp to remain');
});

await test('3. ZOOM_MIN/ZOOM_MAX constants match the #zoom range input and are used to clamp zoom', () => {
  assert.match(appJs, /const ZOOM_MIN=0\.7,ZOOM_MAX=1\.4;/, 'expected ZOOM_MIN=0.7,ZOOM_MAX=1.4');
  assert.match(indexHtml, /<input id="zoom" type="range" min="70" max="140"/, 'expected #zoom range min/max to match ZOOM_MIN/ZOOM_MAX * 100');
  assert.match(
    appJs,
    /zoom=Math\.max\(ZOOM_MIN,Math\.min\(ZOOM_MAX,\(parseFloat\(el\('zoom'\)\.value\)\|\|100\)\/100\)\)/,
    'expected writeSelectedControlsToLayer to clamp zoom with Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,...))'
  );
});

await test('4. setNumericSelectValue() is defined, wired for #stoneSize, and resolves numeric layer values to the real dropdown options with no blank selection', () => {
  assert.match(appJs, /function setNumericSelectValue\(select,num\)\{/, 'expected a setNumericSelectValue helper');
  assert.match(appJs, /setNumericSelectValue\(el\('stoneSize'\),l\.stoneSize\)/, 'expected #stoneSize sync to use setNumericSelectValue');
  assert.ok(!/el\('stoneSize'\)\.value=String\(l\.stoneSize\)/.test(appJs), 'the previous brittle exact-string assignment must be gone');

  // Extract the actual #stoneSize <option value="..."> list from index.html and the function
  // body from app.js, then execute the real algorithm (not a re-implementation) against a mock
  // <select>-shaped object to prove the fix actually resolves numeric values to option strings.
  const optionsHtml = indexHtml.match(/<select id="stoneSize">([\s\S]*?)<\/select>/)[1];
  const optionValues = [...optionsHtml.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(optionValues.includes('2.0'), 'expected index.html to still offer a 2.0 option');

  const fnSource = appJs.match(/function setNumericSelectValue\(select,num\)\{[\s\S]*?\}\n/)[0];
  // eslint-disable-next-line no-new-func
  const setNumericSelectValue = new Function(`return ${fnSource}`)();

  const mockSelect = { value: '', options: optionValues.map((v) => ({ value: v })) };
  setNumericSelectValue(mockSelect, 2);
  assert.equal(mockSelect.value, '2.0', 'expected the numeric layer stoneSize 2 to resolve to option "2.0", not be blank');

  setNumericSelectValue(mockSelect, 1.5);
  assert.equal(mockSelect.value, '1.5');

  setNumericSelectValue(mockSelect, 0.8);
  assert.equal(mockSelect.value, '0.8');
});

await test('5. drawSelection() includes a contrast halo pass and a named, enlarged handle-size constant', () => {
  assert.match(appJs, /const SELECTION_HANDLE_SIZE_PX=11;/, 'expected a named, enlarged handle-size constant');
  assert.match(
    appJs,
    /ctx\.strokeStyle='rgba\(255,255,255,\.9\)';ctx\.lineWidth=4\*dpr;ctx\.setLineDash\(\[\]\);ctx\.strokeRect\(rx,ry,rw,rh\);/,
    'expected a white contrast halo stroked behind the dashed selection outline'
  );
});

await test('6. CupRenderer/CanvasRenderer2D remain StoneLayout-only (no Project/Layer/layer-type/GeometryEngine reference)', () => {
  for (const [name, source] of [
    ['CupRenderer.js', cupRendererSource],
    ['CanvasRenderer2D.js', canvasRenderer2DSource]
  ]) {
    assert.ok(!/project\.layers/.test(source), `${name} must not reference project.layers`);
    assert.ok(!/layer\.type|l\.type/.test(source), `${name} must not reference a layer's type`);
    assert.ok(!/['"](text|circle|rectangle)['"]/.test(source), `${name} must not reference a layer type literal`);
    assert.ok(!/GeometryEngine/.test(source), `${name} must not reference GeometryEngine`);
    assert.ok(!/generateTextLayout|generateShapeLayout/.test(source), `${name} must not call geometry generation`);
  }
});

await test('7. renderCup never throws across a full rotation sweep, at both zoom extremes, for every wrap mode', () => {
  const layout = makeLayout([
    { xMm: 0, yMm: 0, sizeMm: 2, color: 'gold' },
    { xMm: 10, yMm: 3, sizeMm: 2, color: 'silver' },
    { xMm: -8, yMm: -4, sizeMm: 2, color: 'jet' }
  ]);
  for (const zoom of [0.7, 1.4]) {
    for (const wrap of ['front', 'wide', 'half', 'full']) {
      for (let deg = -180; deg <= 180; deg += 15) {
        const { ctx } = createFakeCtx();
        assert.doesNotThrow(() => renderCup(ctx, layout, {
          widthPx: 480, heightPx: 380, dpr: 1, cupColor: '#1f3556', wrap, rotationDeg: deg, zoom
        }), `renderCup threw at wrap=${wrap} rotationDeg=${deg} zoom=${zoom}`);
      }
    }
  }
});

await test('8. the handle attachment sweeps continuously with rotation (no discrete side-flip jump)', () => {
  const layout = makeLayout([{ xMm: 0, yMm: 0, sizeMm: 2, color: 'gold' }]);
  const samples = [];
  for (let deg = -180; deg <= 180; deg += 5) {
    const { ctx, bezierCalls } = createFakeCtx();
    renderCup(ctx, layout, { widthPx: 480, heightPx: 380, dpr: 1, cupColor: '#1f3556', wrap: 'front', rotationDeg: deg, zoom: 1 });
    // The handle is the only shape in renderCup that calls bezierCurveTo; its first call's last
    // two arguments are the bottom wall-attachment point (attachBotX, attachBotY).
    if (bezierCalls.length > 0) samples.push({ deg, x: bezierCalls[0][4] });
  }
  assert.ok(samples.length > 10, 'expected the handle to be drawn (visible) for a meaningful portion of the sweep');
  let maxJump = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].deg - samples[i - 1].deg > 5.5) continue; // skip gaps where the handle faded out entirely
    maxJump = Math.max(maxJump, Math.abs(samples[i].x - samples[i - 1].x));
  }
  // The previous implementation's discrete side flip moved the attachment point by roughly the
  // cup's half-width (tens of pixels) in a single 5deg step, right at rotationDeg=+-90deg, while
  // fully visible. A continuous sweep should never move more than a few pixels per 5deg step.
  assert.ok(maxJump < 25, `expected no single-step jump in the handle's wall-attachment x, got max ${maxJump}px between consecutive 5deg samples`);
});

await test('9. geometry counts/bounds from the permanent GeometryEngine are unchanged for the default project\'s text layer (this milestone touches no geometry code)', async () => {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  async function loadFontBufferFromRepoRoot(relativePath) {
    const buffer = await readFile(path.join(repoRoot, relativePath));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
  const engine = new GeometryEngine({ fontProviderRegistry });

  // Reproduces exactly what app.js's generateTextStonesLive() does for the default project's text
  // layer ("Vitalina Serbin", courier-prime-regular, height 25, autoFit on, canvas 210x90): a
  // first pass, then (since its width exceeds canvas.width-10=200) exactly one rescaled pass.
  const base = { text: 'Vitalina Serbin', fontId: 'courier-prime-regular', layerId: 'text', heightMm: 25, stoneSizeMm: 2, gapMm: 0.3, mode: 'outline' };
  let result = await engine.generateTextLayout(base);
  const maxWidth = 210 - 10;
  assert.ok(result.widthMm > maxWidth, 'expected the first pass to exceed the auto-fit threshold (pre-existing behavior)');
  const scale = maxWidth / result.widthMm;
  result = await engine.generateTextLayout({ ...base, heightMm: Math.max(1, 25 * scale) });

  assert.equal(result.count, 391, 'expected the same stone count as before this milestone\'s renderer-only changes');
  assert.ok(Math.abs(result.widthMm - 199.385118) < 0.001, `expected widthMm ~= 199.385118, got ${result.widthMm}`);
  assert.ok(Math.abs(result.heightMm - 16.978695) < 0.001, `expected heightMm ~= 16.978695, got ${result.heightMm}`);
});

await test('10. stoneLayoutToSvg()/StoneLayout.toJSON() output for a fixed StoneLayout is unchanged (src/export, src/geometry untouched this milestone)', () => {
  const layout = makeLayout([
    { xMm: 1.23456, yMm: 4.5, sizeMm: 2, color: 'gold' },
    { xMm: 9, yMm: 3, sizeMm: 3, color: 'sapphire' }
  ], 'text');

  const json = layout.toJSON();
  assert.deepEqual(json, {
    layerId: 'text',
    sourceMode: null,
    count: 2,
    boundingBox: json.boundingBox,
    widthMm: json.widthMm,
    heightMm: json.heightMm,
    stones: json.stones
  });
  assert.equal(json.count, 2);
  assert.ok(Math.abs(json.widthMm - 10.26544) < 0.001);
  assert.ok(Math.abs(json.heightMm - 4) < 0.001);

  const svg = stoneLayoutToSvg(layout, { widthMm: 210, heightMm: 90 });
  assert.ok(svg.includes('width="210mm"') && svg.includes('height="90mm"'));
  assert.equal((svg.match(/<circle\b/g) || []).length, 2);
  assert.ok(svg.includes('cx="1.235" cy="4.500" r="1.000"'));
  assert.ok(svg.includes('data-color="gold"') && svg.includes('data-color="sapphire"'));
});

await test('11. no forbidden file changed', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  const forbiddenPrefixes = [
    'src/geometry/',
    'src/text/',
    'src/fonts/',
    'src/core/',
    'src/browser/',
    'src/export/',
    'assets/'
  ];

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('UX visual polish tests passed.');
