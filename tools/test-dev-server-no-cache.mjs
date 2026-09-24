// Dev server: starts tools/dev-server.mjs for real on a free port and checks that it serves app.js
// as JavaScript with `Cache-Control: no-cache, no-store`, so a browser never reuses a stale module.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function startServer() {
  const child = spawn(process.execPath, ['tools/dev-server.mjs', '0'], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`dev server did not report a port: ${out}`)), 10000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/localhost:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`dev server exited early with code ${code}: ${out}`));
    });
  });
  return { child, port };
}

const { child, port: portPromise } = startServer();
try {
  const port = await portPromise;

  await test('app.js is served with Cache-Control: no-cache, no-store', async () => {
    const res = await fetch(`http://localhost:${port}/app.js`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache, no-store');
    assert.match(res.headers.get('content-type'), /^text\/javascript/);
    assert.equal(await res.text(), readFileSync(new URL('../app.js', import.meta.url), 'utf8'));
  });

  await test('the root URL serves index.html, also with the no-cache header', async () => {
    const res = await fetch(`http://localhost:${port}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache, no-store');
    assert.match(res.headers.get('content-type'), /^text\/html/);
  });

  await test('a missing file is a 404 that also carries the no-cache header', async () => {
    const res = await fetch(`http://localhost:${port}/does-not-exist.js`);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('cache-control'), 'no-cache, no-store');
  });

  await test('package.json dev and start scripts run this server on port 5173', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.scripts.dev, 'node tools/dev-server.mjs 5173');
    assert.equal(pkg.scripts.start, 'node tools/dev-server.mjs 5173');
  });
} catch (error) {
  console.error('✗ dev server failed to start');
  console.error(error);
  process.exitCode = 1;
} finally {
  child.kill();
}
