#!/usr/bin/env node
// READ-011B -- enumerate the READ-011 rating pass as a tracked render plan.
//
// This planner is the experimental design, frozen as data. It deterministically enumerates every
// render the READ-011 rating pass will produce and writes docs/data/read-011/render-plan.json --
// tracked, and deliberately NOT under the gitignored tools/font-certification/output/ tree, because
// a re-derivable design that nobody can point back to is a design that gets silently re-cut.
//
// It reads exactly two things:
//   - assets/fonts/manifest.json     -- the enabled-font list and each font's measured stemWidthRatio
//   - src/geometry/StemRegime.js     -- classifyStemRegime(), the stroke-regime strata (READ-011A)
//
// It does NOT import Playwright, construct a GeometryEngine, run any geometry, or render anything.
// Height arithmetic (ratio x stoneDiameterMm) and the 4-111mm engine bound check are the only
// numeric work it does. The render milestone consumes this plan; resolving the actual
// letterSpacingMm that reaches a separation ratio is that milestone's job, not this one's -- see
// the "separation" tracking target below.
//
// Stone diameters are mirrored from src/renderer/StoneSizes.js (SS10 2.8 / SS16 4.0 / SS20 4.7)
// rather than imported, so this planner's only src/ dependency stays StemRegime.js.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyStemRegime,
  STEM_REGIME,
  MONOLINE_MAX_STEM_WIDTH_RATIO,
  MASSED_MIN_STEM_WIDTH_RATIO
} from '../../src/geometry/StemRegime.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const MANIFEST_PATH = path.join(repoRoot, 'assets/fonts/manifest.json');
const OUT_DIR = path.join(repoRoot, 'docs/data/read-011');
const OUT_PATH = path.join(OUT_DIR, 'render-plan.json');

// --- deterministic PRNG (mulberry32) -- identical to tools/font-certification/calibration-renders.mjs
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One seed drives every stochastic choice in the plan: the per-regime font balancing, the
// size-invariance anchor picks, the repeats selection, and every slug. Recorded in meta.seed so the
// plan is reproducible from this file alone.
const SEED = 0x011b_2026; // READ-011B
const rand = mulberry32(SEED);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const usedSlugs = new Set();
function newSlug() {
  for (;;) {
    let s = '';
    for (let i = 0; i < 8; i++) s += Math.floor(rand() * 16).toString(16);
    if (!usedSlugs.has(s)) { usedSlugs.add(s); return s; }
  }
}

// --- design constants ---------------------------------------------------------------------------

// Stone sizes mirrored from src/renderer/StoneSizes.js.
const SS10 = { id: 'ss10', diameterMm: 2.8 };
const SS16 = { id: 'ss16', diameterMm: 4.0 };
const SS20 = { id: 'ss20', diameterMm: 4.7 };

// app.js RAW_ENGINE_HEIGHT_MM_MIN / _MAX -- the raw em-square heightMm the engine accepts.
const ENGINE_HEIGHT_MIN_MM = 4;
const ENGINE_HEIGHT_MAX_MM = 111;

// The ratio band under test. heightMm = ratio x stoneDiameterMm. At SS10 (2.8mm) rung 16 gives
// 44.8mm -- just below SS10's own supportedHeightRangeMm minimum of 45 (StoneSizes.js). That is
// expected: the whole floor region under investigation sits below the FONT-DECISION-001 validated
// range. Every rung still clears the 4-111mm engine bound.
const RATIO_RUNGS = [16, 17.5, 19, 20.5, 22];
const MODES = ['outline', 'fill'];

// tracking is a BLOCKED factor, not held constant -- see docs/specifications/READ-011B-RatingPassDesign.md.
//   'none'        -- letterSpacingMm 0, the tracking every design in the product's history has used.
//   'separation'  -- a TARGET, not a value. The render milestone resolves the letterSpacingMm that
//                    reaches a separation ratio >= SEPARATION_TARGET_RATIO and records the achieved
//                    values in its own key file. This planner records the intent only and computes
//                    no letterSpacingMm.
const TRACKING_TARGETS = ['none', 'separation'];
const SEPARATION_TARGET_RATIO = 0.95;

const TEXTS = ['Vitalina', 'Emmanuel'];

// The stem-regime strata the main grid crosses. 'unmeasured' (rs-block / rs-modern) is handled by
// its own separate stratum, the rhinestone probe -- it cannot be pooled here because those fonts
// have authored stone positions rather than outlines.
const MAIN_REGIMES = ['monoline', 'transitional', 'massed'];

const REPEATS_COUNT = 15; // mirrors READ-005's 15-render repeats block

// --- load the manifest and build the regime pools ----------------------------------------------

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const fontById = new Map(manifest.fonts.map((f) => [f.id, f]));
const enabledFonts = manifest.fonts.filter((f) => f.enabled !== false);

function regimeOf(fontId) {
  return classifyStemRegime(fontById.get(fontId).stemWidthRatio);
}
function stemWidthRatioOf(fontId) {
  const v = fontById.get(fontId).stemWidthRatio;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const poolByRegime = { monoline: [], transitional: [], massed: [], unmeasured: [] };
for (const f of enabledFonts) poolByRegime[classifyStemRegime(f.stemWidthRatio)].push(f.id);
for (const k of Object.keys(poolByRegime)) poolByRegime[k].sort();

// --- entry factory: the 13 recorded fields, in a fixed order -----------------------------------

function makeEntry({
  fontId, mode, ratio, stone, text, trackingTarget, block, repeatOf = null
}) {
  const heightMm = ratio * stone.diameterMm;
  return {
    slug: newSlug(),
    fontId,
    stemRegime: regimeOf(fontId),
    stemWidthRatio: stemWidthRatioOf(fontId),
    mode,
    ratio,
    stoneSizeId: stone.id,
    stoneDiameterMm: stone.diameterMm,
    heightMm,
    text,
    trackingTarget,
    block,
    repeatOf
  };
}

// --- balanced per-regime font assignment ------------------------------------------------------
//
// Each regime contributes MODES x RATIO_RUNGS x TRACKING_TARGETS = 20 cells to the main grid, two
// fonts per cell -> 40 font slots per regime. Font counts are balanced so each font in the pool
// appears floor(40/pool) or ceil(40/pool) times -- never differing by more than one.

function balancedCounts(pool, total) {
  const base = Math.floor(total / pool.length);
  const rem = total - base * pool.length;
  const counts = new Map(pool.map((id) => [id, base]));
  // Deterministically hand the `rem` extra slots to a seeded subset of the pool.
  for (const id of shuffle(pool).slice(0, rem)) counts.set(id, base + 1);
  return counts;
}

// Cell order is fixed: mode (outer) -> rung -> tracking. mode-outer matters so that the
// (outline, 19, none) anchor cell is assigned before the (fill, 19, none) anchor cell.
function mainCellsForRegime() {
  const cells = [];
  for (const mode of MODES) {
    for (const ratio of RATIO_RUNGS) {
      for (const trackingTarget of TRACKING_TARGETS) {
        cells.push({ mode, ratio, trackingTarget });
      }
    }
  }
  return cells; // 20
}

const ANCHOR_RATIO = 19;

function assignRegime(regime) {
  const pool = poolByRegime[regime];
  const cells = mainCellsForRegime();
  const counts = balancedCounts(pool, cells.length * 2);

  // The size-invariance block needs one font per regime that has an SS10 counterpart at rung 19 in
  // BOTH modes. Force that: pick a seeded anchor font (guaranteed count >= 2 since base >= 3 for
  // every pool), plus two other distinct fonts to partner it in the two anchor cells. Decrementing
  // these reservations from the balanced `counts` keeps the final per-font totals balanced.
  const shuffledPool = shuffle(pool);
  const sizeInvFont = shuffledPool.find((id) => counts.get(id) >= 2) ?? pool[0];
  const partners = shuffledPool.filter((id) => id !== sizeInvFont).slice(0, 2);
  const [partnerOutline, partnerFill] = partners;

  const reservations = new Map(); // cellKey -> [fontId, fontId]
  reservations.set(`outline|${ANCHOR_RATIO}|none`, [sizeInvFont, partnerOutline]);
  reservations.set(`fill|${ANCHOR_RATIO}|none`, [sizeInvFont, partnerFill]);

  const remaining = new Map(counts);
  const dec = (id) => remaining.set(id, remaining.get(id) - 1);
  dec(sizeInvFont); dec(sizeInvFont); dec(partnerOutline); dec(partnerFill);

  // Flatten the remaining counts into a shuffled deck and consume it cell by cell, preferring two
  // distinct fonts per cell.
  const deck = shuffle(
    [...remaining.entries()].flatMap(([id, n]) => Array.from({ length: n }, () => id))
  );
  function take2() {
    const a = deck.shift();
    let bi = deck.findIndex((x) => x !== a);
    if (bi === -1) bi = 0;
    const b = deck.splice(bi, 1)[0];
    return [a, b];
  }

  const assignment = [];
  for (const cell of cells) {
    const key = `${cell.mode}|${cell.ratio}|${cell.trackingTarget}`;
    const fonts = reservations.get(key) ?? take2();
    assignment.push({ ...cell, fonts });
  }
  return { assignment, sizeInvFont };
}

// --- block 1: the main grid --------------------------------------------------------------------

const mainEntries = [];
const sizeInvFontByRegime = {};
let mainTextIdx = 0;

for (const regime of MAIN_REGIMES) {
  const { assignment, sizeInvFont } = assignRegime(regime);
  sizeInvFontByRegime[regime] = sizeInvFont;
  for (const cell of assignment) {
    for (const fontId of cell.fonts) {
      mainEntries.push(makeEntry({
        fontId,
        mode: cell.mode,
        ratio: cell.ratio,
        stone: SS10,
        text: TEXTS[mainTextIdx++ % TEXTS.length],
        trackingTarget: cell.trackingTarget,
        block: 'main'
      }));
    }
  }
}

// --- block 2: size invariance -----------------------------------------------------------------
//
// Rung 19, both modes, none tracking, one font per regime, at SS16 and SS20. Every entry has a
// direct SS10 counterpart already in the main grid (same font, mode, rung), so a size effect can be
// read off the paired renders directly.

const sizeInvarianceEntries = [];
for (const regime of MAIN_REGIMES) {
  const fontId = sizeInvFontByRegime[regime];
  for (const mode of MODES) {
    const counterpart = mainEntries.find(
      (e) => e.fontId === fontId && e.mode === mode && e.ratio === ANCHOR_RATIO
        && e.stoneSizeId === SS10.id && e.trackingTarget === 'none'
    );
    for (const stone of [SS16, SS20]) {
      sizeInvarianceEntries.push(makeEntry({
        fontId,
        mode,
        ratio: ANCHOR_RATIO,
        stone,
        text: counterpart.text,
        trackingTarget: 'none',
        block: 'size-invariance'
      }));
    }
  }
}

// --- block 3: the rhinestone probe ----------------------------------------------------------
//
// rs-block and rs-modern classify as 'unmeasured' -- authored stone positions, no outline to
// measure a stem from -- so they cannot join the stem-regime strata. But rs-block is the default
// Production Font, and a floor with no evidence for the default font is not shippable. This is a
// SEPARATE stratum, marked as such in meta.strata.

const rhinestoneProbeEntries = [];
let probeTextIdx = 0;
for (const fontId of poolByRegime.unmeasured) {
  for (const ratio of [16, 19, 22]) {
    for (const mode of MODES) {
      rhinestoneProbeEntries.push(makeEntry({
        fontId,
        mode,
        ratio,
        stone: SS10,
        text: TEXTS[probeTextIdx++ % TEXTS.length],
        trackingTarget: 'none',
        block: 'rhinestone-probe'
      }));
    }
  }
}

// --- block 4: repeats -----------------------------------------------------------------------
//
// A seeded selection of main-grid entries, duplicated under fresh slugs for rater self-consistency,
// mirroring READ-005's repeats block. repeatOf points back at the source entry's slug.

const repeatSources = shuffle(mainEntries).slice(0, REPEATS_COUNT);
const repeatsEntries = repeatSources.map((src) => makeEntry({
  fontId: src.fontId,
  mode: src.mode,
  ratio: src.ratio,
  stone: { id: src.stoneSizeId, diameterMm: src.stoneDiameterMm },
  text: src.text,
  trackingTarget: src.trackingTarget,
  block: 'repeats',
  repeatOf: src.slug
}));

// --- assemble & write ---------------------------------------------------------------------------

const entries = [
  ...mainEntries,
  ...sizeInvarianceEntries,
  ...rhinestoneProbeEntries,
  ...repeatsEntries
];

const blocks = {
  main: mainEntries.length,
  'size-invariance': sizeInvarianceEntries.length,
  'rhinestone-probe': rhinestoneProbeEntries.length,
  repeats: repeatsEntries.length
};

const plan = {
  meta: {
    milestone: 'READ-011B',
    generatedBy: 'tools/font-certification/read-011-plan.mjs',
    reads: ['assets/fonts/manifest.json', 'src/geometry/StemRegime.js'],
    seed: SEED,
    seedHex: `0x${SEED.toString(16)}`,
    stoneSizeCatalogSource: 'src/renderer/StoneSizes.js',
    stemRegimeBoundaries: {
      monolineMaxStemWidthRatio: MONOLINE_MAX_STEM_WIDTH_RATIO,
      massedMinStemWidthRatio: MASSED_MIN_STEM_WIDTH_RATIO
    },
    engineHeightRangeMm: [ENGINE_HEIGHT_MIN_MM, ENGINE_HEIGHT_MAX_MM],
    mainGrid: {
      factors: {
        stemRegime: MAIN_REGIMES,
        mode: MODES,
        ratioRung: RATIO_RUNGS,
        trackingTarget: TRACKING_TARGETS
      },
      fontsPerCell: 2,
      stoneSize: SS10,
      cellCount: MAIN_REGIMES.length * MODES.length * RATIO_RUNGS.length * TRACKING_TARGETS.length
    },
    texts: TEXTS,
    separationTargetRatio: SEPARATION_TARGET_RATIO,
    strata: [
      { id: 'monoline', kind: 'stem-regime', pool: poolByRegime.monoline },
      { id: 'transitional', kind: 'stem-regime', pool: poolByRegime.transitional },
      { id: 'massed', kind: 'stem-regime', pool: poolByRegime.massed },
      { id: 'rhinestone-probe', kind: 'unmeasured', pool: poolByRegime.unmeasured }
    ],
    sizeInvarianceFonts: sizeInvFontByRegime,
    blocks,
    total: entries.length,
    notes: {
      ratio16Floor:
        'ratio 16 at SS10 gives 44.8mm, just below SS10\'s own supportedHeightRangeMm minimum of '
        + '45 -- expected, since the whole floor region under test sits below the validated range.',
      trackingTarget:
        'trackingTarget "separation" is an intent, not a letterSpacingMm. The render milestone '
        + 'resolves the actual letterSpacingMm reaching a separation ratio >= '
        + `${SEPARATION_TARGET_RATIO} and records the achieved values in its own key file.`,
      rhinestoneProbe:
        'rs-block / rs-modern are a separate "unmeasured" stratum (authored stone positions, no '
        + 'outline stem to measure); they cannot be pooled with the stem-regime strata. Included '
        + 'because rs-block is the default Production Font.'
    }
  },
  entries
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_PATH, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

console.log(`Wrote ${path.relative(repoRoot, OUT_PATH)}`);
console.log(`  total entries: ${entries.length}`);
for (const [name, n] of Object.entries(blocks)) console.log(`  ${name}: ${n}`);
console.log(`  seed: ${plan.meta.seedHex}`);
