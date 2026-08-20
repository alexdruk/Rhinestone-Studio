// Diagnostic-only (Issue C): does the Stone Size overlap guard show any warning for a shape whose
// real generated output is visibly sparse/bad? Drives the real app via Playwright, adds a Rectangle
// and a Capsule from the Shapes lightbox, sets small dimensions + a stone size known (from direct
// GeometryEngine testing) to produce few/sparse stones, then reads #stoneSize's className and
// #stoneSizeOverlapWarning's state directly.
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173/index.html';

function log(label, value) {
  console.log(`\n=== ${label} ===`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

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

  // Select the stone size option closest to stoneSizeMm.
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
    return {
      stoneSizeClassName: select.className,
      warningVisible: warning.classList.contains('visible'),
      warningText: warning.textContent
    };
  });
}

async function readStoneCount(page) {
  return page.evaluate(() => window.__drawingTool?.lastStoneCount ?? document.querySelectorAll('#layout circle, #layout .stone').length);
}

async function main(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.__drawingTool, null, { timeout: 15000 });
  await page.waitForSelector('#railRectToggle', { state: 'visible' });

  // --- Rect: extreme thin rectangle (40x2mm), SS30/gap0.3 -- known post-fix to merge both short
  // sides into single stones (correct now), but still a small/degenerate shape worth checking.
  const rectSizeUsed = await addShapeAndConfigure(page, 'rectangle', { widthMm: 40, heightMm: 2, stoneSizeMm: 6.4, gapMm: 0.3 });
  const rectGuard = await readGuardState(page);
  log('Rect 40x2mm SS30/gap0.3 -- stoneSize option used', rectSizeUsed);
  log('Rect guard state', rectGuard);

  // --- Capsule: small sparse case (6x3mm, SS10-ish 2.8mm, gap0) -- 7 stones, sparse per direct testing.
  const capSizeUsed = await addShapeAndConfigure(page, 'capsule', { widthMm: 6, heightMm: 3, stoneSizeMm: 1.5, gapMm: 0 });
  const capGuard = await readGuardState(page);
  log('Capsule 6x3mm ss~1.5/gap0 -- stoneSize option used', capSizeUsed);
  log('Capsule guard state', capGuard);

  // --- Ellipse: small case, for completeness (task mentions Ellipse alongside Capsule).
  const ellSizeUsed = await addShapeAndConfigure(page, 'ellipse', { widthMm: 6, heightMm: 3, stoneSizeMm: 2, gapMm: 0.2 });
  const ellGuard = await readGuardState(page);
  log('Ellipse 6x3mm ss~2/gap0.2 -- stoneSize option used', ellSizeUsed);
  log('Ellipse guard state', ellGuard);

  await page.waitForTimeout(500);
  await page.screenshot({ path: '/Users/alex/Documents/rhinestone-studio/tools/scratch/diag-corner-anchoring-followup/three-shapes.png', fullPage: false });
}

const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  await main(browser);
} finally {
  await browser.close();
}
