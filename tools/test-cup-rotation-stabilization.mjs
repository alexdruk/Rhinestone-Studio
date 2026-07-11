import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// S-001 — Cup Rendering & 3D Preview Stabilization. Verifies:
//   - CupRenderer's handle is a real azimuthally-anchored 3D feature (signed, bidirectional
//     wall-attachment offset) rather than the previous fixed-flank/opacity-fade design, sweeping
//     continuously with rotation (no discrete jump) and never throwing across a full sweep.
//   - The handle's azimuth uses the same `+ rot` term the stone-placement code already uses, so the
//     handle and stones stay synchronized under one rotation value.
//   - app.js's 3D view buttons (Front/Left/Right/Back) stay visually synchronized with `rotation`
//     via a single helper called from updateAll() (not duplicated per rotation-changing call site).
//   - CupRenderer remains StoneLayout-only (no Project/Layer/layer-type/GeometryEngine reference).
//   - No forbidden file changed.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const appJs = await readFile(path.join(repoRoot, 'app.js'), 'utf8');
const cupRendererSource = await readFile(path.join(repoRoot, 'src/renderer/CupRenderer.js'), 'utf8');

const { renderCup } = await import('../src/renderer/CupRenderer.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');

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

function createFakeCtx() {
  const bezierCalls = [];
  const arcCalls = [];
  const gradientStub = { addColorStop() {} };
  const target = {
    createLinearGradient() { return gradientStub; },
    createRadialGradient() { return gradientStub; },
    bezierCurveTo(...args) { bezierCalls.push(args); },
    arc(x, y, r) { arcCalls.push({ x, y, r }); }
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
  return { ctx, bezierCalls, arcCalls };
}

const baseLayout = makeLayout([{ xMm: 0, yMm: 0, sizeMm: 2, color: 'gold' }]);

await test('1. renderCup never throws across a full fine-grained rotation sweep, both zoom extremes, every wrap mode', () => {
  for (const zoom of [0.7, 1.4]) {
    for (const wrap of ['front', 'wide', 'half', 'full']) {
      for (let deg = -180; deg <= 180; deg += 5) {
        const { ctx } = createFakeCtx();
        assert.doesNotThrow(() => renderCup(ctx, baseLayout, {
          widthPx: 480, heightPx: 380, dpr: 1, cupColor: '#1f3556', wrap, rotationDeg: deg, zoom
        }), `renderCup threw at wrap=${wrap} rotationDeg=${deg} zoom=${zoom}`);
      }
    }
  }
});

await test('2. the handle wall-attachment sweeps continuously with rotation (no discrete jump)', () => {
  const samples = [];
  for (let deg = -180; deg <= 180; deg += 5) {
    const { ctx, bezierCalls } = createFakeCtx();
    renderCup(ctx, baseLayout, { widthPx: 480, heightPx: 380, dpr: 1, cupColor: '#1f3556', wrap: 'front', rotationDeg: deg, zoom: 1 });
    assert.ok(bezierCalls.length > 0, `expected the handle to be drawn at rotationDeg=${deg}`);
    // The handle is the only shape in renderCup that calls bezierCurveTo; its first call's last
    // two arguments are the bottom wall-attachment point (attachBotX, attachBotY).
    samples.push({ deg, x: bezierCalls[0][4] });
  }
  assert.equal(samples.length, 73, 'expected the handle to be drawn (visible, not opacity-hidden) at every sampled angle');
  let maxJump = 0;
  for (let i = 1; i < samples.length; i++) {
    maxJump = Math.max(maxJump, Math.abs(samples[i].x - samples[i - 1].x));
  }
  assert.ok(maxJump < 25, `expected no single-step jump in the handle's wall-attachment x, got max ${maxJump}px between consecutive 5deg samples`);
});

await test('3. the handle attachment is signed/bidirectional (measurably left of center at one angle, right at another)', () => {
  const cx = 480 / 2;
  const atAngle = (deg) => {
    const { ctx, bezierCalls } = createFakeCtx();
    renderCup(ctx, baseLayout, { widthPx: 480, heightPx: 380, dpr: 1, cupColor: '#1f3556', wrap: 'front', rotationDeg: deg, zoom: 1 });
    return bezierCalls[0][4];
  };
  const atRight = atAngle(-90);
  const atLeft = atAngle(90);
  assert.ok(atRight > cx + 10, `expected rotationDeg=-90 to place the attachment measurably right of center, got x=${atRight} (cx=${cx})`);
  assert.ok(atLeft < cx - 10, `expected rotationDeg=90 to place the attachment measurably left of center, got x=${atLeft} (cx=${cx})`);
});

await test('4. the handle azimuth uses the same "+ rot" term as stone placement, keeping handle and stones synchronized', () => {
  assert.match(cupRendererSource, /const theta ?= ?HANDLE_AZIMUTH_RAD ?\+ ?rot;/, 'expected the handle azimuth to be HANDLE_AZIMUTH_RAD + rot');
  assert.match(cupRendererSource, /\+ ?rot;\s*\n\s*const front ?= ?Math\.cos\(theta\);/, 'expected stone placement to still use "+ rot" for its own theta (unchanged synchronization term)');
});

await test('5. no discrete side-flip branch or opacity-based hiding remains in the handle code', () => {
  assert.ok(!/HANDLE_FADE_LOW|HANDLE_FADE_HIGH|smoothstep|globalAlpha/.test(cupRendererSource), 'expected the previous opacity-fade mechanism to be fully removed');
});

await test('6. CupRenderer remains StoneLayout-only (no Project/Layer/layer-type/GeometryEngine reference)', () => {
  assert.ok(!/project\.layers/.test(cupRendererSource), 'CupRenderer.js must not reference project.layers');
  assert.ok(!/layer\.type|l\.type/.test(cupRendererSource), 'CupRenderer.js must not reference a layer\'s type');
  assert.ok(!/GeometryEngine/.test(cupRendererSource), 'CupRenderer.js must not reference GeometryEngine');
});

await test('7. app.js defines a single view-button synchronization helper and calls it from updateAll(), not only from the view-button click handler', () => {
  assert.match(appJs, /function updateViewButtons\(\)\{/, 'expected an updateViewButtons() helper');
  const updateAllBody = appJs.match(/async function updateAll\(skipWrite=false\)\{[\s\S]*?\n\}/)?.[0] ?? appJs.match(/async function updateAll\(skipWrite=false\)\{.*/)?.[0];
  assert.ok(updateAllBody, 'expected to locate updateAll()\'s body');
  assert.match(updateAllBody, /updateViewButtons\(\);/, 'expected updateAll() to call updateViewButtons() so every rotation-changing path (view button, reset, slider, drag) stays in sync');
  const viewBtnHandler = appJs.match(/document\.querySelectorAll\('\.viewBtn'\)\.forEach\([^;]*?;\}\)/)?.[0] ?? '';
  assert.ok(!/updateViewButtons\(\)/.test(viewBtnHandler), 'expected the view-button click handler itself to rely on updateAll() calling updateViewButtons(), not duplicate the call');
});

await test('8. the view-button sync helper compares rotation to data-view mod-360-aware (so -180 and 180 both match Back)', () => {
  assert.match(appJs, /function angleDiffDeg\(a,b\)\{/, 'expected an angleDiffDeg helper for mod-360-aware comparison');
  assert.match(appJs, /const VIEW_ANGLE_EPSILON_DEG=[\d.]+;/, 'expected a named epsilon constant for the view-button match tolerance');
});

await test('9. "front" wrap mode is no longer frozen in place — it moves and hides with rotation like every other wrap mode', () => {
  const layout = makeLayout([
    { xMm: 0, yMm: 0, sizeMm: 2, color: 'gold' },
    { xMm: 10, yMm: 3, sizeMm: 2, color: 'silver' },
    { xMm: -8, yMm: -4, sizeMm: 2, color: 'jet' }
  ]);
  const stoneXAt = (deg) => {
    const { ctx, arcCalls } = createFakeCtx();
    renderCup(ctx, layout, { widthPx: 480, heightPx: 380, dpr: 1, cupColor: '#1f3556', wrap: 'front', rotationDeg: deg, zoom: 1 });
    return arcCalls;
  };
  const at0 = stoneXAt(0);
  const at60 = stoneXAt(60);
  assert.equal(at0.length, 3, 'expected all 3 stones drawn at rotationDeg=0 (facing the camera)');
  assert.notDeepEqual(
    at60.map((c) => c.x),
    at0.map((c) => c.x),
    'expected the front-wrap design\'s screen position to change with rotation instead of staying frozen'
  );
  const at180 = stoneXAt(180);
  assert.equal(at180.length, 0, 'expected the front-wrap design to be fully hidden at rotationDeg=180 (facing directly away), as one clean unit');
});

await test('10. "front" wrap mode stays centered (matching its pre-S-001 fixed layout) at rotationDeg=0 — no regression at the default angle', () => {
  const layout = makeLayout([
    { xMm: 0, yMm: 0, sizeMm: 2, color: 'gold' },
    { xMm: 10, yMm: 3, sizeMm: 2, color: 'silver' }
  ]);
  const { ctx, arcCalls } = createFakeCtx();
  renderCup(ctx, layout, { widthPx: 480, heightPx: 380, dpr: 1, cupColor: '#1f3556', wrap: 'front', rotationDeg: 0, zoom: 1 });
  // At rotationDeg=0, front=cos(0)=1 and xShift=sin(0)=0 — exactly the previous (pre-S-001)
  // fixed-position formula (lx = cx - centerXMm*stoneScale), so the design's centroid must land on
  // cx, same as before this milestone.
  assert.equal(arcCalls.length, 2, 'expected both stones drawn (not culled) at rotationDeg=0');
  const cx = 480 / 2;
  const centroidX = (arcCalls[0].x + arcCalls[1].x) / 2;
  assert.ok(Math.abs(centroidX - cx) < 5, `expected the design centered on cx=${cx} at rotationDeg=0, got centroid ${centroidX}`);
});

await test('11. no forbidden file changed (this milestone\'s own forbidden list)', () => {
  const output = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' });
  const changedPaths = output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());

  const forbiddenExact = new Set(['style.css', 'README.md', 'LICENSE', 'CONTRIBUTING.md']);
  // src/svg/ and src/geometry/ are legitimately changed by the RS-1001 audit follow-up (added
  // <ellipse> support, fixed a call-stack overflow in generateSvgLayout()) — see
  // tools/test-svg-parser.mjs / tools/test-geometry-engine.mjs for that follow-up's own scope.
  // src/export/ is legitimately changed by RS-1005 (Production Sheet export) — see
  // tools/test-production-sheet-exporter.mjs for that milestone's own forbidden-file guard.
  const forbiddenPrefixes = [
    'src/core/', 'src/text/', 'src/fonts/',
    'src/browser/', 'src/history/', 'assets/', 'examples/'
  ];
  const forbiddenExactWithinPrefix = new Set(['src/renderer/CanvasRenderer2D.js', 'src/renderer/StoneColors.js']);

  for (const changedPath of changedPaths) {
    assert.ok(!forbiddenExact.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(!forbiddenExactWithinPrefix.has(changedPath), `Forbidden file changed: ${changedPath}`);
    assert.ok(
      !forbiddenPrefixes.some((prefix) => changedPath.startsWith(prefix)),
      `Forbidden file changed: ${changedPath}`
    );
  }
});

console.log('Cup rotation stabilization tests passed.');
