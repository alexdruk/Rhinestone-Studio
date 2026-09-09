// MONO-013 visual verification -- the two documented screenshots.
// Needs `python3 -m http.server 5173` running from the repo root.
//
// Mug, SS6, gold, Great Vibes "AKL", 'script' layout, frame 'none', 150 mm frame size (the max the
// 'none' frame allows; an 80 mm frame returns CHAIN_TOO_THIN -- MONO-013 review decision), at
// interlockMm 0 and -2.3.
import { chromium } from 'playwright';
import { mkdir, rm } from 'node:fs/promises';

const OUT = 'docs/screenshots/mono-013';
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function scenario(name, interlockMm) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto('http://localhost:5173/index.html');
  await page.waitForTimeout(1200);

  await page.click('#deleteSelected');
  await page.waitForTimeout(300);

  await page.click('#menuMonogram');
  await page.waitForTimeout(400);

  await page.selectOption('#monogramFont', 'great-vibes-regular');
  await page.dispatchEvent('#monogramFont', 'change');
  await page.selectOption('#monogramFrame', 'none');
  await page.dispatchEvent('#monogramFrame', 'change');
  await page.selectOption('#monogramLayout', 'script');
  await page.dispatchEvent('#monogramLayout', 'change');
  await page.fill('#monogramLetters', 'AKL');
  await page.dispatchEvent('#monogramLetters', 'input');
  await page.selectOption('#monogramStoneSize', '2');
  await page.dispatchEvent('#monogramStoneSize', 'change');
  await page.selectOption('#monogramColor', 'gold');
  await page.dispatchEvent('#monogramColor', 'change');
  await page.fill('#monogramWidth', '150');
  await page.dispatchEvent('#monogramWidth', 'input');
  await page.fill('#monogramHeight', '150');
  await page.dispatchEvent('#monogramHeight', 'input');
  await page.waitForTimeout(150);

  // The Overlap slider is a range input -- set value + fire 'input' explicitly.
  await page.$eval('#monogramLetterSpacing', (elx, v) => { elx.value = String(v); elx.dispatchEvent(new Event('input', { bubbles: true })); }, interlockMm);
  await page.waitForTimeout(150);

  const fieldVisible = await page.isVisible('#monogramLetterSpacingField');
  const sliderVal = await page.inputValue('#monogramLetterSpacing');
  const overlapLabel = (await page.textContent('#monogramLetterSpacingValue'))?.trim();

  await page.click('#monogramGenerate');
  await page.waitForTimeout(1200);
  const status = (await page.textContent('#status'))?.trim();
  const validation = (await page.textContent('#monogramValidation'))?.trim();
  console.log(`${name}: letterSpacingField=${fieldVisible} slider=${sliderVal} label="${overlapLabel}" status="${status}" validation="${validation}"`);

  await page.locator('#layout').screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
}

await scenario('great-vibes-AKL-0', 0);
await scenario('great-vibes-AKL-minus2.3', -2.3);

await browser.close();
console.log('done');
