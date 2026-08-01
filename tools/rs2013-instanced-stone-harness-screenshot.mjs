/**
 * RS-2013 step 1 -- one-off Playwright screenshot capture for the standalone instanced-stone test
 * harness (rs2013-instanced-stone-harness.html). Not a tools/test-*.mjs file and not discovered by
 * tools/run-tests.mjs -- this only produces a PNG so the visual result can be reviewed without a
 * browser, following the same static-server + chromium.launchPersistentContext + screenshot pattern
 * tools/rhinestoneFontQaKit.mjs already uses for font QA sheets.
 */
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const harnessUrlPath = 'tools/rs2013-instanced-stone-harness.html';
const outputPngPath = path.join(__dirname, 'rs2013-instanced-stone-harness.png');

const MIME_TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };

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
  viewport: { width: 1200, height: 800 }
});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/${harnessUrlPath}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__rs2013HarnessReady === true);
await page.waitForTimeout(300); // let a couple of requestAnimationFrame ticks actually paint
await page.screenshot({ path: outputPngPath });
console.log(`Wrote ${outputPngPath}`);

await browser.close();
server.close();
