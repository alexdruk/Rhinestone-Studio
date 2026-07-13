/**
 * RS-2000 — decodes a data: URI into an ImageBuffer ({widthPx, heightPx, data}) using a real,
 * short-lived headless Chrome instance over the raw DevTools Protocol (fetch + WebSocket, both
 * Node built-ins -- no new npm dependency, matching this project's established "no new
 * browser-automation dependency" precedent). Node has no bundled PNG/JPEG/WebP decoder, and
 * src/image/ImageDecoder.js is deliberately the one browser-only file in src/image/** (it uses
 * createImageBitmap()/<canvas>), so any tool that needs real decoded pixels for an 'image' layer
 * fixture -- like tools/generate-example-baselines.mjs -- needs this same one unavoidable step.
 *
 * Launches its own isolated Chrome instance (a temp --user-data-dir, a fixed local debugging
 * port) and closes it when done; never touches any of the caller's own browser windows.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEBUG_PORT = 9222 + Math.floor(Math.random() * 1000);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser'
].filter(Boolean);

async function findChrome() {
  const { access } = await import('node:fs/promises');
  for (const candidate of CHROME_CANDIDATES) {
    try { await access(candidate); return candidate; } catch { /* try next */ }
  }
  throw new Error(`No Chrome binary found. Tried: ${CHROME_CANDIDATES.join(', ')}. Set CHROME_PATH to override.`);
}

async function waitForCdp(port, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Chrome DevTools Protocol did not become available on port ${port} within ${timeoutMs}ms.`);
}

/**
 * @param {(decode: (dataUrl: string) => Promise<{widthPx:number,heightPx:number,data:Uint8ClampedArray}>) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withBrowserImageDecoder(fn) {
  const chromePath = await findChrome();
  const profileDir = await mkdtemp(path.join(tmpdir(), 'rs2000-chrome-profile-'));
  const child = spawn(chromePath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--headless=new', 'about:blank'
  ], { stdio: 'ignore' });

  try {
    await waitForCdp(DEBUG_PORT);
    const tabRes = await fetch(`http://localhost:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
    const tab = await tabRes.json();
    const ws = new WebSocket(`ws://localhost:${DEBUG_PORT}/devtools/page/${tab.id}`);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', reject);
    });

    let nextId = 1;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
      }
    });
    function send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    async function decode(dataUrl) {
      const expression = `(async () => {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = ${JSON.stringify(dataUrl)}; });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { widthPx: canvas.width, heightPx: canvas.height, data: Array.from(imgData.data) };
      })()`;
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(`Image decode failed: ${JSON.stringify(result.exceptionDetails)}`);
      const { widthPx, heightPx, data } = result.result.value;
      return { widthPx, heightPx, data: new Uint8ClampedArray(data) };
    }

    const returned = await fn(decode);
    ws.close();
    return returned;
  } finally {
    child.kill();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}
