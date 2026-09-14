#!/usr/bin/env node
/**
 * FONT-LIB-004 — batch objective readability audit across every enabled OpenType font.
 *
 * Reuses FONT-CERT-001/002's real analysis pipeline (runProductionAnalysis() +
 * computeReadabilityFindings()) unchanged -- no new analysis logic here, only batching it across
 * the manifest and deciding, per font/stone-size, whether the result clears this milestone's bar.
 *
 * Height choice (important): runProductionAnalysis()'s default SPECIMEN_HEIGHT_MM_BY_SIZE holds a
 * fixed height/stone-size ratio of 12.5, which is BELOW the app's own FONT-DECISION-001-validated
 * supportedHeightRangeMm for every catalog size (e.g. SS6: 25mm vs. the app's 35-50mm). Auditing at
 * the cert default would measure a configuration the app never actually produces, and would
 * over-flag (fewer stones per glyph than reality). This script instead overrides heightMmBySize
 * with the midpoint of each size's real supportedHeightRangeMm -- exactly the height
 * applyStoneSizeHeightAutoSet() gives a fresh text layer when that size is picked.
 *
 * Usage:
 *   node tools/font-certification/audit-manifest-readability.mjs [--write] [--only=id1,id2]
 */
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { repoPath } from './lib/repoPaths.mjs';
import { runProductionAnalysis } from './lib/productionAnalysis.mjs';
import { computeReadabilityFindings } from './lib/readabilityMetrics.mjs';
import { STONE_SIZE_IDS } from './lib/requiredCharacters.mjs';
import { listStoneSizes, STONE_SIZE_BY_ID } from '../../src/renderer/StoneSizes.js';

// The app's own default height for each stone size: the midpoint of that size's validated
// supportedHeightRangeMm, matching applyStoneSizeHeightAutoSet() in app.js.
export function appDefaultHeightMmBySize() {
  const out = {};
  for (const size of listStoneSizes()) {
    const [lo, hi] = size.supportedHeightRangeMm;
    out[size.id] = Math.round((lo + hi) / 2);
  }
  return out;
}

/**
 * This milestone's bar, applied per (font, stoneSize). See
 * docs/specifications/FONT-LIB-004-ReadabilityGating.md for the reasoning behind each clause.
 *
 * Returns { unsupported: boolean, reasons: string[], detail: object }.
 */
export function evaluateSizeForFont(productionAnalysis, readability, sizeId) {
  const reasons = [];

  // (1) FAIL-tier, matching classification.mjs's collectProductionIssues(): any collision or any
  // unusable/zero-stone layout at this size, across the whole required corpus.
  let collisions = 0;
  let unusable = 0;
  const scan = (map) => {
    for (const [text, bySize] of map.entries()) {
      const r = bySize.get(sizeId);
      if (!r) continue;
      if (r.error) { unusable++; continue; }
      if (r.collisionCount > 0) collisions += r.collisionCount;
      if (r.stoneCount === 0 && text.trim().length > 0) unusable++;
    }
  };
  scan(productionAnalysis.glyphResults);
  scan(productionAnalysis.wordResults);
  if (collisions > 0) reasons.push(`${collisions} stone collision(s)`);
  if (unusable > 0) reasons.push(`${unusable} unusable/zero-stone layout(s)`);

  // (2) Readability floors, but as a PROPORTION of the corpus rather than all-or-nothing -- see the
  // spec doc: a single marginal glyph is a refinement note, a broad collapse is a real defect.
  const lowAtSize = readability.lowStoneCountFindings.filter((f) => f.sizeId === sizeId);
  const counterAtSize = readability.counterCollapseFindings.filter((f) => f.sizeId === sizeId);
  const affected = new Set([...lowAtSize, ...counterAtSize].map((f) => f.char));
  const corpusSize = productionAnalysis.glyphResults.size;
  const affectedFraction = corpusSize > 0 ? affected.size / corpusSize : 0;
  if (affected.size > 0) {
    reasons.push(`${affected.size}/${corpusSize} glyphs below the readability floor (${(affectedFraction * 100).toFixed(0)}%)`);
  }

  const READABILITY_FRACTION_THRESHOLD = 0.10;
  const unsupported = collisions > 0 || unusable > 0 || affectedFraction > READABILITY_FRACTION_THRESHOLD;

  return {
    unsupported,
    reasons,
    detail: { collisions, unusable, affectedGlyphs: [...affected].sort(), affectedFraction, corpusSize }
  };
}

async function auditFont(font, heightMmBySize) {
  const absolutePath = repoPath(font.path);
  const productionAnalysis = await runProductionAnalysis(absolutePath, { heightMmBySize });
  const readability = computeReadabilityFindings(productionAnalysis);
  const perSize = {};
  const unsupportedSizes = [];
  for (const sizeId of STONE_SIZE_IDS) {
    const verdict = evaluateSizeForFont(productionAnalysis, readability, sizeId);
    perSize[sizeId] = verdict;
    if (verdict.unsupported) unsupportedSizes.push(sizeId);
  }
  return { font, perSize, unsupportedSizes };
}

async function main() {
  const write = process.argv.includes('--write');
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;

  const manifestPath = repoPath('assets/fonts/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const heightMmBySize = appDefaultHeightMmBySize();

  console.log('FONT-LIB-004 readability audit');
  console.log('Heights used (app default = midpoint of each size\'s supportedHeightRangeMm):');
  for (const sizeId of STONE_SIZE_IDS) {
    console.log(`  ${sizeId.toUpperCase().padEnd(5)} stone ${String(STONE_SIZE_BY_ID[sizeId].diameterMm).padEnd(5)}mm  height ${heightMmBySize[sizeId]}mm`);
  }
  console.log('');

  const candidates = manifest.fonts.filter((f) =>
    f.enabled === true && (f.providerId ?? 'opentype') === 'opentype' && (!only || only.includes(f.id))
  );

  const results = [];
  const failures = [];
  for (const font of candidates) {
    process.stderr.write(`  analyzing ${font.id} ...`);
    const t0 = Date.now();
    try {
      const r = await auditFont(font, heightMmBySize);
      results.push(r);
      process.stderr.write(` ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
    } catch (error) {
      failures.push({ font, error: error.message });
      process.stderr.write(` FAILED: ${error.message}\n`);
    }
  }

  console.log('| font id | family / style | role | currently unsupported | audit says unsupported | change |');
  console.log('|---|---|---|---|---|---|');
  for (const r of results) {
    const current = (r.font.unsupportedStoneSizes ?? []).slice().sort();
    const audited = r.unsupportedSizes.slice().sort();
    const same = JSON.stringify(current) === JSON.stringify(audited);
    console.log(`| ${r.font.id} | ${r.font.family} ${r.font.style} | ${r.font.role} | ${current.join(',') || '—'} | ${audited.join(',') || '—'} | ${same ? 'none' : '**CHANGED**'} |`);
  }

  console.log('\n--- Per-size detail (only sizes the audit flags) ---');
  for (const r of results) {
    for (const sizeId of STONE_SIZE_IDS) {
      const v = r.perSize[sizeId];
      if (!v.unsupported) continue;
      console.log(`${r.font.id} @ ${sizeId.toUpperCase()}: ${v.reasons.join('; ')}`);
      if (v.detail.affectedGlyphs.length > 0) {
        console.log(`    glyphs: ${v.detail.affectedGlyphs.join(' ')}`);
      }
    }
  }

  if (failures.length > 0) {
    console.log('\n--- Fonts that could not be analyzed ---');
    for (const f of failures) console.log(`${f.font.id}: ${f.error}`);
  }

  if (write) {
    let changed = 0;
    for (const r of results) {
      const current = (r.font.unsupportedStoneSizes ?? []).slice().sort();
      const audited = r.unsupportedSizes.slice().sort();
      if (JSON.stringify(current) === JSON.stringify(audited)) continue;
      const entry = manifest.fonts.find((f) => f.id === r.font.id);
      entry.unsupportedStoneSizes = audited;
      changed++;
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`\n--write: updated ${changed} manifest entr(ies).`);
  } else {
    console.log('\n(dry run -- re-run with --write to apply to assets/fonts/manifest.json)');
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  await main();
}
