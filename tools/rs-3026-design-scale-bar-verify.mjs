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
let failures = 0;

try {
  await page.goto(BASE_URL);
  await page.waitForTimeout(500);

  // Enter Design mode
  await page.click('#menuDesign');
  await page.waitForTimeout(400);
  let state = await getScaleBarState(page);
  log('enter-design', JSON.stringify(state));
  if (state.display !== 'flex') { log('FAIL', 'scale bar not visible on Design entry'); failures++; }
  if (!state.drawingIsActive) { log('FAIL', 'drawingTool not active after entering Design'); failures++; }
  if (!state.labelText || state.labelText.trim() === '') { log('FAIL', 'scale bar label empty on Design entry'); failures++; }
  await page.screenshot({ path: '/tmp/rs3026-01-design-entry.png' });

  // Zoom in via Ctrl+scroll
  const canvasBox = await page.evaluate(() => {
    const c = document.getElementById('layout');
    const r = c.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(canvasBox.x, canvasBox.y);
  for (let i = 0; i < 15; i++) {
    await page.mouse.wheel(0, -100); // deltaY negative = zoom in, with ctrlKey via keyboard modifier below
  }
  // Playwright mouse.wheel doesn't set ctrlKey directly; use CDP-level keyboard down/up around wheel
  await page.keyboard.down('Control');
  for (let i = 0; i < 15; i++) {
    await page.mouse.wheel(0, -100);
  }
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);
  const zoomedInState = await getScaleBarState(page);
  log('zoomed-in', JSON.stringify(zoomedInState));
  if (zoomedInState.trackWidthPx === state.trackWidthPx) { log('WARN', 'scale bar width unchanged after zoom-in scroll'); }
  await page.screenshot({ path: '/tmp/rs3026-02-design-zoomed-in.png' });

  // Zoom out
  await page.keyboard.down('Control');
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 100);
  }
  await page.keyboard.up('Control');
  await page.waitForTimeout(300);
  const zoomedOutState = await getScaleBarState(page);
  log('zoomed-out', JSON.stringify(zoomedOutState));
  await page.screenshot({ path: '/tmp/rs3026-03-design-zoomed-out.png' });

  // Pan via space-held drag -- bar value should stay the same as before pan
  const preP = await getScaleBarState(page);
  await page.keyboard.down(' ');
  await page.mouse.move(canvasBox.x, canvasBox.y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 80, canvasBox.y + 40, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  await page.waitForTimeout(300);
  const postP = await getScaleBarState(page);
  log('pan', JSON.stringify(postP));
  if (postP.trackWidthPx !== preP.trackWidthPx) { log('FAIL', 'scale bar width changed on pan-only gesture'); failures++; }

  // Exit Design mode -- there is no direct "exit" button; opening any top-menu Lightbox (e.g.
  // #menuText) calls setDrawMode(false) internally via revealDualWorkspaceForLightbox().
  await page.click('#menuText');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape'); // close the lightbox, leave workspace in its restored mode
  await page.waitForTimeout(300);
  const exitState = await getScaleBarState(page);
  log('exit-design', JSON.stringify(exitState));
  if (exitState.drawingIsActive) { log('FAIL', 'drawingTool still active after exiting Design'); failures++; }
  if (exitState.display !== 'flex') { log('FAIL', 'plain-canvas scale bar not visible after exit'); failures++; }
  await page.screenshot({ path: '/tmp/rs3026-04-select-mode-after-exit.png' });

  // Re-enter Design mode to confirm repeat-entry works
  await page.click('#menuDesign');
  await page.waitForTimeout(400);
  const reenterState = await getScaleBarState(page);
  log('re-enter-design', JSON.stringify(reenterState));
  if (reenterState.display !== 'flex') { log('FAIL', 'scale bar not visible on re-entry'); failures++; }
  if (!reenterState.labelText || reenterState.labelText.trim() === '') { log('FAIL', 'scale bar label empty on re-entry'); failures++; }

  // Check for collision with rails/tool-options panel
  const collision = await page.evaluate(() => {
    const bar = document.getElementById('scaleBar').getBoundingClientRect();
    const railL = document.getElementById('designToolRailLeft').getBoundingClientRect();
    const railR = document.getElementById('designToolRailRight').getBoundingClientRect();
    const opts = document.getElementById('designToolOptionsPanel').getBoundingClientRect();
    function overlap(a, b) {
      return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
    }
    return {
      overlapsRailLeft: overlap(bar, railL),
      overlapsRailRight: overlap(bar, railR),
      overlapsOptions: overlap(bar, opts)
    };
  });
  log('collision-check', JSON.stringify(collision));
  if (collision.overlapsRailLeft || collision.overlapsRailRight || collision.overlapsOptions) {
    log('FAIL', 'scale bar overlaps rail/options panel');
    failures++;
  }

  await page.click('#menuText');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); // exit again, leave app clean
} finally {
  await browser.close();
}

if (failures > 0) {
  log('RESULT', `FAIL (${failures} failures)`);
  process.exit(1);
} else {
  log('RESULT', 'PASS');
}
