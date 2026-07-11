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

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const examplesDir = path.join(repoRoot, 'examples');

function round(value) {
  return Number(value.toFixed(6));
}

function validationCategory(project) {
  const types = new Set(project.layers.map((l) => l.type));
  const hasText = types.has('text');
  const hasShape = types.has('circle') || types.has('rectangle');
  if (hasText && hasShape) return 'mixed';
  if (hasText) return 'text-only';
  return 'shape-only';
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

async function main() {
  const engine = await buildEngine();
  const manifest = JSON.parse(await readFile(path.join(examplesDir, 'manifest.json'), 'utf8'));

  const baselines = [];
  for (const entry of manifest.examples) {
    const filePath = path.join(examplesDir, entry.file);
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    const project = validateRhsProject(raw, entry.file);
    const layout = await generateProjectStoneLayout(project, engine);
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
