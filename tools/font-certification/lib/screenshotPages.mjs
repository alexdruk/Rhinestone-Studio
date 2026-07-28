/**
 * Shared static-server + Playwright screenshot helper for FONT-CERT-001.
 *
 * Adapted from tools/rhinestoneFontQaKit.mjs's existing pattern (local node:http static server +
 * chromium.launchPersistentContext + page.screenshot) -- reused rather than reinvented, per
 * CLAUDE.md's "reuse over duplication". `playwright` is already present in node_modules and is the
 * pattern that kit already established for this repo's font QA tooling.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {object} options
 * @param {string} options.dir Directory to serve statically (the report's output directory).
 * @param {{ htmlFile: string, pngFile: string }[]} options.pages
 * @param {string} options.profileDir Persistent Playwright profile directory, unique per run so
 *   concurrent/repeated invocations never collide.
 * @param {{ width: number, height: number }} [options.viewport]
 */
export async function screenshotPages({ dir, pages, profileDir, viewport = { width: 1600, height: 1000 } }) {
  const { chromium } = await import('playwright');

  const server = await new Promise((resolve) => {
    const staticServer = http.createServer(async (req, res) => {
      try {
        const filePath = path.join(dir, decodeURIComponent(req.url.replace(/^\//, '')) || 'index.html');
        const body = await readFile(filePath);
        const contentType = filePath.endsWith('.html') ? 'text/html' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    staticServer.listen(0, '127.0.0.1', () => resolve(staticServer));
  });
  const port = server.address().port;

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    deviceScaleFactor: 2,
    viewport
  });

  try {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    for (const { htmlFile, pngFile } of pages) {
      page.removeAllListeners('console');
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(`${htmlFile}: ${msg.text()}`);
      });
      await page.goto(`http://127.0.0.1:${port}/${htmlFile}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: pngFile, fullPage: true });
    }
    return { consoleErrors };
  } finally {
    await context.close();
    server.close();
  }
}
