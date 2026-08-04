/**
 * RS-0003.5E1 — (re)computes examples/baselines.json from the current examples/*.rhs fixtures.
 *
 * This is a deliberately manual, human-run tool. It is NOT invoked by `npm test` or by
 * tools/test-examples-regression.mjs — per docs/specifications/RS-0003.5E1-RealProductionValidation.md,
 * baselines are a committed, reviewed artifact; regenerating them automatically during ordinary
 * test runs would silently mask a real regression as a "baseline update". Run this script only
 * when a human has decided a baseline should intentionally change, then review the diff before
 * committing.
 *
 * Usage: node tools/generate-example-baselines.mjs
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FontManager } from '../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../src/text/index.js';
import { GeometryEngine } from '../src/geometry/index.js';
import { validateRhsProject, generateProjectStoneLayout, resolveFontId, visibleLayerCount } from './lib/rhsProject.mjs';
import { withBrowserImageDecoder } from './lib/browserImageBuffer.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const examplesDir = path.join(repoRoot, 'examples');

function round(value) {
  return Number(value.toFixed(6));
}

// RS-2000: generalized to cover svg/image/path (previously only text/circle/rectangle existed).
// A project touching more than one of these groups is 'mixed', exactly as text+shape already was;
// a project using only one group keeps that group's own '<group>-only' label.
function validationCategory(project) {
  const types = new Set(project.layers.map((l) => l.type));
  const groups = [];
  if (types.has('text')) groups.push('text');
  if (types.has('circle') || types.has('rectangle')) groups.push('shape');
  if (types.has('svg')) groups.push('svg');
  if (types.has('image')) groups.push('image');
  if (types.has('path')) groups.push('path');
  if (groups.length > 1) return 'mixed';
  return `${groups[0]}-only`;
}

async function buildEngine() {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  async function loadFontBufferFromRepoRoot(relativePath) {
    const buffer = await readFile(path.join(repoRoot, relativePath));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const fontProviderRegistry = createDefaultFontProviderRegistry(fontManager, { loadFontBuffer: loadFontBufferFromRepoRoot });
  return new GeometryEngine({ fontProviderRegistry });
}

async function computeBaselines(engine, manifest, resolveImageBuffer) {
  const baselines = [];
  for (const entry of manifest.examples) {
    const filePath = path.join(examplesDir, entry.file);
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    const project = validateRhsProject(raw, entry.file);
    const layout = await generateProjectStoneLayout(project, engine, { resolveImageBuffer });
    const bb = layout.getBoundingBox();

    const fontIds = [...new Set(
      project.layers.filter((l) => l.type === 'text').map((l) => resolveFontId(l.font))
    )].sort();
    const colors = [...new Set(layout.stones.map((s) => s.color))].sort();

    baselines.push({
      file: entry.file,
      layerCount: project.layers.length,
      visibleLayerCount: visibleLayerCount(project),
      stoneCount: layout.count,
      bounds: bb
        ? { minXmm: round(bb.minXmm), minYmm: round(bb.minYmm), maxXmm: round(bb.maxXmm), maxYmm: round(bb.maxYmm) }
        : null,
      fontIds,
      colors,
      validationCategory: validationCategory(project)
    });
  }
  return baselines;
}

async function main() {
  const engine = await buildEngine();
  const manifest = JSON.parse(await readFile(path.join(examplesDir, 'manifest.json'), 'utf8'));

  // RS-2000: an 'image' layer fixture needs its imageSrc really decoded to pixels -- Node has no
  // bundled PNG/JPEG/WebP decoder (src/image/ImageDecoder.js is deliberately browser-only), so
  // only spin up the one short-lived headless Chrome instance this needs when the fixture set
  // actually contains an image layer.
  let needsBrowserDecoder = false;
  for (const entry of manifest.examples) {
    const raw = JSON.parse(await readFile(path.join(examplesDir, entry.file), 'utf8'));
    if (Array.isArray(raw.layers) && raw.layers.some((l) => l.type === 'image')) { needsBrowserDecoder = true; break; }
  }

  const baselines = needsBrowserDecoder
    ? await withBrowserImageDecoder((decode) => computeBaselines(engine, manifest, (layer) => decode(layer.imageSrc)))
    : await computeBaselines(engine, manifest, undefined);

  const examplesOnDisk = (await readdir(examplesDir)).filter((f) => f.endsWith('.rhs')).sort();
  const manifestFiles = new Set(manifest.examples.map((e) => e.file));
  const missingFromManifest = examplesOnDisk.filter((f) => !manifestFiles.has(f));
  if (missingFromManifest.length > 0) {
    throw new Error(`examples/manifest.json is missing entries for: ${missingFromManifest.join(', ')}`);
  }

  const output = { version: 1, generatedNote: 'Committed baseline. Regenerate deliberately via `node tools/generate-example-baselines.mjs`, review the diff, and commit — never regenerated automatically by npm test.', baselines };
  await writeFile(path.join(examplesDir, 'baselines.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote examples/baselines.json with ${baselines.length} entries.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
