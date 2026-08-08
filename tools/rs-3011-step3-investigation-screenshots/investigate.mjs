// RS-3011 Step 3 pre-scoping investigation (NOT an implementation verification -- no code changed
// this session). Answers three questions about current app.js/index.html behavior with real
// browser interaction, following the same chromium.launch({channel:'chrome'}) + screenshot pattern
// as tools/rs-3011-step1-verification-screenshots/verify.mjs:
//
// 1. Does the right Inspector already show live, editable stoneSize/gap/color fields for a
//    Design-drawn shape while Design is active, and does editing stoneSize actually change the
//    generated layout (stone count)?
// 2. Does the Design canvas (Paper.js) ever render actual stone dots, or only the vector outline --
//    with real stone rendering only visible once Design mode is exited back to the 2D Canvas?
// 3. What does #designToolOptionsPanel actually contain while a shape is selected in Design?
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173/index.html';
const DIR = 'tools/rs-3011-step3-investigation-screenshots';

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'INFO' : 'FLAG'}] ${name} -- ${detail}`);
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(BASE_URL);
  await page.waitForSelector('#menuDesign');

  // ---- Enter Design mode and draw a rectangle shape ----
  await page.click('#menuDesign');
  await page.waitForFunction(() => window.__drawingTool && window.__drawingTool.isActive);

  await page.click('#railRectToggle');
  const box = await page.locator('#layout').boundingBox();
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 400);
  await page.mouse.up();

  // Switch to select tool and click the shape to make sure it's selected (drawing a shape may or
  // may not auto-select it -- select explicitly either way so selection state is unambiguous).
  await page.click('#railSelectToggle');
  await page.mouse.click(box.x + 325, box.y + 300);
  await page.waitForTimeout(200);

  const selectedLayerType = await page.evaluate(() => {
    const sel = document.getElementById('selectedLayer');
    return sel ? sel.value : null;
  });
  report('setup: a layer is selected after clicking the drawn rect', !!selectedLayerType, `selectedLayer value=${selectedLayerType}`);

  // ==================== Q3 first (cheapest, informs the others) ====================
  const toolOptionsPanelHTML = await page.locator('#designToolOptionsPanel').innerHTML();
  const toolOptionsPanelVisibleText = await page.locator('#designToolOptionsPanel').innerText().catch(() => '');
  report('Q3: #designToolOptionsPanel innerHTML while shape selected', true, toolOptionsPanelHTML.replace(/\s+/g, ' ').trim());
  report('Q3: #designToolOptionsPanel visible text', true, JSON.stringify(toolOptionsPanelVisibleText));
  await page.screenshot({ path: `${DIR}/03-design-tool-options-panel-with-shape-selected.png` });

  // ==================== Q1: Inspector stoneSize/gap/color fields ====================
  const stoneFieldsParentId = await page.evaluate(() => {
    const f = document.getElementById('sharedStoneFields');
    return f && f.parentElement ? f.parentElement.id : null;
  });
  report('Q1: #sharedStoneFields (stoneSize/gap/color) currently lives inside', true, `parent id = ${stoneFieldsParentId}`);

  const stoneSizeVisible = await page.locator('#stoneSize').isVisible();
  const stoneSizeEnabled = await page.locator('#stoneSize').isEnabled();
  report('Q1: #stoneSize select is visible+enabled while Design active with shape selected', stoneSizeVisible && stoneSizeEnabled, `visible=${stoneSizeVisible} enabled=${stoneSizeEnabled}`);

  await page.screenshot({ path: `${DIR}/01a-inspector-stone-fields-before-change.png` });

  const statsBefore = await page.locator('#layoutStats').innerText();
  const stoneSizeOptionsBefore = await page.locator('#stoneSize').inputValue();
  const stoneSizeOptions = await page.locator('#stoneSize option').allTextContents();

  // Pick a different (larger) stone size option than whatever is currently selected.
  const optionValues = await page.locator('#stoneSize option').evaluateAll(opts => opts.map(o => o.value));
  const currentIdx = optionValues.indexOf(stoneSizeOptionsBefore);
  const targetIdx = currentIdx === optionValues.length - 1 ? 0 : optionValues.length - 1;
  await page.selectOption('#stoneSize', optionValues[targetIdx]);
  await page.waitForTimeout(300);

  const statsAfter = await page.locator('#layoutStats').innerText();
  const stoneSizeAfter = await page.locator('#stoneSize').inputValue();

  report(
    'Q1: changing #stoneSize while Design active regenerates the layout (total stone count changes)',
    statsBefore !== statsAfter,
    `before="${statsBefore}" | after="${statsAfter}" | stoneSize ${stoneSizeOptionsBefore} -> ${stoneSizeAfter}`
  );
  await page.screenshot({ path: `${DIR}/01b-inspector-stone-fields-after-change.png` });

  // ==================== Q2: Design canvas vs 2D Canvas stone rendering ====================
  // Check whether the workspace-view tab row (Dual Workspace/2D Canvas/Object Preview) is even
  // reachable while Design is active.
  const viewTabsDisplay = await page.locator('#workspaceViewTabs').evaluate(el => getComputedStyle(el).display);
  report('Q2: #workspaceViewTabs (Dual/2D/Preview switcher) display while Design is active', true, `display=${viewTabsDisplay}`);

  // Screenshot the Design canvas itself (Paper.js scene) with the shape selected and its stone
  // fields set from Q1 above.
  await page.screenshot({ path: `${DIR}/02a-design-canvas-with-shape-selected.png` });

  // Zoomed crop of just the canvas panel for a closer look at whether any stone dots are drawn.
  const canvasBox = await page.locator('#panel2D').boundingBox();
  await page.screenshot({ path: `${DIR}/02b-design-canvas-panel-only.png`, clip: canvasBox });

  // Now exit Design mode -- same project/layers, same selection -- and screenshot the 2D Canvas
  // rendering of the identical shape for comparison.
  await page.click('#menuDesign');
  await page.waitForFunction(() => window.__drawingTool && !window.__drawingTool.isActive);
  await page.waitForTimeout(200);

  const viewTabsDisplayAfterExit = await page.locator('#workspaceViewTabs').evaluate(el => getComputedStyle(el).display);
  report('Q2: #workspaceViewTabs display after exiting Design', true, `display=${viewTabsDisplayAfterExit}`);

  await page.screenshot({ path: `${DIR}/02c-2d-canvas-after-exiting-design-same-shape.png` });

  const canvasBox2 = await page.locator('#panel2D').boundingBox();
  await page.screenshot({ path: `${DIR}/02d-2d-canvas-panel-only-after-exit.png`, clip: canvasBox2 });

  // If Dual Workspace is reachable outside Design mode, also grab that for completeness.
  const dualTabVisible = await page.locator('#viewTabDual').isVisible();
  if (dualTabVisible) {
    await page.click('#viewTabDual');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${DIR}/02e-dual-workspace-after-exiting-design.png` });
  }
  report('Q2: Dual Workspace tab reachable after exiting Design', dualTabVisible, `visible=${dualTabVisible}`);

  await browser.close();

  console.log('\n--- Summary ---');
  for (const r of results) console.log(`${r.ok ? 'INFO' : 'FLAG'}: ${r.name} :: ${r.detail}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
