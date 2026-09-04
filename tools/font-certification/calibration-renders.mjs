#!/usr/bin/env node
/**
 * READ-005a Part E — the blind human calibration set (spec §5, §6 Step 1).
 *
 *   node tools/font-certification/calibration-renders.mjs [--channel chrome]
 *
 * 135 plain stone-layout renders, drawn from Part D's F+A ladder
 * (tools/font-certification/output/read-005/f-ladder.json — run f-ladder.mjs first), plus a
 * separately-held key.
 *
 *   | block                    |  n | selection                                                        |
 *   |--------------------------|---:|------------------------------------------------------------------|
 *   | interior-fill positives  | 40 | fill/staggered/radial/contour, ratio > 18.3, signal A clearing   |
 *   | F held-out validation    | 40 | 20 with Part D separationRatio >= 0.65, 20 below; across modes    |
 *   | joined scripts           | 20 | 7 named script faces, outline, ratio 24–32                       |
 *   | non-script outline       | 20 | outline, ratio >= 18, non-script faces                           |
 *   | repeats                  | 15 | byte-identical copies of 15 already-chosen renders, fresh slugs  |
 *
 * BLINDING IS THE POINT (spec §5). Each file is `<8 hex>.png` and nothing else. The image contains
 * the stone layout and nothing else — no caption, font, ratio, mode, or filename burned in. Repeats
 * are byte-identical and indistinguishable. Renders are emitted in shuffled order. The key
 * (slug -> {fontId, mode, heightMm, stoneSizeId, ratio, text, block, repeatOf}) is written to a
 * separate file and MUST NOT be echoed to stdout.
 *
 * Both texts ("Vitalina", "Emmanuel") are distributed across every block.
 *
 * Deterministic: a fixed PRNG seed drives both selection and slug assignment, so a re-run
 * reproduces the same set. Rendering needs a browser (Playwright); pass `--channel chrome` on hosts
 * without a bundled Chromium build (macOS 13).
 */
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FontManager } from '../../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../../src/text/index.js';
import { GeometryEngine, separationBand } from '../../src/geometry/index.js';
import { STONE_SIZE_BY_ID } from '../../src/renderer/StoneSizes.js';
import { analyzeOne } from './lib/productionAnalysis.mjs';
import { renderLayoutSvg, RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE } from './lib/specimenPages.mjs';
import { screenshotPages } from './lib/screenshotPages.mjs';
import { JOINED_SCRIPT_FONTS, NON_SCRIPT_FONTS } from './lib/scriptFaceFonts.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const OUT_DIR = path.join(repoRoot, 'tools/font-certification/output/read-005');
const RENDER_DIR = path.join(OUT_DIR, 'calibration-renders');
const KEY_FILE = path.join(OUT_DIR, 'calibration-key.json');
const F_LADDER_FILE = path.join(OUT_DIR, 'f-ladder.json');
const WORK_DIR = path.join(OUT_DIR, 'calibration-work');
const PW_PROFILE_DIR = path.join(OUT_DIR, 'pw-profile-calibration');

const TEXTS = ['Vitalina', 'Emmanuel'];
const DENSE_STONE_SIZE_ID = 'ss10';
const INTERIOR_MODES = ['fill', 'staggered', 'radial', 'contour'];
const F_THRESHOLD = 0.65;

// JOINED_SCRIPT_FONTS (joined-scripts block) and NON_SCRIPT_FONTS (non-script outline block) now
// live in ./lib/scriptFaceFonts.mjs so analyze-ratings.mjs can share them without importing this
// file. See that module's header.

// --- deterministic PRNG (mulberry32) --------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// READ-005a-2 Fix 2 — new seed: the whole set is regenerated with fresh slugs and a fresh selection
// so nothing carries over from the pre-stratification set (which was never looked at).
const rand = mulberry32(0x05a2_2026);

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

// --- candidate pools from the F+A ladder ----------------------------------------------------

function specKey(s) {
  return `${s.fontId}|${s.mode}|${s.ratio}|${s.stoneSizeId}|${s.text}`;
}

function ladderCandidates(ladder, predicate) {
  const out = [];
  for (const cell of Object.values(ladder.cells)) {
    if (!cell.complete) continue;
    for (const rung of cell.dense) {
      for (const text of TEXTS) {
        const bt = rung.byText[text];
        const cand = {
          fontId: cell.fontId,
          mode: cell.mode,
          ratio: rung.ratio,
          stoneSizeId: rung.stoneSizeId,
          heightMm: rung.heightMm,
          text,
          signalA: bt.signalA,
          separationRatio: bt.separationRatio
        };
        if (predicate(cand, cell)) out.push(cand);
      }
    }
  }
  return out;
}

// Round-robin picker: take up to `perGroup` from each group key in turn until `n` are chosen,
// drawing on a shuffled order within each group and a shuffled group order.
function pickSpread(candidates, groupOf, n, perGroupHint, exclude) {
  if (exclude && exclude.size) candidates = candidates.filter((c) => !exclude.has(specKey(c)));
  const groups = new Map();
  for (const c of shuffle(candidates)) {
    const k = groupOf(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const keys = shuffle([...groups.keys()]);
  const chosen = [];
  const seen = new Set();
  let round = 0;
  const perGroup = perGroupHint ?? Math.ceil(n / Math.max(1, keys.length));
  while (chosen.length < n && round < 1000) {
    let progressed = false;
    for (const k of keys) {
      if (chosen.length >= n) break;
      const list = groups.get(k);
      if (round < list.length && (perGroupHint == null || round < perGroup)) {
        const c = list[round];
        const sk = specKey(c);
        if (!seen.has(sk)) { seen.add(sk); chosen.push(c); progressed = true; }
      }
    }
    round++;
    if (!progressed && round > perGroup) break;
  }
  // If spreading left us short (a mode/side with too few candidates), top up from the global pool.
  if (chosen.length < n) {
    for (const c of shuffle(candidates)) {
      if (chosen.length >= n) break;
      const sk = specKey(c);
      if (!seen.has(sk)) { seen.add(sk); chosen.push(c); }
    }
  }
  return chosen.slice(0, n);
}

// --- rendering ----------------------------------------------------------------------------

function pageShell(svgOnly) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>r</title>
<style>
  html { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: #0f1720; }
  main { padding: 40px; display: flex; justify-content: center; }
  svg { display: block; max-width: 100%; height: auto; }
</style>
</head>
<body><main><div>${svgOnly}</div></main></body>
</html>`;
}

function svgWithoutNotes(markup) {
  const end = markup.indexOf('</svg>');
  if (end === -1) return null; // error / zero-stone marker — caller drops the spec
  return markup.slice(0, end + '</svg>'.length);
}

async function run() {
  const channel = process.argv.includes('--channel')
    ? process.argv[process.argv.indexOf('--channel') + 1]
    : undefined;

  const ladder = JSON.parse(await readFile(F_LADDER_FILE, 'utf8'));
  const completeCells = Object.values(ladder.cells).filter((c) => c.complete).length;
  if (completeCells < Object.keys(ladder.cells).length || completeCells === 0) {
    throw new Error(`f-ladder.json is not complete (${completeCells} cells) — run f-ladder.mjs to completion first`);
  }

  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  const fontsById = new Map(fontManager.manifest.fonts.map((f) => [f.id, f]));
  const engine = new GeometryEngine({
    fontProviderRegistry: createDefaultFontProviderRegistry(fontManager, {
      loadFontBuffer: async (rel) => {
        const b = await readFile(path.join(repoRoot, rel));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      }
    })
  });

  // --- block selection --------------------------------------------------------------------
  // A running exclude set keeps blocks disjoint by (font,mode,ratio,size,text): a spec that would
  // render byte-identically under two slugs is a hidden repeat and would corrupt the rater
  // self-consistency measurement. Each block is selected against everything chosen so far.

  const excl = new Set();
  const takeBlock = (list, blockName) => {
    for (const s of list) excl.add(specKey(s));
    return list.map((c) => ({ ...c, block: blockName }));
  };

  const interiorPositives = takeBlock(pickSpread(
    ladderCandidates(ladder, (c) => INTERIOR_MODES.includes(c.mode) && c.ratio > 18.3 && c.signalA === true),
    (c) => `${c.mode}|${c.text}`, 40, null, excl
  ), 'interior-fill-positives');

  // F held-out block, 40 renders: 20 below threshold (band 'merge'), and — stratified per Fix 2 —
  // 10 'aligned' + 10 'fragmented' from the `>= 0.65` half, each spread across the five modes.
  const bandCand = (band) => ladderCandidates(ladder, (c) => separationBand(c.separationRatio) === band);
  const fMerge = takeBlock(pickSpread(bandCand('merge'), (c) => c.mode, 20, 4, excl), 'f-heldout-validation');
  const fAligned = takeBlock(pickSpread(bandCand('aligned'), (c) => c.mode, 10, 2, excl), 'f-heldout-validation');
  const fFragmented = takeBlock(pickSpread(bandCand('fragmented'), (c) => c.mode, 10, 2, excl), 'f-heldout-validation');

  const joinedScripts = takeBlock(pickSpread(
    ladderCandidates(ladder, (c) => JOINED_SCRIPT_FONTS.includes(c.fontId) && c.mode === 'outline' && c.ratio >= 24 && c.ratio <= 32),
    (c) => `${c.fontId}|${c.text}`, 20, null, excl
  ), 'joined-scripts');

  const nonScriptOutline = takeBlock(pickSpread(
    ladderCandidates(ladder, (c) => c.mode === 'outline' && c.ratio >= 18 && NON_SCRIPT_FONTS.has(c.fontId)),
    (c) => `${c.fontId}|${c.text}`, 20, null, excl
  ), 'non-script-outline');

  // Per-block: the selected specs, and the remaining candidate pool to backfill from if a selected
  // spec turns out to render empty. Selection is deterministic; a drop pulls the next pool entry.
  const blockPlan = [
    { name: 'interior-fill-positives', selected: interiorPositives,
      pool: shuffle(ladderCandidates(ladder, (c) => INTERIOR_MODES.includes(c.mode) && c.ratio > 18.3 && c.signalA === true)) },
    // Three band-pure sub-blocks, all labelled 'f-heldout-validation' — backfill stays inside the band.
    { name: 'f-heldout-validation', selected: fMerge, pool: shuffle(bandCand('merge')) },
    { name: 'f-heldout-validation', selected: fAligned, pool: shuffle(bandCand('aligned')) },
    { name: 'f-heldout-validation', selected: fFragmented, pool: shuffle(bandCand('fragmented')) },
    { name: 'joined-scripts', selected: joinedScripts,
      pool: shuffle(ladderCandidates(ladder, (c) => JOINED_SCRIPT_FONTS.includes(c.fontId) && c.mode === 'outline' && c.ratio >= 24 && c.ratio <= 32)) },
    { name: 'non-script-outline', selected: nonScriptOutline,
      pool: shuffle(ladderCandidates(ladder, (c) => c.mode === 'outline' && c.ratio >= 18 && NON_SCRIPT_FONTS.has(c.fontId))) }
  ];

  // Fix 2 step 4 — delete the previous renders and key outright before regenerating, so a stale
  // slug can never survive alongside the fresh set.
  await rm(WORK_DIR, { recursive: true, force: true });
  await mkdir(WORK_DIR, { recursive: true });
  await rm(RENDER_DIR, { recursive: true, force: true });
  await mkdir(RENDER_DIR, { recursive: true });
  await rm(KEY_FILE, { force: true });

  const chosenKeys = new Set(
    [...interiorPositives, ...fMerge, ...fAligned, ...fFragmented, ...joinedScripts, ...nonScriptOutline].map(specKey)
  );
  const pageJobs = []; // { htmlFile, pngFile, slug, spec }

  async function renderSpec(spec, blockName) {
    const font = fontsById.get(spec.fontId);
    const measurement = await analyzeOne(
      engine, spec.fontId, spec.text, spec.stoneSizeId, spec.heightMm,
      { mode: spec.mode, providerId: font?.providerId }
    );
    if (measurement.error || measurement.stoneCount === 0) return false;
    const pxPerMm = RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE[spec.stoneSizeId];
    const svg = svgWithoutNotes(renderLayoutSvg(measurement, pxPerMm));
    if (!svg) return false;
    const slug = newSlug();
    await writeFile(path.join(WORK_DIR, `${slug}.html`), pageShell(svg), 'utf8');
    pageJobs.push({
      htmlFile: `${slug}.html`,
      pngFile: path.join(RENDER_DIR, `${slug}.png`),
      slug,
      spec: { ...spec, block: blockName, separationBand: separationBand(spec.separationRatio) }
    });
    return true;
  }

  for (const { name, selected, pool } of blockPlan) {
    const target = selected.length;
    let made = 0;
    for (const spec of selected) {
      if (await renderSpec(spec, name)) { made++; chosenKeys.add(specKey(spec)); }
    }
    for (const spec of pool) {
      if (made >= target) break;
      if (chosenKeys.has(specKey(spec))) continue;
      chosenKeys.add(specKey(spec));
      if (await renderSpec(spec, name)) made++;
    }
    if (made < target) throw new Error(`block ${name}: only ${made}/${target} renders — candidate pool exhausted`);
  }

  // --- repeats: 15 exact duplicates of already-chosen renders ------------------------------

  const repeatSources = shuffle(pageJobs).slice(0, 15);
  const repeatJobs = repeatSources.map((src) => ({
    copyFrom: path.join(RENDER_DIR, `${src.slug}.png`),
    slug: newSlug(),
    spec: { ...src.spec, block: 'repeats', repeatOf: src.slug }
  }));

  // --- emit in shuffled order ------------------------------------------------------------

  const emissionOrder = shuffle([
    ...pageJobs.map((j) => ({ kind: 'render', ...j })),
    ...repeatJobs.map((j) => ({ kind: 'copy', ...j }))
  ]);

  // Screenshot every fresh render in ONE browser context.
  const toShoot = emissionOrder.filter((j) => j.kind === 'render')
    .map((j) => ({ htmlFile: j.htmlFile, pngFile: j.pngFile }));
  if (toShoot.length) {
    await screenshotPages({
      dir: WORK_DIR,
      pages: toShoot,
      profileDir: PW_PROFILE_DIR,
      channel
    });
  }
  // Then materialise the byte-identical repeats.
  for (const j of emissionOrder) {
    if (j.kind === 'copy') await copyFile(j.copyFrom, path.join(RENDER_DIR, `${j.slug}.png`));
  }

  // --- key --------------------------------------------------------------------------------

  const key = {};
  for (const j of emissionOrder) {
    key[j.slug] = {
      fontId: j.spec.fontId,
      mode: j.spec.mode,
      heightMm: j.spec.heightMm,
      stoneSizeId: j.spec.stoneSizeId,
      ratio: j.spec.ratio,
      text: j.spec.text,
      block: j.spec.block,
      separationRatio: Number.isFinite(j.spec.separationRatio) ? j.spec.separationRatio : null,
      separationBand: j.spec.separationBand ?? separationBand(j.spec.separationRatio),
      repeatOf: j.spec.repeatOf ?? null
    };
  }
  await writeFile(KEY_FILE, JSON.stringify(key, null, 2), 'utf8');
  await rm(WORK_DIR, { recursive: true, force: true });

  // --- report: paths + counts ONLY (no slugs, no key contents) --------------------------

  const perBlock = {};
  const heldoutBand = { merge: 0, aligned: 0, fragmented: 0, other: 0 };
  for (const entry of Object.values(key)) {
    perBlock[entry.block] = (perBlock[entry.block] ?? 0) + 1;
    if (entry.block === 'f-heldout-validation') {
      heldoutBand[entry.separationBand ?? 'other'] = (heldoutBand[entry.separationBand ?? 'other'] ?? 0) + 1;
    }
  }
  console.log('render directory:', RENDER_DIR);
  console.log('key file:        ', KEY_FILE);
  console.log('total files:     ', Object.keys(key).length);
  console.log('per-block counts:');
  for (const b of ['interior-fill-positives', 'f-heldout-validation', 'joined-scripts', 'non-script-outline', 'repeats']) {
    console.log(`  ${b}: ${perBlock[b] ?? 0}`);
  }
  console.log('f-heldout-validation band split:');
  console.log(`  merge (< 0.65): ${heldoutBand.merge}   aligned [0.65, 1.35): ${heldoutBand.aligned}   fragmented (>= 1.35): ${heldoutBand.fragmented}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
