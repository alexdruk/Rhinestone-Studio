// MONO-014 visual verification -- generates the three documented screenshots.
// Needs `python3 -m http.server 5173` running from the repo root.
import { chromium } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';

const OUT = 'docs/screenshots/mono-014';
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function scenario(name, configure) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto('http://localhost:5173/index.html');
  await page.waitForTimeout(1200);

  // Clear the default "Vitalina" text layer -> deleteLayer() replaces the last layer with a blank
  // (empty-text) one, which renders no stones, so the screenshot shows only the monogram.
  await page.click('#deleteSelected');
  await page.waitForTimeout(300);

  await page.click('#menuMonogram');
  await page.waitForTimeout(400);

  // Great Vibes, SS6 letters, gold, "A", single
  await page.selectOption('#monogramFont', 'great-vibes-regular');
  await page.dispatchEvent('#monogramFont', 'change');
  await page.selectOption('#monogramLayout', 'single');
  await page.dispatchEvent('#monogramLayout', 'change');
  await page.fill('#monogramLetters', 'A');
  await page.dispatchEvent('#monogramLetters', 'input');
  await page.selectOption('#monogramStoneSize', '2');
  await page.dispatchEvent('#monogramStoneSize', 'change');
  await page.selectOption('#monogramColor', 'gold');
  await page.dispatchEvent('#monogramColor', 'change');
  await page.waitForTimeout(150);

  await configure(page);
  await page.waitForTimeout(150);

  const frame = await page.inputValue('#monogramFrame');
  const toggle = await page.isChecked('#monogramFrameStoneToggle');
  await page.click('#monogramGenerate');
  await page.waitForTimeout(1000);
  const status = (await page.textContent('#status'))?.trim();
  console.log(`${name}: frame=${frame} toggle=${toggle} status="${status}"`);

  await page.locator('#layout').screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
}

// 1. No frame
await scenario('none', async (page) => {
  await page.selectOption('#monogramFrame', 'none');
  await page.dispatchEvent('#monogramFrame', 'change');
});

// 2. Circle at automatic hierarchy (toggle unchecked -> one rung above SS6 == SS10 ring)
await scenario('circle-auto', async (page) => {
  if (await page.isChecked('#monogramFrameStoneToggle')) {
    await page.click('#monogramFrameStoneToggle');
    await page.dispatchEvent('#monogramFrameStoneToggle', 'change');
  }
  await page.selectOption('#monogramFrame', 'circle');
  await page.dispatchEvent('#monogramFrame', 'change');
});

// 3. Circle forced to SS6 via the checked toggle -- the equal-weight control image
await scenario('circle-equal', async (page) => {
  await page.selectOption('#monogramFrame', 'circle');
  await page.dispatchEvent('#monogramFrame', 'change');
  if (!(await page.isChecked('#monogramFrameStoneToggle'))) {
    await page.click('#monogramFrameStoneToggle');
    await page.dispatchEvent('#monogramFrameStoneToggle', 'change');
  }
  await page.selectOption('#monogramFrameStoneSize', '2');
  await page.dispatchEvent('#monogramFrameStoneSize', 'change');
  await page.selectOption('#monogramFrameColor', 'gold');
  await page.dispatchEvent('#monogramFrameColor', 'change');
});

await browser.close();
console.log('done');
