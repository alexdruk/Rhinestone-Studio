#!/usr/bin/env node
/**
 * FONT-DIAG-001 -- pipeline sensitivity trace.
 *
 * Temporary diagnostic instrumentation (not application code). Calls the real, unmodified
 * production pipeline stage by stage -- GeometryEngine.resolveTextPolygons() (flattening, the same
 * helper generateTextLayout() itself calls) then StoneSampler's exported sampleOutlinePoints() /
 * sampleMultiContourOutlinePoints() directly -- to see exactly which candidate points RC-004A's
 * dedup step removes, and how large the resulting gap is relative to productionAnalysis.mjs's own
 * clusterCount threshold (pitchMm * 1.6). No new geometry logic: every function called here is an
 * existing exported function from src/geometry/**, called read-only.
 *
 * Usage:
 *   node tools/font-diag-001/pipeline-trace.mjs <ttfPath> <glyph> <heightMm> [stoneSizeMm] [gapMm]
 */
import { buildCandidateEngine } from '../font-certification/lib/productionAnalysis.mjs';
import { sampleOutlinePoints, dedupeStonePoints } from '../../src/geometry/StoneSampler.js';

const CLUSTER_GAP_MULTIPLIER = 1.6;
const ISOLATION_MULTIPLIER = 2.5;

function chord(a, b) {
  return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
}

async function trace(ttfPath, glyph, heightMm, stoneSizeMm, gapMm) {
  const { engine, fontId } = await buildCandidateEngine(ttfPath);
  const { polygons } = await engine.resolveTextPolygons({ text: glyph, fontId, layerId: 'diag', heightMm });

  const spacingMm = stoneSizeMm + gapMm;
  const pitchMm = stoneSizeMm + 0.3; // PRODUCTION_GAP_MM, matches productionAnalysis.mjs's clusterCount pitch
  const clusterThresholdMm = pitchMm * CLUSTER_GAP_MULTIPLIER;
  const isolationThresholdMm = pitchMm * ISOLATION_MULTIPLIER;

  // Raw arc-length walk, per contour, BEFORE RC-004A dedup -- exactly what
  // sampleMultiContourOutlinePoints() feeds into dedupeStonePoints() internally.
  const rawPerContour = polygons.map((polygon) => sampleOutlinePoints(polygon, spacingMm, { closed: true }));
  const rawFlat = rawPerContour.flat();
  // Same call sampleMultiContourOutlinePoints() makes internally, but against rawFlat directly (the
  // exact same Point2D instances) so pruned-vs-kept membership can be checked by identity below.
  const kept = dedupeStonePoints(rawFlat, stoneSizeMm);
  const keptSet = new Set(kept);

  // Walk the raw flattened list in its original order (contour-by-contour, sample-by-sample --
  // the same order dedupeStonePoints() scans) and report each maximal run of pruned points as one
  // "prune event", with the resulting gap between its surviving neighbors.
  const pruneEvents = [];
  let runStart = -1;
  for (let i = 0; i < rawFlat.length; i++) {
    const isPruned = !keptSet.has(rawFlat[i]);
    if (isPruned && runStart === -1) runStart = i;
    if (!isPruned && runStart !== -1) {
      const before = rawFlat[runStart - 1] ?? null;
      const after = rawFlat[i];
      pruneEvents.push({
        prunedCount: i - runStart,
        gapMm: before ? chord(before, after) : null,
        beforeIndex: runStart - 1,
        afterIndex: i
      });
      runStart = -1;
    }
  }
  if (runStart !== -1) {
    // Run extends to the end of a contour's raw samples -- gap wraps to that contour's own first
    // surviving point (sampleOutlinePoints's own closing-seam convention), skip precise measurement,
    // just report the prune.
    pruneEvents.push({ prunedCount: rawFlat.length - runStart, gapMm: null, beforeIndex: runStart - 1, afterIndex: null });
  }

  const worstGap = pruneEvents.reduce((max, e) => (e.gapMm !== null && e.gapMm > max ? e.gapMm : max), 0);

  return {
    glyph,
    heightMm,
    stoneSizeMm,
    gapMm,
    spacingMm,
    pitchMm,
    dedupFloorMm: stoneSizeMm,
    clusterThresholdMm,
    isolationThresholdMm,
    rawSampleCount: rawFlat.length,
    keptSampleCount: kept.length,
    prunedCount: rawFlat.length - kept.length,
    pruneEvents: pruneEvents.filter((e) => e.prunedCount > 0),
    worstGapMm: worstGap,
    worstGapExceedsClusterThreshold: worstGap > clusterThresholdMm
  };
}

async function main() {
  const [ttfPath, glyph, heightMmArg, stoneSizeMmArg, gapMmArg] = process.argv.slice(2);
  if (!ttfPath || !glyph || !heightMmArg) {
    console.error('Usage: node pipeline-trace.mjs <ttfPath> <glyph> <heightMm> [stoneSizeMm=6.4] [gapMm=0.3]');
    process.exit(1);
  }
  const heightMm = Number(heightMmArg);
  const stoneSizeMm = stoneSizeMmArg ? Number(stoneSizeMmArg) : 6.4;
  const gapMm = gapMmArg ? Number(gapMmArg) : 0.3;

  const result = await trace(ttfPath, glyph, heightMm, stoneSizeMm, gapMm);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
