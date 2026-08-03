import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const repoRoot = '/Users/alex/Documents/rhinestone-studio';
const outDir = path.join(repoRoot, 'tools', 'txt104-verification-screenshots');
await fs.mkdir(outDir, { recursive: true });

const MIME_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  try {
    const filePath = path.join(repoRoot, decodeURIComponent(req.url.split('?')[0]));
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const browser = await chromium.launchPersistentContext('/tmp/txt104-verification-gen-profile', {
  headless: true,
  acceptDownloads: true,
  viewport: { width: 1400, height: 900 }
});
const page = await browser.newPage();
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

async function freshPage() {
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.click('#menuText');
  await page.waitForSelector('#addTextBtn', { state: 'visible' });
  await page.click('#addTextBtn');
  await page.waitForTimeout(80);
}

async function setText(value) {
  await page.fill('#text', value);
  await page.dispatchEvent('#text', 'input');
  await page.waitForTimeout(30);
  await page.dispatchEvent('#text', 'change');
  await page.waitForTimeout(50);
}

async function setFont(fontId) {
  await page.selectOption('#font', fontId);
  await page.dispatchEvent('#font', 'change');
  await page.waitForTimeout(80);
}

async function letterHeightFieldVisible() {
  return page.$eval('#letterHeightField', (el) => el.style.display !== 'none');
}

async function heightFieldVisible() {
  return page.$eval('#heightField', (el) => el.style.display !== 'none');
}

async function ensureCapHeightMode() {
  if (!(await letterHeightFieldVisible())) {
    await page.click('#heightModeToggleBtn');
    await page.waitForTimeout(80);
  }
}

async function setLetterHeight(mm) {
  await page.fill('#letterHeight', String(mm));
  await page.dispatchEvent('#letterHeight', 'input');
  await page.waitForTimeout(30);
  await page.dispatchEvent('#letterHeight', 'change');
  await page.waitForTimeout(80);
}

async function openExportLightbox() {
  await page.click('#menuExport');
  await page.waitForSelector('#exportLayout', { state: 'visible' });
}

async function exportViaButton(buttonId, destPath) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click(`#${buttonId}`),
  ]);
  await download.saveAs(destPath);
}

function parseSvgStoneBoundingBoxMm(svgText) {
  const circles = [...svgText.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g)].map((m) => ({
    cx: parseFloat(m[1]),
    cy: parseFloat(m[2]),
    r: parseFloat(m[3]),
  }));
  if (circles.length === 0) return null;
  const minX = Math.min(...circles.map((c) => c.cx - c.r));
  const maxX = Math.max(...circles.map((c) => c.cx + c.r));
  const minY = Math.min(...circles.map((c) => c.cy - c.r));
  const maxY = Math.max(...circles.map((c) => c.cy + c.r));
  return { stoneCount: circles.length, widthMm: maxX - minX, heightMm: maxY - minY, minX, maxX, minY, maxY };
}

const results = {};

// --- Part 1: Letter Height = 20mm renders for the 4 validated fonts, single "H" glyph ---
const FONTS = [
  { id: 'baloo2-variable-regular', label: 'Baloo 2', slug: 'baloo2' },
  { id: 'anton-regular', label: 'Anton', slug: 'anton' },
  { id: 'sacramento-regular', label: 'Sacramento', slug: 'sacramento' },
  { id: 'dancing-script-regular', label: 'Dancing Script', slug: 'dancingscript' },
];

for (const font of FONTS) {
  await freshPage();
  await setText('H');
  await setFont(font.id);
  await ensureCapHeightMode();
  await setLetterHeight(20);
  await page.waitForTimeout(150);

  const svgPath = path.join(outDir, `letterheight20mm-${font.slug}.svg`);
  const layoutPath = path.join(outDir, `letterheight20mm-${font.slug}-layout.json`);
  const pngPath = path.join(outDir, `letterheight20mm-${font.slug}.png`);

  await openExportLightbox();
  await exportViaButton('exportSVG', svgPath);
  await exportViaButton('exportLayout', layoutPath);
  await page.click('[data-lightbox-close]').catch(() => {});
  await page.waitForTimeout(100);

  await page.screenshot({ path: pngPath });

  const svgText = await fs.readFile(svgPath, 'utf8');
  const bbox = parseSvgStoneBoundingBoxMm(svgText);
  const letterHeightValue = await page.$eval('#letterHeight', (el) => el.value);
  const heightValue = await page.$eval('#height', (el) => el.value);

  results[font.slug] = {
    fontId: font.id,
    fontLabel: font.label,
    requestedLetterHeightMm: 20,
    letterHeightFieldValue: letterHeightValue,
    rawHeightFieldValue: heightValue,
    svgStoneBoundingBox: bbox,
  };
  console.log(`[${font.label}] letterHeight=${letterHeightValue} rawHeight=${heightValue} bbox=`, bbox);
}

await fs.writeFile(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));

// --- Part 2: toggle-before / toggle-after (raw-mode layer, switch heightMode, confirm stones
// byte-identical before any re-edit) ---
await freshPage();
await setText('Toggle Test');
await setFont('baloo2-variable-regular');
// Ensure raw mode (new layers default to raw per TXT-104 step 3; confirm, don't assume).
if (await letterHeightFieldVisible()) {
  await page.click('#heightModeToggleBtn');
  await page.waitForTimeout(80);
}
console.log('toggle test starting mode: heightField visible =', await heightFieldVisible(), 'letterHeightField visible =', await letterHeightFieldVisible());

await openExportLightbox();
const toggleBeforeLayoutPath = path.join(outDir, 'toggle-before-layout.json');
await exportViaButton('exportLayout', toggleBeforeLayoutPath);
await page.click('[data-lightbox-close]').catch(() => {});
await page.waitForTimeout(100);
await page.screenshot({ path: path.join(outDir, 'toggle-before.png') });

// Toggle heightMode via the affordance -- no other edit.
await page.click('#heightModeToggleBtn');
await page.waitForTimeout(100);
console.log('after toggle: letterHeightField visible =', await letterHeightFieldVisible());

await openExportLightbox();
const toggleAfterLayoutPath = path.join(outDir, 'toggle-after-layout.json');
await exportViaButton('exportLayout', toggleAfterLayoutPath);
await page.click('[data-lightbox-close]').catch(() => {});
await page.waitForTimeout(100);
await page.screenshot({ path: path.join(outDir, 'toggle-after.png') });

const beforeLayout = JSON.parse(await fs.readFile(toggleBeforeLayoutPath, 'utf8'));
const afterLayout = JSON.parse(await fs.readFile(toggleAfterLayoutPath, 'utf8'));
const stonesIdentical = JSON.stringify(beforeLayout.stones) === JSON.stringify(afterLayout.stones);

const toggleResults = {
  stoneCountBefore: beforeLayout.stones?.length,
  stoneCountAfter: afterLayout.stones?.length,
  stonesByteIdentical: stonesIdentical,
};
await fs.writeFile(path.join(outDir, 'toggle-results.json'), JSON.stringify(toggleResults, null, 2));
console.log('toggle results:', toggleResults);

// --- Part 3: RS Block fallback (capHeight-mode layer switched to RS Block font) ---
await freshPage();
await setText('Fallback Test');
await setFont('baloo2-variable-regular');
await ensureCapHeightMode();
console.log('before RS Block switch: letterHeightField visible =', await letterHeightFieldVisible());
await page.screenshot({ path: path.join(outDir, 'rsblock-fallback-before.png') });

await setFont('rs-block');
await page.waitForTimeout(100);
const letterHeightVisibleAfterRsBlock = await letterHeightFieldVisible();
const heightVisibleAfterRsBlock = await heightFieldVisible();
console.log('after RS Block switch: letterHeightField visible =', letterHeightVisibleAfterRsBlock, 'heightField visible =', heightVisibleAfterRsBlock);
await page.screenshot({ path: path.join(outDir, 'rsblock-fallback-after.png') });

const rsBlockResults = {
  fontId: 'rs-block',
  letterHeightFieldVisibleAfterSwitch: letterHeightVisibleAfterRsBlock,
  heightFieldVisibleAfterSwitch: heightVisibleAfterRsBlock,
  fallbackToRawHeightConfirmed: !letterHeightVisibleAfterRsBlock && heightVisibleAfterRsBlock,
};
await fs.writeFile(path.join(outDir, 'rsblock-fallback-results.json'), JSON.stringify(rsBlockResults, null, 2));
console.log('RS Block fallback results:', rsBlockResults);

await browser.close();
server.close();
console.log('DONE. Output in', outDir);
