#!/usr/bin/env node
/**
 * READ-005 tracking experiment — does added inter-glyph spacing fix the crowding rejections?
 *
 *   node tools/font-certification/tracking-renders.mjs [--channel chrome] [--dump-notes]
 *
 * Not part of the READ-005 sweep. One intervention (`letterSpacingMm`, which the product has never
 * used and `analyzeOne()` silently dropped until Part A of this experiment) tested against the
 * second-largest rejection cause in the 135-render calibration set: "letters too close".
 *
 * Reads (never writes):
 *   output/read-005/calibration-key.json   — the blind key for the rated calibration set
 *   output/read-005/ratings.csv            — that set's completed ratings (slug,readable,sellable,notes)
 *
 * Writes:
 *   output/read-005/tracking-renders/<8 hex>.png   — 75 blind renders
 *   output/read-005/tracking-key.json              — the held-back key
 *
 * 75 renders, four blocks + repeats. The spec's table names paired-tracked/paired-control at 25
 * each; the rated CSV's 25 crowding-note rejection *rows* resolve to only 24 distinct *cases* (one
 * case, `db9f7eae`, is crowding-tagged on both its own row and its repeat row). Per the experiment
 * owner's call, the pair blocks are 24 each and the +1/+1 slack is absorbed by the two control
 * blocks so the total stays 75:
 *   paired-tracked  24  every crowding-rejected case, re-rendered at its own separation-achieving tracking
 *   paired-control  24  the SAME 24 cases at zero tracking, fresh slugs (detects rater drift)
 *   specificity     11  cases rejected for "inaccurate" (not crowding), at 2.0 x pitch (checks F-specificity)
 *   harm             9  cases already rated sellable, at 2.0 x pitch (checks over-spacing does no harm)
 *   repeats          7  byte-identical duplicates of 7 renders chosen above, fresh slugs
 *
 * Blinding matches calibration-renders.mjs exactly: opaque <8 hex>.png names, no caption/metadata in
 * the image, the same dark page shell, shuffled emission, a fresh PRNG seed, and the key written
 * only to tracking-key.json. Additionally the two members of every pair are kept >= 15 positions
 * apart in emission order (and, by the same rationale, every repeat is kept >= 15 from its source).
 */
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FontManager } from '../../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../../src/text/index.js';
import { GeometryEngine } from '../../src/geometry/index.js';
import { STONE_SIZE_BY_ID } from '../../src/renderer/StoneSizes.js';
import { analyzeOne, PRODUCTION_GAP_MM } from './lib/productionAnalysis.mjs';
import { expectedComponentCount } from './lib/glyphSeparation.mjs';
import { renderLayoutSvg, RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE } from './lib/specimenPages.mjs';
import { screenshotPages } from './lib/screenshotPages.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const OUT_DIR = path.join(repoRoot, 'tools/font-certification/output/read-005');
const CALIB_KEY_FILE = path.join(OUT_DIR, 'calibration-key.json');
const RATINGS_FILE = path.join(OUT_DIR, 'ratings.csv');
const RENDER_DIR = path.join(OUT_DIR, 'tracking-renders');
const KEY_FILE = path.join(OUT_DIR, 'tracking-key.json');
const WORK_DIR = path.join(OUT_DIR, 'tracking-work');
const PW_PROFILE_DIR = path.join(OUT_DIR, 'pw-profile-tracking');

// Per-case tracking sweep (spec Part B): letterSpacingMm over these multiples of pitchMm, take the
// LOWEST where clusterCount / expectedComponentCount >= FULL_SEPARATION. The two cases that never
// reach it use 4 x pitch with separationAchieved: false.
const TRACKING_XPITCH_LADDER = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
const FULL_SEPARATION = 0.95;
const CONTROL_XPITCH = 2.0; // specificity + harm blocks

const MIN_PAIR_DISTANCE = 15; // emission-order positions between a pair's two members

// Block sizes (see the header note on why the pair blocks are 24, not the spec table's 25).
const PAIRED_TARGET = 24;      // exact — every distinct crowding-rejected case
const SPECIFICITY_TARGET = 11; // spec 10, +1 rebalance
const HARM_TARGET = 9;         // spec 8, +1 rebalance
const REPEAT_TARGET = 7;

// --- categorising the rated notes ----------------------------------------------------------
// TUNABLE. These patterns partition the rejections into "crowding" vs "inaccurate". Verified
// against this CSV to select exactly the 25 crowding-note rejection rows — 24 distinct cases (one
// case, db9f7eae, is crowding-tagged on both its own row and its repeat row) — which is the
// "25 of 89 rejections" the spec's §Background refers to. If a run does not land on exactly
// PAIRED_TARGET crowding cases, >= SPECIFICITY_TARGET inaccurate, and >= HARM_TARGET sellable, the
// script prints the full categorisation and stops — it never approximates. Covers the rater's
// spellings and typos: "too close", "too little/no/not equal spacing between letters",
// "extremely close", and the letter-collision notes ("i croosed with t", "i intercent t").
const CROWDING_RE = /(too close|close together|close to each other|extremely close|too little spacing|no spacing between|not equal spacing|spacing between letters|croos|intercent|interc(e|t))/i;
// Any "inaccurate" / "inaccuarte" spelling — the rater's word for a glyph that renders as the
// wrong shape. Crowding is subtracted first (a note saying both goes to the pair blocks).
const INACCURATE_RE = /(inaccu|inacu)/i;

// --- deterministic PRNG (mulberry32) — fresh seed, distinct from calibration's 0x05a2_2026 --------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x05a3_2026);

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

// --- CSV parsing --------------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// The slug cell is either a bare slug or a spreadsheet =HYPERLINK("file://…/<slug>.png","<slug>")
// formula. Pull the first 8-hex token either way.
function slugFromCell(cell) {
  const m = String(cell).match(/([0-9a-f]{8})/i);
  return m ? m[1].toLowerCase() : null;
}

function loadRatings(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) throw new Error('ratings.csv is empty');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {
    slug: header.indexOf('slug'),
    readable: header.indexOf('readable'),
    sellable: header.indexOf('sellable'),
    notes: header.indexOf('notes')
  };
  if (idx.slug < 0 || idx.sellable < 0) {
    throw new Error(`ratings.csv header is not "slug,readable,sellable,notes" (got: ${header.join(',')})`);
  }
  const out = [];
  for (const r of rows.slice(1)) {
    const slug = slugFromCell(r[idx.slug] ?? '');
    if (!slug) continue;
    out.push({
      slug,
      readable: (r[idx.readable] ?? '').trim().toLowerCase(),
      sellable: (r[idx.sellable] ?? '').trim().toLowerCase(),
      notes: (r[idx.notes] ?? '').trim()
    });
  }
  return out;
}

// --- page shell (identical to calibration-renders.mjs so the two sets stay comparable) -----

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
  if (end === -1) return null;
  return markup.slice(0, end + '</svg>'.length);
}

// --- one measurement -------------------------------------------------------------------------

async function measure(engine, providerId, spec, letterSpacingMm) {
  return analyzeOne(engine, spec.fontId, spec.text, spec.stoneSizeId, spec.heightMm, {
    mode: spec.mode,
    providerId,
    letterSpacingMm
  });
}

function pitchMmFor(stoneSizeId) {
  return STONE_SIZE_BY_ID[stoneSizeId].diameterMm + PRODUCTION_GAP_MM;
}

// Sweep the tracking ladder for a paired-tracked case; return the chosen letterSpacing and the
// before/after separation numbers. `expectedComponents` is the signal-F denominator (per-character
// overlap-component sum) — invariant to tracking, so measured once.
async function chooseTracking(engine, providerId, spec) {
  const pitchMm = pitchMmFor(spec.stoneSizeId);
  const expectedComponents = await expectedComponentCount(engine, spec.fontId, spec.text, providerId);
  const rungs = [];
  for (const xPitch of TRACKING_XPITCH_LADDER) {
    const ls = Number((xPitch * pitchMm).toFixed(6));
    const m = await measure(engine, providerId, spec, ls);
    const ratio = (!m.error && expectedComponents > 0 && Number.isFinite(m.clusterCount))
      ? m.clusterCount / expectedComponents
      : null;
    rungs.push({ xPitch, letterSpacingMm: ls, separationRatio: ratio, widthMm: m.boundingBoxMm?.widthMm ?? null, error: m.error });
  }
  const before = rungs[0];
  let chosen = rungs.find((r) => Number.isFinite(r.separationRatio) && r.separationRatio >= FULL_SEPARATION) ?? null;
  let separationAchieved = true;
  if (!chosen) {
    chosen = rungs[rungs.length - 1]; // 4 x pitch
    separationAchieved = false;
  }
  return { pitchMm, expectedComponents, before, chosen, separationAchieved, rungs };
}

// --- constrained emission order ----------------------------------------------------------------
// Place all items in a seeded shuffle, then repair: while any constrained pair is < MIN_PAIR_DISTANCE
// apart, lift one member (seeded choice) and reinsert it at a seeded-random slot that satisfies all
// of that member's constraints. Deterministic; throws if it cannot converge.

function orderWithConstraints(ids, constraints) {
  const partners = new Map(ids.map((id) => [id, []]));
  for (const [a, b] of constraints) { partners.get(a).push(b); partners.get(b).push(a); }

  let seq = shuffle(ids);
  const posOf = () => new Map(seq.map((id, i) => [id, i]));

  for (let iter = 0; iter < 50000; iter++) {
    const pos = posOf();
    let violation = null;
    for (const [a, b] of constraints) {
      if (Math.abs(pos.get(a) - pos.get(b)) < MIN_PAIR_DISTANCE) { violation = [a, b]; break; }
    }
    if (!violation) return seq;

    const mover = violation[rand() < 0.5 ? 0 : 1];
    const without = seq.filter((id) => id !== mover);
    const partnerPos = partners.get(mover).map((p) => without.indexOf(p));
    const valid = [];
    for (let slot = 0; slot <= without.length; slot++) {
      if (partnerPos.every((pp) => Math.abs(slot - pp) >= MIN_PAIR_DISTANCE)) valid.push(slot);
    }
    if (!valid.length) continue; // try a different mover next iteration
    const slot = valid[Math.floor(rand() * valid.length)];
    without.splice(slot, 0, mover);
    seq = without;
  }
  throw new Error('could not satisfy the >= 15 pair-distance constraint after 50000 repair steps');
}

// --- main ------------------------------------------------------------------------------------

// Group every rating row by the underlying calibration case (a 'repeats' slug resolves to its
// source), so a case rated twice — once as itself, once as a reshuffled repeat — is one case. A
// case counts as a rejection if ANY of its rows says sellable=no; as sellable only if it has a
// yes and no no. Its note text is the concatenation of all its rows' notes, so a crowding
// complaint on either the original or the repeat row makes the case crowding.
function categorise(rows, keyBySlug) {
  const byCase = new Map();
  for (const row of rows) {
    const keyEntry = keyBySlug[row.slug];
    if (!keyEntry) continue;
    const originalSlug = keyEntry.repeatOf ?? row.slug;
    const src = keyBySlug[originalSlug];
    if (!src) continue;
    if (!byCase.has(originalSlug)) {
      byCase.set(originalSlug, {
        originalSlug,
        spec: {
          fontId: src.fontId, mode: src.mode, heightMm: src.heightMm,
          stoneSizeId: src.stoneSizeId, ratio: src.ratio, text: src.text,
          calibrationSeparationRatio: src.separationRatio ?? null
        },
        verdicts: [], notesParts: []
      });
    }
    const c = byCase.get(originalSlug);
    if (row.sellable) c.verdicts.push(row.sellable);
    if (row.notes) c.notesParts.push(row.notes);
  }

  const rejections = [];
  const sellables = [];
  for (const c of byCase.values()) {
    c.notes = c.notesParts.join(' | ');
    if (c.verdicts.includes('no')) rejections.push(c);
    else if (c.verdicts.includes('yes')) sellables.push(c);
  }
  for (const r of rejections) {
    r.crowding = CROWDING_RE.test(r.notes);
    r.inaccurate = !r.crowding && INACCURATE_RE.test(r.notes);
  }
  return { rejections, sellables };
}

function dumpCategorisation({ rejections, sellables }) {
  const line = (r, tag) => `  [${tag}] ${r.originalSlug}  ${r.spec.fontId}/${r.spec.mode} r=${r.spec.ratio}  "${r.notes}"`;
  console.log(`\nrejections (sellable=no): ${rejections.length}`);
  for (const r of rejections) console.log(line(r, r.crowding ? 'CROWD' : r.inaccurate ? 'INACC' : 'other'));
  console.log(`\nsellable (sellable=yes): ${sellables.length}`);
  for (const r of sellables) console.log(line(r, 'sell'));
  const crowd = rejections.filter((r) => r.crowding).length;
  const inacc = rejections.filter((r) => r.inaccurate).length;
  console.log(`\ncrowding-rejected: ${crowd}   inaccurate-rejected: ${inacc}   sellable: ${sellables.length}`);
}

async function run() {
  const args = process.argv.slice(2);
  const channel = args.includes('--channel') ? args[args.indexOf('--channel') + 1] : undefined;
  const dumpOnly = args.includes('--dump-notes');

  let ratingsText;
  try {
    ratingsText = await readFile(RATINGS_FILE, 'utf8');
  } catch {
    throw new Error(`${RATINGS_FILE} not found — the calibration rating pass must be complete before this experiment can run.`);
  }
  const rows = loadRatings(ratingsText);
  const ratedCount = rows.filter((r) => r.readable || r.sellable).length;
  if (ratedCount === 0) {
    throw new Error(
      `${RATINGS_FILE} exists but contains no ratings (all ${rows.length} rows blank). ` +
      `It is the pre-rating template, not the completed set — cannot select cases. Stopping.`
    );
  }

  const calibKey = JSON.parse(await readFile(CALIB_KEY_FILE, 'utf8'));

  const cat = categorise(rows, calibKey);
  if (dumpOnly) { dumpCategorisation(cat); return; }

  const crowdingRejected = cat.rejections.filter((r) => r.crowding);
  const inaccurateRejected = cat.rejections.filter((r) => r.inaccurate);

  const problems = [];
  if (crowdingRejected.length !== PAIRED_TARGET) problems.push(`crowding-rejected cases is ${crowdingRejected.length}, expected exactly ${PAIRED_TARGET}`);
  if (inaccurateRejected.length < SPECIFICITY_TARGET) problems.push(`inaccurate-rejected cases is ${inaccurateRejected.length}, need >= ${SPECIFICITY_TARGET} for the specificity block`);
  if (cat.sellables.length < HARM_TARGET) problems.push(`sellable cases is ${cat.sellables.length}, need >= ${HARM_TARGET} for the harm block`);
  if (problems.length) {
    dumpCategorisation(cat);
    throw new Error(`\ncannot build the render set as specified:\n - ${problems.join('\n - ')}\n` +
      `Adjust CROWDING_RE / INACCURATE_RE at the top of this file, or re-check the ratings.`);
  }

  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  const providerById = new Map(fontManager.manifest.fonts.map((f) => [f.id, f.providerId]));
  const engine = new GeometryEngine({
    fontProviderRegistry: createDefaultFontProviderRegistry(fontManager, {
      loadFontBuffer: async (rel) => {
        const b = await readFile(path.join(repoRoot, rel));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      }
    })
  });

  // --- build the four content blocks (specs + applied tracking) ---------------------------

  const items = []; // { slug, spec, block, letterSpacingMm, letterSpacingXPitch, before, after,
                    //   separationAchieved, widthMm, widthGrowthPct, pairedKey, repeatOf, originalSlug }

  // paired-tracked + paired-control, 1:1.
  const specificityPool = shuffle(inaccurateRejected).slice(0, SPECIFICITY_TARGET);
  const harmPool = shuffle(cat.sellables).slice(0, HARM_TARGET);

  for (const rec of crowdingRejected) {
    const providerId = providerById.get(rec.spec.fontId);
    const sweep = await chooseTracking(engine, providerId, rec.spec);
    const beforeWidth = sweep.before.widthMm;
    const afterMeasure = await measure(engine, providerId, rec.spec, sweep.chosen.letterSpacingMm);
    const afterWidth = afterMeasure.boundingBoxMm?.widthMm ?? null;
    const growth = (Number.isFinite(beforeWidth) && beforeWidth > 0 && Number.isFinite(afterWidth))
      ? ((afterWidth - beforeWidth) / beforeWidth) * 100 : null;

    const pairKey = `pair:${rec.originalSlug}`;

    // tracked
    items.push({
      slug: newSlug(), spec: rec.spec, block: 'paired-tracked',
      letterSpacingMm: sweep.chosen.letterSpacingMm,
      letterSpacingXPitch: sweep.chosen.xPitch,
      separationRatioBefore: sweep.before.separationRatio,
      separationRatioAfter: sweep.chosen.separationRatio,
      separationAchieved: sweep.separationAchieved,
      widthMm: afterWidth,
      widthGrowthPct: growth,
      pairKey, repeatOf: null, originalSlug: rec.originalSlug
    });
    // control — SAME case, zero tracking
    items.push({
      slug: newSlug(), spec: rec.spec, block: 'paired-control',
      letterSpacingMm: 0,
      letterSpacingXPitch: 0,
      separationRatioBefore: sweep.before.separationRatio,
      separationRatioAfter: sweep.before.separationRatio,
      separationAchieved: Number.isFinite(sweep.before.separationRatio) && sweep.before.separationRatio >= FULL_SEPARATION,
      widthMm: beforeWidth,
      widthGrowthPct: 0,
      pairKey, repeatOf: null, originalSlug: rec.originalSlug
    });
  }

  // specificity + harm — fixed CONTROL_XPITCH tracking.
  for (const [pool, block] of [[specificityPool, 'specificity'], [harmPool, 'harm']]) {
    for (const rec of pool) {
      const providerId = providerById.get(rec.spec.fontId);
      const pitchMm = pitchMmFor(rec.spec.stoneSizeId);
      const ls = Number((CONTROL_XPITCH * pitchMm).toFixed(6));
      const expectedComponents = await expectedComponentCount(engine, rec.spec.fontId, rec.spec.text, providerId);
      const m0 = await measure(engine, providerId, rec.spec, 0);
      const m1 = await measure(engine, providerId, rec.spec, ls);
      const sep = (m) => (!m.error && expectedComponents > 0 && Number.isFinite(m.clusterCount))
        ? m.clusterCount / expectedComponents : null;
      const w0 = m0.boundingBoxMm?.widthMm ?? null;
      const w1 = m1.boundingBoxMm?.widthMm ?? null;
      const growth = (Number.isFinite(w0) && w0 > 0 && Number.isFinite(w1)) ? ((w1 - w0) / w0) * 100 : null;
      items.push({
        slug: newSlug(), spec: rec.spec, block,
        letterSpacingMm: ls,
        letterSpacingXPitch: CONTROL_XPITCH,
        separationRatioBefore: sep(m0),
        separationRatioAfter: sep(m1),
        separationAchieved: (() => { const s = sep(m1); return Number.isFinite(s) && s >= FULL_SEPARATION; })(),
        widthMm: w1,
        widthGrowthPct: growth,
        pairKey: null, repeatOf: null, originalSlug: rec.originalSlug
      });
    }
  }

  // --- render every non-repeat item ------------------------------------------------------

  await rm(WORK_DIR, { recursive: true, force: true });
  await mkdir(WORK_DIR, { recursive: true });
  await rm(RENDER_DIR, { recursive: true, force: true });
  await mkdir(RENDER_DIR, { recursive: true });
  await rm(KEY_FILE, { force: true });

  const pageJobs = [];
  for (const it of items) {
    const providerId = providerById.get(it.spec.fontId);
    const m = await measure(engine, providerId, it.spec, it.letterSpacingMm);
    if (m.error || m.stoneCount === 0) {
      throw new Error(`render failed for ${it.block} ${it.spec.fontId}/${it.spec.mode} r=${it.spec.ratio}: ${m.error ?? 'zero stones'}`);
    }
    const pxPerMm = RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE[it.spec.stoneSizeId];
    const svg = svgWithoutNotes(renderLayoutSvg(m, pxPerMm));
    if (!svg) throw new Error(`renderLayoutSvg produced no <svg> for ${it.slug}`);
    await writeFile(path.join(WORK_DIR, `${it.slug}.html`), pageShell(svg), 'utf8');
    pageJobs.push({ htmlFile: `${it.slug}.html`, pngFile: path.join(RENDER_DIR, `${it.slug}.png`), item: it });
  }

  // --- repeats: 7 byte-identical duplicates of already-chosen renders --------------------

  const repeatSources = shuffle(pageJobs).slice(0, REPEAT_TARGET);
  const repeatItems = repeatSources.map(({ item: src }) => ({
    slug: newSlug(),
    spec: src.spec,
    block: 'repeats',
    letterSpacingMm: src.letterSpacingMm,
    letterSpacingXPitch: src.letterSpacingXPitch,
    separationRatioBefore: src.separationRatioBefore,
    separationRatioAfter: src.separationRatioAfter,
    separationAchieved: src.separationAchieved,
    widthMm: src.widthMm,
    widthGrowthPct: src.widthGrowthPct,
    pairKey: null,
    repeatOf: src.slug,
    originalSlug: src.originalSlug,
    copyFrom: path.join(RENDER_DIR, `${src.slug}.png`)
  }));

  // --- emission order with the >= 15 constraints ----------------------------------------

  const allItems = [...items, ...repeatItems];
  const bySlug = new Map(allItems.map((it) => [it.slug, it]));
  const ids = allItems.map((it) => it.slug);

  const constraints = [];
  // pair members
  const pairMap = new Map();
  for (const it of items) {
    if (!it.pairKey) continue;
    if (!pairMap.has(it.pairKey)) pairMap.set(it.pairKey, []);
    pairMap.get(it.pairKey).push(it.slug);
  }
  for (const [, [a, b]] of pairMap) constraints.push([a, b]);
  // repeat <-> source
  for (const r of repeatItems) constraints.push([r.slug, r.repeatOf]);

  const order = orderWithConstraints(ids, constraints);

  // --- screenshot fresh renders in ONE browser context, then materialise the repeats ----

  const toShoot = order
    .map((slug) => bySlug.get(slug))
    .filter((it) => it.block !== 'repeats')
    .map((it) => ({ htmlFile: `${it.slug}.html`, pngFile: path.join(RENDER_DIR, `${it.slug}.png`) }));
  if (toShoot.length) {
    await screenshotPages({ dir: WORK_DIR, pages: toShoot, profileDir: PW_PROFILE_DIR, channel });
  }
  for (const slug of order) {
    const it = bySlug.get(slug);
    if (it.block === 'repeats') await copyFile(it.copyFrom, path.join(RENDER_DIR, `${slug}.png`));
  }

  // --- key (held back) -----------------------------------------------------------------

  const round = (v, d = 4) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
  const pairedWithBySlug = new Map();
  for (const [, [a, b]] of pairMap) { pairedWithBySlug.set(a, b); pairedWithBySlug.set(b, a); }

  const key = {};
  for (const slug of order) {
    const it = bySlug.get(slug);
    key[slug] = {
      fontId: it.spec.fontId,
      mode: it.spec.mode,
      heightMm: it.spec.heightMm,
      stoneSizeId: it.spec.stoneSizeId,
      ratio: it.spec.ratio,
      text: it.spec.text,
      block: it.block,
      letterSpacingMm: round(it.letterSpacingMm, 6),
      letterSpacingXPitch: round(it.letterSpacingXPitch, 4),
      separationRatioBefore: round(it.separationRatioBefore),
      separationRatioAfter: round(it.separationRatioAfter),
      separationAchieved: it.separationAchieved,
      widthMm: round(it.widthMm),
      widthGrowthPct: round(it.widthGrowthPct, 2),
      pairedWith: pairedWithBySlug.get(slug) ?? null,
      repeatOf: it.repeatOf ?? null,
      originalSlug: it.originalSlug
    };
  }
  await writeFile(KEY_FILE, JSON.stringify(key, null, 2), 'utf8');
  await rm(WORK_DIR, { recursive: true, force: true });

  // --- report: paths + counts ONLY -----------------------------------------------------

  const perBlock = {};
  for (const v of Object.values(key)) perBlock[v.block] = (perBlock[v.block] ?? 0) + 1;

  const pos = new Map(order.map((slug, i) => [slug, i]));
  let minPairDist = Infinity;
  for (const [, [a, b]] of pairMap) minPairDist = Math.min(minPairDist, Math.abs(pos.get(a) - pos.get(b)));

  console.log('render directory:  ', RENDER_DIR);
  console.log('key file:          ', KEY_FILE);
  console.log('total files:       ', Object.keys(key).length);
  console.log('per-block counts:');
  for (const b of ['paired-tracked', 'paired-control', 'specificity', 'harm', 'repeats']) {
    console.log(`  ${b}: ${perBlock[b] ?? 0}`);
  }
  console.log('min emission-order distance between a pair\'s two members:', minPairDist);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run().catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  });
}
