// Local dev server behind `npm run dev` / `npm start`: a static file server for the repo root, the
// same job `python3 -m http.server` used to do, plus `Cache-Control: no-cache, no-store` on every
// response so a browser never reuses a stale ES module (app.js, src/**) after a pull or checkout.
// Dev only -- the app itself never loads or depends on this file.
//
// Usage: node tools/dev-server.mjs [port]   (default 5173; 0 picks a free port)
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE_CONTROL = 'no-cache, no-store';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.rhs': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': CACHE_CONTROL });
  res.end(body);
}

async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const full = path.join(ROOT, path.normalize(decoded));
  // Reject anything that escapes the repo root (e.g. /../../etc/passwd).
  if (full !== ROOT && !full.startsWith(ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep)) return null;
  let info = await stat(full).catch(() => null);
  if (info && info.isDirectory()) {
    const index = path.join(full, 'index.html');
    info = await stat(index).catch(() => null);
    return info && info.isFile() ? { file: index, size: info.size } : null;
  }
  return info && info.isFile() ? { file: full, size: info.size } : null;
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  let found;
  try {
    found = await resolveFile(req.url || '/');
  } catch {
    return send(res, 400, 'Bad Request');
  }
  if (!found) return send(res, 404, 'Not Found');
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[path.extname(found.file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': found.size,
    'Cache-Control': CACHE_CONTROL
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(found.file).on('error', () => res.destroy()).pipe(res);
});

const requestedPort = process.argv[2] === undefined ? 5173 : Number(process.argv[2]);
server.listen(requestedPort, () => {
  console.log(`Serving ${ROOT} at http://localhost:${server.address().port}/ (Cache-Control: ${CACHE_CONTROL})`);
});
