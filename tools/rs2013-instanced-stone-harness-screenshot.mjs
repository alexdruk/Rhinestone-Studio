/**
 * RS-2013 -- one-off Playwright screenshot capture for the standalone instanced-stone test harness
 * (rs2013-instanced-stone-harness.html). Not a tools/test-*.mjs file and not discovered by
 * tools/run-tests.mjs -- this only produces PNGs so the visual result can be reviewed without a
 * browser, following the same static-server + chromium.launchPersistentContext + screenshot pattern
 * tools/rhinestoneFontQaKit.mjs already uses for font QA sheets.
 *
 * RS-2013 step 2: extended to capture one screenshot per ?product= view (plate/mug/tumbler/bottle)
 * in addition to the original step-1 static grid, each named rs2013-instanced-stone-harness-<view>.png.
 */
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const harnessUrlPath = 'tools/rs2013-instanced-stone-harness.html';

const MIME_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.rhs': 'application/json' };

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

const browser = await chromium.launchPersistentContext('/tmp/rs2013-instanced-stone-harness-profile', {
  headless: true,
  deviceScaleFactor: 2,
  viewport: { width: 1400, height: 850 }
});

const VIEWS = [
  { name: 'grid', query: '' },
  { name: 'plate', query: '?product=plate' },
  { name: 'mug', query: '?product=mug' },
  { name: 'tumbler', query: '?product=tumbler' },
  { name: 'bottle', query: '?product=bottle' }
];

for (const view of VIEWS) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));
  try {
    await page.goto(`http://127.0.0.1:${port}/${harnessUrlPath}${view.query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction('window.__rs2013HarnessReady === true', null, { timeout: 15000 });
    await page.waitForTimeout(300); // let a couple of requestAnimationFrame ticks actually paint
    const stoneCount = await page.evaluate(() => window.__rs2013StoneCount ?? null);
    const outputPngPath = path.join(__dirname, `rs2013-instanced-stone-harness-${view.name}.png`);
    await page.screenshot({ path: outputPngPath });
    console.log(`Wrote ${outputPngPath}${stoneCount !== null ? ` (stoneCount=${stoneCount})` : ''}`);
  } catch (error) {
    console.error(`FAILED view "${view.name}": ${error.message}`);
    process.exitCode = 1;
  }
  if (consoleErrors.length) {
    console.error(`  console/page errors on ${view.name}:`, consoleErrors);
    process.exitCode = 1;
  }
  await page.close();
}

await browser.close();
server.close();
