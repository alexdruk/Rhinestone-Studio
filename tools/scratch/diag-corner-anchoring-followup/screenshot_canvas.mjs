import { chromium } from 'playwright';
const BASE_URL = 'http://localhost:5173/index.html';

async function addShapeAndConfigure(page, shapeKind, { widthMm, heightMm, stoneSizeMm, gapMm }) {
  await page.click('#menuShapes');
  await page.waitForSelector('#lightboxShapes', { state: 'visible' });
  await page.click(`.shape-grid-btn[data-shape-kind="${shapeKind}"]`);
  await page.click('#lightboxShapes .lightbox-close');
  await page.waitForTimeout(300);
  await page.fill('#shapeW', String(widthMm));
  await page.dispatchEvent('#shapeW', 'change');
  if (await page.locator('#shapeH').count()) {
    await page.fill('#shapeH', String(heightMm));
    await page.dispatchEvent('#shapeH', 'change');
  }
  await page.fill('#gap', String(gapMm));
  await page.dispatchEvent('#gap', 'change');
  const optionValue = await page.evaluate((target) => {
    const select = document.getElementById('stoneSize');
    let best = null, bestDiff = Infinity;
    for (const opt of select.options) {
      const d = Math.abs(parseFloat(opt.value) - target);
      if (d < bestDiff) { bestDiff = d; best = opt.value; }
    }
    return best;
  }, stoneSizeMm);
  await page.selectOption('#stoneSize', optionValue);
  await page.dispatchEvent('#stoneSize', 'change');
  await page.waitForTimeout(400);
  return optionValue;
}

async function readGuardState(page) {
  return page.evaluate(() => {
    const select = document.getElementById('stoneSize');
    const warning = document.getElementById('stoneSizeOverlapWarning');
    return { stoneSizeClassName: select.className, warningVisible: warning.classList.contains('visible'), warningText: warning.textContent };
  });
}

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.__drawingTool, null, { timeout: 15000 });
await page.waitForSelector('#railRectToggle', { state: 'visible' });

await page.click('#menuShapes');
await page.waitForSelector('#lightboxShapes', {state:'visible'});
await page.click('.shape-grid-btn[data-shape-kind="rectangle"]');
await page.click('#lightboxShapes .lightbox-close');
await page.waitForTimeout(300);
await page.fill('#shapeX', '20'); await page.dispatchEvent('#shapeX','change');
await page.fill('#shapeY', '20'); await page.dispatchEvent('#shapeY','change');
await page.fill('#shapeW', '40'); await page.dispatchEvent('#shapeW','change');
await page.fill('#shapeH', '2'); await page.dispatchEvent('#shapeH','change');
await page.fill('#gap', '0.3'); await page.dispatchEvent('#gap','change');
await page.selectOption('#stoneSize', '6.4');
await page.dispatchEvent('#stoneSize', 'change');
await page.waitForTimeout(400);
const rectGuard = await readGuardState(page);

await page.click('#menuShapes');
await page.waitForSelector('#lightboxShapes', {state:'visible'});
await page.click('.shape-grid-btn[data-shape-kind="capsule"]');
await page.click('#lightboxShapes .lightbox-close');
await page.waitForTimeout(300);
await page.fill('#shapeX', '80'); await page.dispatchEvent('#shapeX','change');
await page.fill('#shapeY', '20'); await page.dispatchEvent('#shapeY','change');
await page.fill('#shapeW', '6'); await page.dispatchEvent('#shapeW','change');
await page.fill('#shapeH', '3'); await page.dispatchEvent('#shapeH','change');
await page.fill('#gap', '0'); await page.dispatchEvent('#gap','change');
await page.selectOption('#stoneSize', '2');
await page.dispatchEvent('#stoneSize', 'change');
await page.waitForTimeout(400);
const capGuard = await readGuardState(page);

console.log('rectGuard', rectGuard);
console.log('capGuard', capGuard);

await page.click('text=2D Canvas');
await page.waitForTimeout(300);
await page.screenshot({ path: '/Users/alex/Documents/rhinestone-studio/tools/scratch/diag-corner-anchoring-followup/canvas2d.png' });
await browser.close();
