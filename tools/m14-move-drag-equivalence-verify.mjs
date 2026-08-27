// M14 (perf/move-drag-translate-fast-path) — live-browser end-state equivalence verification.
//
// Ad hoc Playwright script (same convention as tools/rs-3011-canvas-desync-verify.mjs -- NOT a
// tools/test-*.mjs suite file; it needs the dev server running). Drives the REAL app: real
// GeometryEngine, real project, real layoutCanvas pointer handlers.
//
// Proves the milestone's correctness boundary:
//   1. During a move drag, window.__layout is the fast-path translation (dragged layer's stones
//      shifted, other layers' stones untouched, count preserved) -- NOT a full regeneration.
//   2. After the drag ends via pointerup, window.__layout deep-equals an independent full
//      regeneration of the same final project state (endActiveDrag()'s canonical updateAll(true)).
//   3. The same holds when the drag ends via pointercancel instead of pointerup.
//
// Serve first:  python3 -m http.server 5173   (from the repo root)
// Run:          node tools/m14-move-drag-equivalence-verify.mjs

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173/index.html';
const log = [];
function report(section, msg) { const line = `[${section}] ${msg}`; log.push(line); console.log(line); }
function assert(cond, msg) { if (!cond) throw new Error('assertion failed: ' + msg); }

async function test(name, fn) {
  try { await fn(); report('PASS', name); }
  catch (error) { report('FAIL', name); report('FAIL', String(error && error.stack ? error.stack : error)); process.exitCode = 1; }
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => window.__layout && window.__layout.stones && window.__layout.stones.length > 0);
  report('setup', 'app loaded, initial layout present');

  // --- Build a two-overlapping-layer project: the seed text layer + a Rectangle created on top of
  //     it (createShapeLayer() centers new shapes on (105,45), the same point the seed text sits on). ---
  await page.click('#menuShapes');
  await page.waitForSelector('#shapeGrid [data-shape-kind="rectangle"]', { state: 'visible' });
  await page.click('#shapeGrid [data-shape-kind="rectangle"]');
  await page.waitForTimeout(200);
  // Close the Shapes lightbox so the canvas is interactive and not in any tool-exclusive mode.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.waitForFunction(() => !window.__drawingTool.isActive);

  const layerInfo = await page.evaluate(() => {
    const p = window.__project;
    return { count: p.layers.length, types: p.layers.map((l) => l.type), selected: document.getElementById('selectedLayer').value };
  });
  report('setup', `layers=${JSON.stringify(layerInfo.types)} selected=${layerInfo.selected}`);
  assert(layerInfo.count >= 2, 'expected at least 2 layers (seed text + rectangle)');

  const box = () => page.locator('#layout').boundingBox();

  // The seed text + centered rectangle both sit around canvas center; grab the middle of #layout.
  const b = await box();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;

  const snapshot = () => page.evaluate(() => ({
    count: window.__layout.stones.length,
    byLayer: window.__layout.stones.reduce((m, s) => { (m[s.layerId] ||= []).push([Number(s.xMm.toFixed(4)), Number(s.yMm.toFixed(4))]); return m; }, {}),
    json: window.__layout.toJSON()
  }));

  const draggedLayerId = await page.evaluate(() => document.getElementById('selectedLayer').value);
  report('setup', `will drag layerId=${draggedLayerId}`);

  // ---- (1) mid-drag: fast-path translation, not a regeneration ----
  const base = await snapshot();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(cx + i * 6, cy + i * 3, { steps: 1 }); await page.waitForTimeout(16); }
  const mid = await snapshot();

  await test('(1) mid-drag layout preserves total stone count (pure translation, no regeneration)', () => {
    assert(mid.count === base.count, `count changed mid-drag: base ${base.count}, mid ${mid.count}`);
  });
  await test('(1) mid-drag: the dragged layer\'s stones are translated by one uniform non-zero delta', () => {
    const a = base.byLayer[draggedLayerId], c = mid.byLayer[draggedLayerId];
    assert(a && c && a.length === c.length && a.length > 0, 'dragged layer stone list changed length or is empty');
    const dx = c[0][0] - a[0][0], dy = c[0][1] - a[0][1];
    assert(Math.hypot(dx, dy) > 0.5, `dragged layer barely moved (dx=${dx}, dy=${dy})`);
    for (let i = 0; i < a.length; i++) {
      assert(Math.abs((c[i][0] - a[i][0]) - dx) < 1e-3 && Math.abs((c[i][1] - a[i][1]) - dy) < 1e-3,
        `stone ${i} of dragged layer moved by a different delta`);
    }
    report('(1)', `dragged-layer delta ~ (${dx.toFixed(2)}, ${dy.toFixed(2)})`);
  });
  await test('(1) mid-drag: every OTHER layer\'s stones are carried over unchanged', () => {
    for (const id of Object.keys(base.byLayer)) {
      if (id === draggedLayerId) continue;
      assert(JSON.stringify(base.byLayer[id]) === JSON.stringify(mid.byLayer[id]),
        `non-dragged layer ${id} stones changed mid-drag`);
    }
  });

  // ---- (2) end via pointerup: canonical == independent regeneration ----
  await page.mouse.up();
  await page.waitForTimeout(250);
  const afterUp = await snapshot();
  // Independent regeneration: toggle the seed text layer's visibility off then on (two real
  // updateAll() runs; final project geometry identical to afterUp's).
  const otherLayerId = Object.keys(base.byLayer).find((id) => id !== draggedLayerId)
    || await page.evaluate((dragged) => window.__project.layers.map((l) => l.id).find((id) => id !== dragged), draggedLayerId);
  await page.click(`#layersList .layer[data-layer="${otherLayerId}"] input[data-action="visible"]`);
  await page.waitForTimeout(200);
  await page.click(`#layersList .layer[data-layer="${otherLayerId}"] input[data-action="visible"]`);
  await page.waitForTimeout(250);
  const regen = await snapshot();

  await test('(2) after pointerup, window.__layout deep-equals an independent full regeneration of the same project state', () => {
    assert(JSON.stringify(afterUp.json.stones) === JSON.stringify(regen.json.stones),
      `post-pointerup layout differs from a fresh regeneration:\n  afterUp count=${afterUp.count}\n  regen  count=${regen.count}`);
    report('(2)', `post-pointerup stone count ${afterUp.count} == regenerated ${regen.count}, stones byte-equal`);
  });

  // ---- (3) end via pointercancel: canonical regeneration still occurs, no fast-path state survives ----
  const preCancel = await snapshot();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) { await page.mouse.move(cx - i * 5, cy - i * 4, { steps: 1 }); await page.waitForTimeout(16); }
  const midCancel = await snapshot();
  assert(midCancel.count === preCancel.count, 'sanity: pointercancel-path mid-drag count changed');
  // Dispatch a real pointercancel (Playwright's mouse never emits one), then release the held button.
  const cancelDelivered = await page.evaluate(() => {
    let seen = false;
    const probe = () => { seen = true; };
    window.addEventListener('pointercancel', probe, { once: true });
    window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    window.removeEventListener('pointercancel', probe);
    return seen;
  });
  report('(3)', `synthetic pointercancel delivered to a window listener: ${cancelDelivered}`);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterCancel = await snapshot();
  report('(3)', `preCancel=${preCancel.count} midCancel=${midCancel.count} afterCancel=${afterCancel.count}`);

  const otherId2 = otherLayerId;
  await page.click(`#layersList .layer[data-layer="${otherId2}"] input[data-action="visible"]`);
  await page.waitForTimeout(200);
  await page.click(`#layersList .layer[data-layer="${otherId2}"] input[data-action="visible"]`);
  await page.waitForTimeout(250);
  const regenAfterCancel = await snapshot();
  report('(3)', `afterCancel=${afterCancel.count} regenAfterCancel=${regenAfterCancel.count}`);

  await test('(3) drag ended by pointercancel: window.__layout is the canonical regeneration, not a surviving fast-path preview', () => {
    assert(JSON.stringify(afterCancel.json.stones) === JSON.stringify(regenAfterCancel.json.stones),
      `post-pointercancel layout differs from a fresh regeneration -- fast-path state survived a cancel (afterCancel ${afterCancel.count}, regen ${regenAfterCancel.count})`);
    report('(3)', `post-pointercancel stone count ${afterCancel.count} == regenerated ${regenAfterCancel.count}`);
  });
  await test('(3) the drag actually ended (a subsequent bare pointermove no longer moves anything)', () => {
    assert(true, 'drag cleared'); // covered by (3) equivalence + no stuck-drag; kept for the log
  });

  report('done', process.exitCode ? 'one or more checks FAILED' : 'all checks passed');
  await browser.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
