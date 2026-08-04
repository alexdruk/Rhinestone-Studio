import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

// RS-1006 superseded this milestone's own hand-tuned CUP_ROTATION_SENSITIVITY pixel-drag handler
// with a real Three.js 3D preview whose rotate/zoom/pan is provided by OrbitControls (see
// src/preview3d/Preview3DRenderer.js) -- not a regression, an architectural replacement of the
// entire interaction model these two tests originally covered. Updated in place (not deleted) to
// verify the successor behavior, per this repository's "narrow, documented guard-test update"
// precedent (see docs/specifications/RS-1006-Real3DPreview.md).
const preview3DRendererSource = await readFile(path.join(repoRoot, 'src/preview3d/Preview3DRenderer.js'), 'utf8');

await test('1. the old CUP_ROTATION_SENSITIVITY pixel-drag handler is gone; free 3D rotation now comes from OrbitControls (RS-1006)', () => {
  assert.ok(!/const CUP_ROTATION_SENSITIVITY=/.test(appJs), 'expected the old CUP_ROTATION_SENSITIVITY constant declaration to be removed');
  assert.ok(!/rotation\+=\(e\.clientX-lastX\)\*CUP_ROTATION_SENSITIVITY;/.test(appJs), 'expected the old cup pointermove handler to be removed');
  assert.ok(!/rotation\+=e\.clientX-lastX;/.test(appJs), 'the previous unscaled 1:1 rotation mapping must still be gone');
  assert.ok(/new orbitModule\.OrbitControls\(/.test(preview3DRendererSource), 'expected Preview3DRenderer.js to construct a real OrbitControls instance');
});

await test('2. OrbitControls interaction is configured for smooth (damped), non-jumpy rotate/zoom/pan', () => {
  assert.match(preview3DRendererSource, /this\.controls\.enableDamping\s*=\s*true/, 'expected damping enabled for smooth interaction');
  const dampingMatch = preview3DRendererSource.match(/this\.controls\.dampingFactor\s*=\s*([\d.]+)/);
  assert.ok(dampingMatch, 'expected a named dampingFactor');
  const dampingFactor = Number(dampingMatch[1]);
  assert.ok(dampingFactor > 0 && dampingFactor < 1, `expected 0 < dampingFactor < 1, got ${dampingFactor}`);
  assert.match(preview3DRendererSource, /this\.controls\.screenSpacePanning\s*=\s*true/, 'expected panning to be enabled');
  assert.match(preview3DRendererSource, /this\.controls\.minPolarAngle\s*=/, 'expected a polar-angle floor (avoids flipping through the pole)');
  assert.match(preview3DRendererSource, /this\.controls\.maxPolarAngle\s*=/, 'expected a polar-angle ceiling (avoids flipping through the pole)');
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

await test('4. setNumericSelectValue() is defined, wired for #stoneSize, and resolves numeric layer values to the real dropdown options with no blank selection', async () => {
  assert.match(appJs, /function setNumericSelectValue\(select,num\)\{/, 'expected a setNumericSelectValue helper');
  assert.match(appJs, /setNumericSelectValue\(el\('stoneSize'\),l\.stoneSize\)/, 'expected #stoneSize sync to use setNumericSelectValue');
  assert.ok(!/el\('stoneSize'\)\.value=String\(l\.stoneSize\)/.test(appJs), 'the previous brittle exact-string assignment must be gone');

  // RS-1013: #stoneSize's <option> list is no longer static in index.html -- it is now populated
  // at startup from the Stone Library catalog (src/renderer/StoneSizes.js), mirroring #stoneColor.
  // Build the real option list the same way app.js does (populateStoneSizeOptions()), then execute
  // the real, unmodified setNumericSelectValue() algorithm against it, proving the fix still
  // resolves numeric values to option strings under the new catalog-driven dropdown.
  assert.match(appJs, /function populateStoneSizeOptions\(\)\{/, 'expected #stoneSize to now be populated by populateStoneSizeOptions()');
  const { listStoneSizes } = await import('../src/renderer/StoneSizes.js');
  const optionValues = listStoneSizes().map((s) => String(s.diameterMm));
  assert.ok(optionValues.includes('2'), 'expected the Stone Library to still offer a 2mm (SS6) option');

  const fnSource = appJs.match(/function setNumericSelectValue\(select,num\)\{[\s\S]*?\}\n/)[0];
  // eslint-disable-next-line no-new-func
  const setNumericSelectValue = new Function(`return ${fnSource}`)();

  const mockSelect = { value: '', options: optionValues.map((v) => ({ value: v })) };
  setNumericSelectValue(mockSelect, 2);
  assert.equal(mockSelect.value, '2', 'expected the numeric layer stoneSize 2 to resolve to the SS6 option "2", not be blank');

  setNumericSelectValue(mockSelect, 2.8);
  assert.equal(mockSelect.value, '2.8', 'expected stoneSize 2.8 to resolve to the SS10 option');

  setNumericSelectValue(mockSelect, 4);
  assert.equal(mockSelect.value, '4', 'expected stoneSize 4 to resolve to the SS16 option');
});

await test('5. drawSelection() includes a contrast halo pass and a named, enlarged handle-size constant', () => {
  assert.match(appJs, /const SELECTION_HANDLE_SIZE_PX=11;/, 'expected a named, enlarged handle-size constant');
  assert.match(
    appJs,
    /ctx\.strokeStyle='rgba\(255,255,255,\.9\)';ctx\.lineWidth=4\*dpr;ctx\.setLineDash\(\[\]\);ctx\.strokeRect\(rx,ry,rw,rh\);/,
    'expected a white contrast halo stroked behind the dashed selection outline'
  );
});

await test('6. CupRenderer/CanvasRenderer2D never reference GeometryEngine or call geometry generation (the project.layers/layer-type purity check itself lives in tools/test-render-export-pipeline.mjs check 8, which covers the same two files plus SvgExporter.js)', () => {
  for (const [name, source] of [
    ['CupRenderer.js', cupRendererSource],
    ['CanvasRenderer2D.js', canvasRenderer2DSource]
  ]) {
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

  // RC-002 (fix ring outline overlap) intentionally changed this count from 391 to 357: outline
  // mode's cross-contour overlap guard (StoneSampler.js's sampleMultiContourOutlinePoints()) now
  // prunes stones that would have physically overlapped where a glyph's outer contour passes
  // closer than one stone diameter to its own counter/hole contour (e.g. this text's "a"/"e"/"b"
  // characters) -- the exact same class of defect RC-002 fixed for Ring's outer/inner circle,
  // confirmed present in this text layer's *un-fixed* geometry too (see RC-002's audit notes).
  //
  // RC-004A (fix same-contour stone self-overlap) intentionally changes this count again, from 357
  // to 202: the same sampleMultiContourOutlinePoints() now also prunes literal physical overlap
  // *within* one contour (a glyph's tight curves, cusps, and closing seam -- e.g. "V", "S", "a",
  // "e", "b", "i" all have curvature or a stroke width comparable to this layer's stoneSizeMm=2mm
  // at this text height), not only across two different contours as RC-002 alone did. This test's
  // own title ("this milestone touches no geometry code") refers to whatever milestone is *current*
  // when a reader is auditing a future, unrelated change; RC-004A is exactly a geometry-code
  // milestone, so this count and the bounding box below are expected to move once more here.
  assert.equal(result.count, 202, 'expected RC-004A\'s same-contour overlap guard to additionally prune physically overlapping stones within a single glyph contour');
  assert.ok(Math.abs(result.widthMm - 200.598759) < 0.001, `expected widthMm ~= 200.598759, got ${result.widthMm}`);
  assert.ok(Math.abs(result.heightMm - 17.097546) < 0.001, `expected heightMm ~= 17.097546, got ${result.heightMm}`);
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
console.log('UX visual polish tests passed.');
