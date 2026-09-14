#!/usr/bin/env node
/**
 * READ-011C follow-up — render-geometry audit of docs/data/read-011/render-key.json.
 *
 *   node tools/font-certification/read-011-audit-renders.mjs
 *
 * The rating-pass SVGs under tools/font-certification/output/read-011/ are gitignored and were
 * deleted after the render, so this RECOMPUTES each entry's stone layout from the key's own fields —
 * the exact path read-011-renders.mjs used (analyzeOne with the key's fontId/text/stoneSizeId/
 * heightMm/mode and the recorded letterSpacingMm) — and measures, in mm:
 *
 *   - inkHeightMm       vertical extent of stone centres + stone radius (max(y+r) - min(y-r))
 *   - largestGapMm      largest x-gap between adjacent glyph clusters (union-find at pitch x 1.6,
 *                       the same threshold countClusters() uses), normalised by stone pitch
 *   - stoneCount        layout.stones.length
 *
 * ## The per-font ink-height ratio, and why it is not compared to heightMm directly
 *
 * "Vitalina" / "Emmanuel" both have ascenders and no descenders, so inkHeightMm sits below heightMm
 * by a font-specific fraction *by design*. Comparing inkHeightMm to heightMm would flag every font
 * as an outlier. Instead this reports, per fontId, the ratio inkHeightMm / heightMm, and ASSERTS
 * that it is constant across every entry sharing a (fontId, text, mode) — layout is pure linear
 * scaling about the origin, so the ratio must not move with the ratio rung or the stone size. Any
 * group whose relative spread exceeds RATIO_TOLERANCE is a non-scaling-geometry bug and is printed
 * with its offending slugs.
 *
 * RATIO_TOLERANCE is 0.05 (5% relative spread). A thin stroke rendered as a single row of stones
 * gains or loses a whole row's worth of extent between adjacent rungs at the smallest heights;
 * 5% covers that single-stone quantisation. Anything above it is the layout genuinely not scaling.
 *
 * The table is printed IN FULL (every font, rs-block / rs-modern alongside the outline faces) — not
 * a pass/fail summary — because it is the evidence for two open questions: whether rs-block renders
 * shorter than the outline faces at the same specified height, and whether it opens an oversized
 * gap mid-word.
 *
 * Exit code is 1 if any (fontId, text, mode) group exceeds RATIO_TOLERANCE, 0 otherwise. This is an
 * audit report, not a suite test — it is not registered in tools/test-groups.mjs.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FontManager } from '../../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../../src/text/index.js';
import { GeometryEngine, CLUSTER_GAP_MULTIPLIER } from '../../src/geometry/index.js';
import { analyzeOne } from './lib/productionAnalysis.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const KEY_FILE = path.join(repoRoot, 'docs/data/read-011/render-key.json');

const RATIO_TOLERANCE = 0.05; // max relative spread of inkHeightMm/heightMm within a (font,text,mode) group

// --- geometry helpers ----------------------------------------------------------------------------

// Union-find cluster membership over stones, unioning any two within thresholdMm (Euclidean). Same
// rule as src/geometry/GlyphSeparation.js countClusters(); returns the groups, not just the count.
function clusterStones(stones, thresholdMm) {
  const n = stones.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(stones[i].xMm - stones[j].xMm, stones[i].yMm - stones[j].yMm);
      if (d <= thresholdMm) {
        const ra = find(i);
        const rb = find(j);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(stones[i]);
  }
  return [...groups.values()];
}

function inkHeightMm(stones) {
  let top = Infinity;
  let bottom = -Infinity;
  for (const s of stones) {
    top = Math.min(top, s.yMm - s.sizeMm / 2);
    bottom = Math.max(bottom, s.yMm + s.sizeMm / 2);
  }
  return bottom - top;
}

// Largest x-gap between adjacent clusters, sorted left-to-right. Gap = next.minX - cur.maxX,
// clamped at 0. 0 when there is one cluster or none.
function largestClusterGapMm(clusters) {
  if (clusters.length < 2) return 0;
  const spans = clusters
    .map((c) => ({ minX: Math.min(...c.map((s) => s.xMm)), maxX: Math.max(...c.map((s) => s.xMm)) }))
    .sort((a, b) => a.minX - b.minX);
  let largest = 0;
  for (let i = 1; i < spans.length; i++) {
    largest = Math.max(largest, spans[i].minX - spans[i - 1].maxX);
  }
  return largest;
}

function fmt(v, d = 3) {
  return Number.isFinite(v) ? v.toFixed(d) : '  -  ';
}

async function run() {
  const key = JSON.parse(await readFile(KEY_FILE, 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  const providerById = new Map(fontManager.manifest.fonts.map((f) => [f.id, f.providerId ?? null]));
  const regimeById = new Map();
  const engine = new GeometryEngine({
    fontProviderRegistry: createDefaultFontProviderRegistry(fontManager, {
      loadFontBuffer: async (rel) => {
        const b = await readFile(path.join(repoRoot, rel));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      }
    })
  });

  // --- measure every entry -------------------------------------------------------------------

  const rows = [];
  for (const e of key.entries) {
    regimeById.set(e.fontId, e.stemRegime);
    const m = await analyzeOne(engine, e.fontId, e.text, e.stoneSizeId, e.heightMm, {
      mode: e.mode,
      providerId: providerById.get(e.fontId),
      letterSpacingMm: e.letterSpacingMm || undefined
    });
    if (m.error || m.stoneCount === 0) {
      throw new Error(`recompute failed for ${e.slug} ${e.fontId}/${e.mode}: ${m.error ?? 'zero stones'}`);
    }
    const clusters = clusterStones(m.stones, m.pitchMm * CLUSTER_GAP_MULTIPLIER);
    const inkH = inkHeightMm(m.stones);
    const largestGapMm = largestClusterGapMm(clusters);
    rows.push({
      slug: e.slug,
      fontId: e.fontId,
      stemRegime: e.stemRegime,
      text: e.text,
      mode: e.mode,
      ratioRung: e.ratio,
      stoneSizeId: e.stoneSizeId,
      heightMm: e.heightMm,
      pitchMm: m.pitchMm,
      stoneCount: m.stoneCount,
      inkHeightMm: inkH,
      inkHeightRatio: inkH / e.heightMm,
      clusterCount: clusters.length,
      largestGapMm,
      largestGapPitches: largestGapMm / m.pitchMm
    });
  }

  // --- assertion: inkHeightRatio constant within every (fontId, text, mode) group -----------

  const groups = new Map();
  for (const r of rows) {
    const gk = `${r.fontId}|${r.text}|${r.mode}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(r);
  }

  const violations = [];
  for (const [gk, arr] of groups) {
    if (arr.length < 2) continue;
    const ratios = arr.map((r) => r.inkHeightRatio);
    const min = Math.min(...ratios);
    const max = Math.max(...ratios);
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const relSpread = (max - min) / mean;
    if (relSpread > RATIO_TOLERANCE) {
      violations.push({ gk, relSpread, min, max, mean, arr });
    }
  }

  // --- per-font table ---------------------------------------------------------------------

  const byFont = new Map();
  for (const r of rows) {
    if (!byFont.has(r.fontId)) byFont.set(r.fontId, []);
    byFont.get(r.fontId).push(r);
  }

  const REGIME_ORDER = { monoline: 0, transitional: 1, massed: 2, unmeasured: 3 };
  const fontRows = [...byFont.entries()]
    .map(([fontId, rs]) => {
      const mean = (sel) => rs.reduce((a, r) => a + sel(r), 0) / rs.length;
      return {
        fontId,
        stemRegime: regimeById.get(fontId),
        n: rs.length,
        meanInkHeightRatio: mean((r) => r.inkHeightRatio),
        minInkHeightRatio: Math.min(...rs.map((r) => r.inkHeightRatio)),
        maxInkHeightRatio: Math.max(...rs.map((r) => r.inkHeightRatio)),
        meanLargestGapPitches: mean((r) => r.largestGapPitches),
        maxLargestGapPitches: Math.max(...rs.map((r) => r.largestGapPitches)),
        meanStoneCount: mean((r) => r.stoneCount)
      };
    })
    .sort((a, b) =>
      (REGIME_ORDER[a.stemRegime] - REGIME_ORDER[b.stemRegime]) || a.fontId.localeCompare(b.fontId));

  console.log('READ-011C render-geometry audit — recomputed from docs/data/read-011/render-key.json');
  console.log(`${rows.length} entries, ${byFont.size} fonts. inkHeightRatio = inkHeightMm / heightMm.`);
  console.log(`Assertion: inkHeightRatio constant within each (fontId, text, mode) group, tolerance ${RATIO_TOLERANCE} relative spread.\n`);

  const H =
    'font                          regime        n   inkH/height (mean [min..max])   largestGap/pitch (mean, max)   mean stones';
  console.log(H);
  console.log('-'.repeat(H.length));
  for (const f of fontRows) {
    console.log(
      f.fontId.padEnd(29) +
      ' ' + (f.stemRegime ?? '?').padEnd(13) +
      ' ' + String(f.n).padStart(2) +
      '   ' + `${fmt(f.meanInkHeightRatio)} [${fmt(f.minInkHeightRatio)}..${fmt(f.maxInkHeightRatio)}]`.padEnd(30) +
      '  ' + `${fmt(f.meanLargestGapPitches, 2)}, ${fmt(f.maxLargestGapPitches, 2)}`.padEnd(28) +
      '  ' + fmt(f.meanStoneCount, 1)
    );
  }

  // --- violations ------------------------------------------------------------------------

  console.log('');
  if (violations.length === 0) {
    console.log(`inkHeightRatio consistency: PASS — every (font, text, mode) group within ${RATIO_TOLERANCE} relative spread.`);
  } else {
    console.log(`inkHeightRatio consistency: ${violations.length} group(s) EXCEED the ${RATIO_TOLERANCE} tolerance — layout not pure-scaling:\n`);
    for (const v of violations.sort((a, b) => b.relSpread - a.relSpread)) {
      console.log(`  ${v.gk}   relative spread ${fmt(v.relSpread, 4)}  (ratio ${fmt(v.min)}..${fmt(v.max)}, mean ${fmt(v.mean)})`);
      for (const r of v.arr.sort((a, b) => a.inkHeightRatio - b.inkHeightRatio)) {
        console.log(`      ${r.slug}  rung ${String(r.ratioRung).padStart(4)}  ${r.stoneSizeId}  heightMm ${fmt(r.heightMm, 1)}  ->  inkHeightMm ${fmt(r.inkHeightMm, 2)}  ratio ${fmt(r.inkHeightRatio)}  stones ${r.stoneCount}`);
      }
      console.log('');
    }
  }

  process.exitCode = violations.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run().catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  });
}
