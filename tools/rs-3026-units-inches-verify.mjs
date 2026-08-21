import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173/index.html';

function log(section, msg) {
  console.log(`[${section}] ${msg}`);
}

async function getScaleBarState(page) {
  return page.evaluate(() => {
    const bar = document.getElementById('scaleBar');
    const track = document.getElementById('scaleBarTrack');
    const label = document.getElementById('scaleBarLabel');
    return {
      display: getComputedStyle(bar).display,
      trackWidthPx: track.style.width,
      labelText: label.textContent,
      drawingIsActive: window.__drawingTool ? window.__drawingTool.isActive : null,
      pxPerMm: window.__drawingTool ? window.__drawingTool.pxPerMm : null
    };
  });
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(BASE_URL);
  await page.waitForTimeout(500);

  // Enter Design mode first (mm units, default)
  await page.click('#menuDesign');
  await page.waitForTimeout(400);
  let state = await getScaleBarState(page);
  log('design-entry-mm', JSON.stringify(state));
  await page.screenshot({ path: '/tmp/rs3026-units-01-design-entry-mm.png' });

  // Open Settings and switch Units to Inches WHILE Design mode is active
  await page.click('#menuSettings');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/rs3026-units-02-settings-open.png' });
  await page.selectOption('#settingsUnits', 'in');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  let afterUnitsSwitch = await getScaleBarState(page);
  log('after-switch-to-inches-no-interaction', JSON.stringify(afterUnitsSwitch));
  await page.screenshot({ path: '/tmp/rs3026-units-03-after-switch-to-inches.png' });

  // Now nudge zoom slightly to see if that's what actually refreshes it
  const canvasBox = await page.evaluate(() => {
    const c = document.getElementById('layout');
    const r = c.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(canvasBox.x, canvasBox.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -10);
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);
  let afterTinyZoom = await getScaleBarState(page);
  log('after-tiny-zoom-post-switch', JSON.stringify(afterTinyZoom));
  await page.screenshot({ path: '/tmp/rs3026-units-04-after-tiny-zoom.png' });

  // Zoom in further, confirm inches value updates
  await page.keyboard.down('Control');
  for (let i = 0; i < 15; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);
  let zoomedIn = await getScaleBarState(page);
  log('zoomed-in-inches', JSON.stringify(zoomedIn));
  await page.screenshot({ path: '/tmp/rs3026-units-05-zoomed-in-inches.png' });

  // Zoom out, confirm inches value updates
  await page.keyboard.down('Control');
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 100);
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);
  let zoomedOut = await getScaleBarState(page);
  log('zoomed-out-inches', JSON.stringify(zoomedOut));
  await page.screenshot({ path: '/tmp/rs3026-units-06-zoomed-out-inches.png' });

  // Switch back to mm WHILE still in Design mode
  await page.click('#menuSettings');
  await page.waitForTimeout(300);
  await page.selectOption('#settingsUnits', 'mm');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  let backToMm = await getScaleBarState(page);
  log('back-to-mm-no-interaction', JSON.stringify(backToMm));
  await page.screenshot({ path: '/tmp/rs3026-units-07-back-to-mm.png' });

  await page.click('#menuText');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
} finally {
  await browser.close();
}
