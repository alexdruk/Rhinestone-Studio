// RS-3011 Step 3a verification: stoneSize/gap/color fields (sharedStoneFields) relocate into
// #designToolOptionsPanel's #designStoneSlot while Design is active with exactly one 'path' layer
// selected, via the same relocateFieldGroups()/FIELD_GROUPS mechanism the Lightboxes already use.
// Same chromium.launch({channel:'chrome'}) + screenshot pattern as
// tools/rs-3011-step1-verification-screenshots/verify.mjs.
//
// Design-drawn shapes are stroke-only (no fill) -- DrawingCanvasTool.js's hitTestShapeId() uses
// paper.project.hitTest({fill:true, stroke:true, tolerance:...}), which only matches clicks near
// the actual outline, never a shape's interior. Every click meant to select/hit a shape below
// targets a point on its boundary (computed from debugShapes' bounds), not its center -- confirmed
// against window.__drawingTool.debugHitTestShapeId(xMm,yMm) before use, same RS-3010 Step 2e
// verification convention (debugProjectToViewPx) this file's siblings already established.
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173/index.html';
const DIR = 'tools/rs-3011-step3a-verification-screenshots';

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} -- ${detail}`);
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(BASE_URL);
  await page.waitForSelector('#menuDesign');

  // ---- Enter Design mode and draw two rectangles (second one used for the multi-select case) ----
  await page.click('#menuDesign');
  await page.waitForFunction(() => window.__drawingTool && window.__drawingTool.isActive);
  await page.click('#railRectToggle');
  const box = await page.locator('#layout').boundingBox();
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 400);
  await page.mouse.up();
  await page.mouse.move(box.x + 550, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 300);
  await page.mouse.up();

  const shapes = await page.evaluate(() => window.__drawingTool.debugShapes);
  const [shapeA, shapeB] = shapes;
  console.log('DEBUG shapes:', JSON.stringify(shapes));

  async function clickEdge(shape) {
    // Midpoint of the shape's top edge -- always on the stroke, regardless of shape size.
    const xMm = shape.bounds.left + shape.bounds.width / 2;
    const yMm = shape.bounds.top;
    const hit = await page.evaluate(([x, y]) => window.__drawingTool.debugHitTestShapeId(x, y), [xMm, yMm]);
    if (hit !== shape.id) throw new Error(`edge point (${xMm},${yMm}) did not hit ${shape.id}, got ${hit}`);
    const px = await page.evaluate(([x, y]) => window.__drawingTool.debugProjectToViewPx(x, y), [xMm, yMm]);
    const canvasBox = await page.locator('#layout').boundingBox();
    return { x: canvasBox.x + px.x, y: canvasBox.y + px.y };
  }
  async function emptyPoint(xMm, yMm) {
    const hit = await page.evaluate(([x, y]) => window.__drawingTool.debugHitTestShapeId(x, y), [xMm, yMm]);
    if (hit !== null) throw new Error(`expected empty point (${xMm},${yMm}) to hit nothing, got ${hit}`);
    const px = await page.evaluate(([x, y]) => window.__drawingTool.debugProjectToViewPx(x, y), [xMm, yMm]);
    const canvasBox = await page.locator('#layout').boundingBox();
    const abs = { x: canvasBox.x + px.x, y: canvasBox.y + px.y };
    const elAt = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}#${e.id}` : null; }, [abs.x, abs.y]);
    console.log(`DEBUG emptyPoint mm(${xMm},${yMm}) -> px(${abs.x},${abs.y}), canvasBox=${JSON.stringify(canvasBox)}, elementFromPoint=${elAt}`);
    return abs;
  }

  await page.click('#railSelectToggle');
  const ptA = await clickEdge(shapeA);
  await page.mouse.click(ptA.x, ptA.y);
  await page.waitForTimeout(200);
  const summaryAfterSelect = await page.locator('#selectionSummary').innerText();
  report('setup: clicking shape A\'s edge selects it', summaryAfterSelect === '1 layer selected', `summary="${summaryAfterSelect}"`);

  // ==================== (1) fields visible in #designToolOptionsPanel ====================
  const stoneFieldsParent = await page.evaluate(() => document.getElementById('sharedStoneFields').parentElement.id);
  report('1. #sharedStoneFields relocated into #designStoneSlot (inside #designToolOptionsPanel)', stoneFieldsParent === 'designStoneSlot', `parent id = ${stoneFieldsParent}`);

  const stoneSizeVisibleInPanel = await page.locator('#designToolOptionsPanel #stoneSize').isVisible().catch(() => false);
  report('1b. #stoneSize is visible inside #designToolOptionsPanel', stoneSizeVisibleInPanel, `visible=${stoneSizeVisibleInPanel}`);

  const inspectorStoneSlotEmpty = await page.evaluate(() => document.getElementById('inspectorStoneSlot').children.length === 0);
  report('1c. #inspectorStoneSlot (Inspector home) is empty while relocated', inspectorStoneSlotEmpty, `empty=${inspectorStoneSlotEmpty}`);

  await page.screenshot({ path: `${DIR}/01-stone-fields-in-design-tool-options-panel.png` });
  const panelBox = await page.locator('#panel2D').boundingBox();
  await page.screenshot({ path: `${DIR}/01b-panel2D-closeup.png`, clip: panelBox });

  // ==================== (2) changing stoneSize there updates stone count ====================
  const statsBefore = await page.locator('#layoutStats').innerText();
  const optionValues = await page.locator('#designToolOptionsPanel #stoneSize option').evaluateAll(opts => opts.map(o => o.value));
  const currentVal = await page.locator('#designToolOptionsPanel #stoneSize').inputValue();
  const currentIdx = optionValues.indexOf(currentVal);
  const targetIdx = currentIdx === optionValues.length - 1 ? 0 : optionValues.length - 1;
  await page.selectOption('#designToolOptionsPanel #stoneSize', optionValues[targetIdx]);
  await page.waitForTimeout(300);
  const statsAfter = await page.locator('#layoutStats').innerText();

  report(
    '2. changing #stoneSize inside #designToolOptionsPanel regenerates the layout (stone count changes)',
    statsBefore !== statsAfter,
    `before="${statsBefore.split('\n')[0]}" after="${statsAfter.split('\n')[0]}" (stoneSize ${currentVal} -> ${optionValues[targetIdx]})`
  );
  await page.screenshot({ path: `${DIR}/02-stone-count-updated-after-change-in-panel.png` });

  // ==================== (3a) deselecting returns fields to Inspector home ====================
  const empty1 = await emptyPoint(shapeA.bounds.left + shapeA.bounds.width / 2, shapeA.bounds.top + shapeA.bounds.height + 100);
  await page.mouse.click(empty1.x, empty1.y);
  await page.waitForTimeout(200);
  const summaryAfterDeselect = await page.locator('#selectionSummary').innerText();
  const parentAfterDeselect = await page.evaluate(() => document.getElementById('sharedStoneFields').parentElement.id);
  report('3a. deselecting returns #sharedStoneFields to #inspectorStoneSlot', parentAfterDeselect === 'inspectorStoneSlot', `parent id = ${parentAfterDeselect}, summary="${summaryAfterDeselect}"`);
  const designSlotEmptyAfterDeselect = await page.evaluate(() => document.getElementById('designStoneSlot').children.length === 0);
  report('3a-2. #designStoneSlot is empty after deselecting', designSlotEmptyAfterDeselect, `empty=${designSlotEmptyAfterDeselect}`);
  await page.screenshot({ path: `${DIR}/03a-deselected-fields-back-in-inspector.png` });

  // ==================== (3b) re-select A, then shift-click B to force multi-select ====================
  const ptA2 = await clickEdge(shapeA);
  await page.mouse.click(ptA2.x, ptA2.y);
  await page.waitForTimeout(150);
  const parentAfterReselect = await page.evaluate(() => document.getElementById('sharedStoneFields').parentElement.id);
  report('3b-setup. re-selecting shape A alone relocates fields back into Design panel', parentAfterReselect === 'designStoneSlot', `parent id = ${parentAfterReselect}`);

  const ptB = await clickEdge(shapeB);
  await page.keyboard.down('Shift');
  await page.mouse.click(ptB.x, ptB.y);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(200);
  const summaryAfterMultiSelect = await page.locator('#selectionSummary').innerText();
  const parentAfterMultiSelect = await page.evaluate(() => document.getElementById('sharedStoneFields').parentElement.id);
  report('3b. multi-selecting (shift-click, 2 shapes) returns #sharedStoneFields to #inspectorStoneSlot', parentAfterMultiSelect === 'inspectorStoneSlot', `parent id = ${parentAfterMultiSelect}, summary="${summaryAfterMultiSelect}"`);
  await page.screenshot({ path: `${DIR}/03b-multiselect-fields-back-in-inspector.png` });

  // ==================== (3c) exiting Design returns fields home, panel gone ====================
  // A plain click on a shape already part of the current multi-selection preserves the whole
  // group (DrawingCanvasTool.js's own documented convention, matching app.js's main-canvas
  // pointerdown handler) -- clear via an empty-canvas click first to get back to a clean
  // single-selection, rather than assuming a plain click on A alone collapses the pair.
  const empty2 = await emptyPoint(shapeA.bounds.left + shapeA.bounds.width / 2, shapeA.bounds.top + shapeA.bounds.height + 100);
  await page.mouse.click(empty2.x, empty2.y);
  await page.waitForTimeout(150);
  const ptA3 = await clickEdge(shapeA);
  await page.mouse.click(ptA3.x, ptA3.y); // back to single selection (shape A alone)
  await page.waitForTimeout(150);
  const parentBeforeExit = await page.evaluate(() => document.getElementById('sharedStoneFields').parentElement.id);
  report('3c-setup. single-select again before exiting Design', parentBeforeExit === 'designStoneSlot', `parent id = ${parentBeforeExit}`);

  await page.click('#menuDesign'); // exit Design
  await page.waitForFunction(() => window.__drawingTool && !window.__drawingTool.isActive);
  await page.waitForTimeout(200);
  const parentAfterExit = await page.evaluate(() => document.getElementById('sharedStoneFields').parentElement.id);
  report('3c. exiting Design returns #sharedStoneFields to #inspectorStoneSlot', parentAfterExit === 'inspectorStoneSlot', `parent id = ${parentAfterExit}`);
  const panelDisplayAfterExit = await page.locator('#designToolOptionsPanel').evaluate(elm => getComputedStyle(elm).display);
  report('3c-2. #designToolOptionsPanel is hidden after exiting Design', panelDisplayAfterExit === 'none', `display=${panelDisplayAfterExit}`);
  await page.screenshot({ path: `${DIR}/03c-design-exited-fields-back-in-inspector.png` });

  await browser.close();

  console.log('\n--- Summary ---');
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.name}`);
  if (failed.length) {
    console.log(`\n${failed.length} scenario(s) FAILED.`);
    process.exit(1);
  } else {
    console.log('\nAll scenarios PASSED.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
