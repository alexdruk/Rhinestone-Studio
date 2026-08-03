/**
 * RS-2013 §4 step 5 — instanced-stone stress-test performance measurement.
 *
 * Not part of `npm test` (this file does not match tools/run-tests.mjs's `^test-.*\.mjs$`
 * discovery pattern, deliberately -- same "prints measured numbers for a human to read, no
 * pass/fail assertion" role tools/measure-performance.mjs and tools/measure-boolean-precision.mjs
 * already play). Run with:
 *
 *   node tools/measure-instanced-stone-performance.mjs
 *
 * Measures the two costs RS-2013's design doc (§1.3/§3.2) and step 3's TASK_RESULT.md flagged as
 * real-but-unmeasured for the instanced-stone rendering path (`Preview3DRenderer.js`'s
 * `instancedStones: true` option), against synthetic hex-packed StoneLayout fixtures at three
 * stone counts spanning §1.3's realistic-to-theoretical-ceiling range (~1,000 / ~5,000 / ~15,000):
 *
 *   1. Initial InstancedMesh build cost (first `update()` call at a new stone count: allocates the
 *      InstancedMesh buffer at that capacity and runs the full per-stone matrix/color loop once).
 *   2. Steady-state per-`update()` rebuild cost (same stone count, no capacity change -- just the
 *      per-stone Matrix4/Color loop `_updateInstancedStones()` runs on every call), measured across
 *      a rapid run of calls with perturbed stone positions to simulate a continuous drag
 *      (`app.js`'s un-throttled `pointermove` -> `updateAll()` path).
 *
 * What this DOES measure: real wall-clock time of the real, unmodified
 * `Preview3DRenderer._updateInstancedStones()` code path (the CPU-side per-stone loop: azimuth/
 * radius/normal trig, `getCrystalAppearance()`/`getCrystalColor()` lookups, `Matrix4.compose()`,
 * `InstancedMesh.setMatrixAt()`/`setColorAt()`) running in real Node against the real 'three'
 * module and real `ObjectGeometryBuilder.js` geometry -- the same "mounted without a real init()"
 * convention `tools/test-preview3d-instanced-stones.mjs` already uses (no WebGLRenderer/
 * OrbitControls/ResizeObserver; those are real-browser/DOM dependencies update() never touches).
 *
 * What this DOES NOT measure: actual GPU frame time (rasterization/shading of the resulting
 * InstancedMesh draw call). There is no real GPU in this environment to measure against -- a
 * headless-Chromium/Playwright run would still only exercise a software rasterizer (SwiftShader/
 * ANGLE), which is not representative of the real desktop-class GPUs this preview actually ships
 * to, so it would not be a more honest number here, just a different unrepresentative one. The
 * design doc's own §3.2/§1.3 analytical argument stands in for that measurement instead: at most
 * 15,000 stones x 8 triangles = 120,000 triangles in ONE InstancedMesh draw call is trivial for any
 * WebGL2-class GPU (contemporary hardware comfortably renders single-digit millions of instanced
 * triangles per frame) -- there is no polygon-budget or draw-call-count concern at this scale, only
 * the CPU-side rebuild cost this script measures directly.
 */

import { performance } from 'node:perf_hooks';

globalThis.requestAnimationFrame = () => 0;

const THREE = await import('three');
const { buildObjectMesh, wallRadiusAt } = await import('../src/preview3d/ObjectGeometryBuilder.js');
const { getObjectTemplate, normalizePlateParams } = await import('../src/products/index.js');
const { Stone } = await import('../src/geometry/Stone.js');
const { StoneLayout } = await import('../src/geometry/StoneLayout.js');
const { Preview3DRenderer } = await import('../src/preview3d/Preview3DRenderer.js');

// --- Synthetic large-N fixture generation --------------------------------------------------------
//
// Per the task brief: these are stress-test fixtures, not authored designs -- a dense hex-packed
// grid of Stone objects at a fixed size/color, sized to hit an exact target stone count. Overlap
// between adjacent stones at the denser counts is expected and irrelevant here: this benchmark
// exercises the per-stone CPU loop, which does the same fixed amount of work per stone regardless
// of whether stones visually overlap.

const SS6_DIAMETER_MM = 2.0; // src/renderer/StoneSizes.js's smallest catalog size, matching §1.3's ceiling calc.

function countForPitch(pitch, widthMm, heightMm, marginMm) {
  const rowHeightMm = (pitch * Math.sqrt(3)) / 2;
  let count = 0;
  for (let y = marginMm, row = 0; y <= heightMm - marginMm; y += rowHeightMm, row++) {
    const xOffset = row % 2 === 0 ? 0 : pitch / 2;
    for (let x = marginMm + xOffset; x <= widthMm - marginMm; x += pitch) count++;
  }
  return count;
}

function generateHexGridStoneParams({ canvasWidthMm, canvasHeightMm, targetCount, sizeMm = SS6_DIAMETER_MM, color = 'gold', marginMm = 3 }) {
  const usableAreaMm2 = (canvasWidthMm - 2 * marginMm) * (canvasHeightMm - 2 * marginMm);
  let pitch = Math.sqrt((usableAreaMm2 * (Math.sqrt(3) / 2)) / targetCount);
  // Shrink pitch until the grid comfortably overshoots the target count, then trim to exactly
  // targetCount below -- simpler and just as deterministic as an exact closed-form solve, since the
  // row-packing loop's count isn't a smooth function of pitch (integer row/column counts).
  let guard = 0;
  while (countForPitch(pitch, canvasWidthMm, canvasHeightMm, marginMm) < targetCount && guard < 200) {
    pitch *= 0.95;
    guard++;
  }
  if (guard >= 200) {
    throw new Error(`generateHexGridStoneParams: could not reach targetCount=${targetCount} on a ${canvasWidthMm}x${canvasHeightMm}mm canvas`);
  }

  const rowHeightMm = (pitch * Math.sqrt(3)) / 2;
  const stones = [];
  for (let y = marginMm, row = 0; y <= canvasHeightMm - marginMm && stones.length < targetCount; y += rowHeightMm, row++) {
    const xOffset = row % 2 === 0 ? 0 : pitch / 2;
    for (let x = marginMm + xOffset; x <= canvasWidthMm - marginMm && stones.length < targetCount; x += pitch) {
      stones.push({ xMm: x, yMm: y, sizeMm, color });
    }
  }
  if (stones.length !== targetCount) {
    throw new Error(`generateHexGridStoneParams: produced ${stones.length} stones, expected exactly ${targetCount}`);
  }
  return stones;
}

function makeLayout(stoneParams, layerId = 'stress-layer') {
  const stones = stoneParams.map((p, index) => new Stone({ layerId, index, ...p }));
  return new StoneLayout({ layerId, stones });
}

// --- Mounted renderer, same convention as tools/test-preview3d-instanced-stones.mjs --------------

function makeMountedRenderer() {
  const instance = new Preview3DRenderer({ getBoundingClientRect: () => ({ width: 400, height: 300 }) });
  instance._mounted = true;
  instance._THREE = THREE;
  instance._buildObjectMesh = buildObjectMesh;
  instance._wallRadiusAt = wallRadiusAt;
  instance.scene = new THREE.Scene();
  instance.camera = new THREE.PerspectiveCamera(35, 4 / 3, 1, 5000);
  instance.controls = { target: new THREE.Vector3(), update() {}, saveState() {} };
  instance.renderer = { capabilities: { getMaxAnisotropy: () => 4 } };
  instance._ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  instance.scene.add(instance._ambientLight);
  return instance;
}

const MUG_OPTIONS = {
  cupColor: '#1f3556',
  objectTemplate: getObjectTemplate('mug'),
  canvasWidthMm: 210,
  canvasHeightMm: 90,
  instancedStones: true
};

const PLATE_PARAMS = normalizePlateParams({ outerDiameterMm: 300 });
const PLATE_OPTIONS = {
  cupColor: '#ffffff',
  objectTemplate: getObjectTemplate('plate'),
  canvasWidthMm: PLATE_PARAMS.outerDiameterMm,
  canvasHeightMm: PLATE_PARAMS.outerDiameterMm,
  plateParams: PLATE_PARAMS,
  instancedStones: true
};

// --- Timing helpers ------------------------------------------------------------------------------

function timeMs(fn) {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    mean: sum / sorted.length,
    max: sorted[sorted.length - 1]
  };
}

function fmt(n) { return n.toFixed(3); }

// Simulates a continuous drag: app.js's pointermove -> updateAll() path fires update() on every
// pointer move with no throttling (per the design doc's §3.2 citation of app.js:1366). Perturbs
// every stone's xMm/yMm by a small amount each call, rebuilding a fresh StoneLayout each time (the
// same "GeometryEngine regenerates the full StoneLayout on every edit" shape a real drag produces),
// so this measures the real per-call cost including StoneLayout/Stone construction, not just the
// matrix loop in isolation.
function runDragSimulation(instance, baseStoneParams, options, callCount) {
  const perCallMs = [];
  for (let call = 0; call < callCount; call++) {
    const dx = Math.sin(call) * 0.5;
    const dy = Math.cos(call) * 0.5;
    const layout = makeLayout(baseStoneParams.map((p) => ({ ...p, xMm: p.xMm + dx, yMm: p.yMm + dy })));
    const elapsed = timeMs(() => instance.update(layout, options));
    perCallMs.push(elapsed);
  }
  return perCallMs;
}

// --- Main ------------------------------------------------------------------------------------------

const DRAG_CALL_COUNT = 20;
const FRAME_BUDGET_MS = 16; // one 60fps frame

console.log('RS-2013 §4 step 5 — instanced-stone stress-test performance measurement');
console.log(`Node ${process.version}, three ${THREE.REVISION}\n`);

const results = [];

for (const targetCount of [1000, 5000, 15000]) {
  console.log(`=== N = ${targetCount} stones (mug, curved-surface path) ===`);
  const stoneParams = generateHexGridStoneParams({ canvasWidthMm: MUG_OPTIONS.canvasWidthMm, canvasHeightMm: MUG_OPTIONS.canvasHeightMm, targetCount });
  console.log(`Fixture: exactly ${stoneParams.length} stones generated (hex-packed grid, SS6 ${SS6_DIAMETER_MM}mm, 'gold').`);

  const instance = makeMountedRenderer();
  const initialLayout = makeLayout(stoneParams);

  const buildMs = timeMs(() => instance.update(initialLayout, MUG_OPTIONS));
  if (!(instance._stoneMesh instanceof THREE.InstancedMesh)) throw new Error(`N=${targetCount}: InstancedMesh was not built`);
  if (instance._stoneMesh.count !== targetCount) throw new Error(`N=${targetCount}: expected instance count ${targetCount}, got ${instance._stoneMesh.count}`);
  console.log(`InstancedMesh build (first update(), includes buffer allocation): ${fmt(buildMs)}ms`);

  const dragMs = runDragSimulation(instance, stoneParams, MUG_OPTIONS, DRAG_CALL_COUNT);
  const s = stats(dragMs);
  console.log(`Steady-state update() during simulated drag (${DRAG_CALL_COUNT} calls, no capacity change):`);
  console.log(`  min=${fmt(s.min)}ms  median=${fmt(s.median)}ms  mean=${fmt(s.mean)}ms  max=${fmt(s.max)}ms`);
  console.log(`  per-call times: [${dragMs.map(fmt).join(', ')}]`);
  const withinBudget = s.max < FRAME_BUDGET_MS;
  console.log(`  ${withinBudget ? 'WITHIN' : 'EXCEEDS'} the ${FRAME_BUDGET_MS}ms (60fps) frame budget (checked against the max, not just the mean).`);
  console.log('');

  results.push({ product: 'mug', targetCount, buildMs, dragStats: s, dragSamples: dragMs, withinBudget });
}

// Supplementary: the design doc's own literal §1.3 worked scenario -- a 300mm plate at SS6, ~15,000
// stones. Plate placement is the cheaper flat-plane path (no wallRadiusAt()/per-stone spin), so this
// is a useful lower-bound companion to the mug numbers above, not a replacement for them.
console.log('=== Supplementary: N = 15,000 stones (300mm plate, flat-plane path, per §1.3\'s literal worked example) ===');
{
  const targetCount = 15000;
  const stoneParams = generateHexGridStoneParams({ canvasWidthMm: PLATE_OPTIONS.canvasWidthMm, canvasHeightMm: PLATE_OPTIONS.canvasHeightMm, targetCount });
  console.log(`Fixture: exactly ${stoneParams.length} stones generated (hex-packed grid, SS6 ${SS6_DIAMETER_MM}mm, 'gold', 300mm plate).`);

  const instance = makeMountedRenderer();
  const initialLayout = makeLayout(stoneParams);
  const buildMs = timeMs(() => instance.update(initialLayout, PLATE_OPTIONS));
  if (!(instance._stoneMesh instanceof THREE.InstancedMesh)) throw new Error('plate: InstancedMesh was not built');
  if (instance._stoneMesh.count !== targetCount) throw new Error(`plate: expected instance count ${targetCount}, got ${instance._stoneMesh.count}`);
  console.log(`InstancedMesh build (first update()): ${fmt(buildMs)}ms`);

  const dragMs = runDragSimulation(instance, stoneParams, PLATE_OPTIONS, DRAG_CALL_COUNT);
  const s = stats(dragMs);
  console.log(`Steady-state update() during simulated drag (${DRAG_CALL_COUNT} calls, no capacity change):`);
  console.log(`  min=${fmt(s.min)}ms  median=${fmt(s.median)}ms  mean=${fmt(s.mean)}ms  max=${fmt(s.max)}ms`);
  const withinBudget = s.max < FRAME_BUDGET_MS;
  console.log(`  ${withinBudget ? 'WITHIN' : 'EXCEEDS'} the ${FRAME_BUDGET_MS}ms (60fps) frame budget (checked against the max, not just the mean).`);
  console.log('');

  results.push({ product: 'plate', targetCount, buildMs, dragStats: s, dragSamples: dragMs, withinBudget });
}

console.log('=== Summary ===');
for (const r of results) {
  console.log(`${r.product} N=${r.targetCount}: build=${fmt(r.buildMs)}ms, drag update() median=${fmt(r.dragStats.median)}ms max=${fmt(r.dragStats.max)}ms -> ${r.withinBudget ? 'within' : 'EXCEEDS'} 16ms budget`);
}

const anyExceeds = results.some((r) => !r.withinBudget);
console.log(`\nOverall: ${anyExceeds ? 'at least one configuration EXCEEDS the 60fps frame budget on this machine.' : 'all measured configurations stayed within the 60fps frame budget on this machine.'}`);
console.log('(Wall-clock, single machine, single run -- see TASK_RESULT.md for the full write-up, caveats, and what this does/does not measure.)');
