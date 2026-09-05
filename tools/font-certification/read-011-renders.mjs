#!/usr/bin/env node
/**
 * READ-011C — render the rating-pass specimens and build the blind rating sheet.
 *
 *   node tools/font-certification/read-011-renders.mjs [--channel chrome]
 *
 * Consumes the FROZEN design docs/data/read-011/render-plan.json (READ-011B) and never writes it.
 * For every one of its 159 entries it produces one opaque-slug specimen PNG, then a single blind
 * rating page over all of them in a seeded-shuffled presentation order.
 *
 * Follows calibration-renders.mjs / tracking-renders.mjs exactly: SVG generated through src/ (the
 * GeometryEngine StoneLayout -> renderLayoutSvg), one dark HTML work page per specimen, Playwright
 * screenshots in a single browser context, blinded <8 hex>.png names with nothing burned into the
 * image, and the key written to a separate file — here docs/data/read-011/render-key.json (tracked).
 *
 * trackingTarget resolution (plan note "trackingTarget \"separation\" is an intent, not a
 * letterSpacingMm"): entries with trackingTarget 'separation' are run through chooseTracking() from
 * ./lib/trackingSolver.mjs — the SAME sweep tracking-renders.mjs uses — to find the lowest letter
 * spacing reaching a separation ratio >= 0.95. Where 0.95 is unreachable the best achievable ladder
 * rung is recorded and separationAchieved is set false; an entry is never labelled separation-tracked
 * when it isn't. 'none' entries render at zero letter spacing.
 *
 * Outputs (all under tools/font-certification/output/read-011/, gitignored):
 *   renders/<8 hex>.png     159 specimen images
 *   work/<8 hex>.html       per-specimen work pages (deleted after the run)
 *   pw-profile/             Playwright persistent profile (deleted after the run)
 *   rating.html             the blind rating sheet (built through make-rating-page.mjs)
 * Tracked outputs:
 *   docs/data/read-011/render-key.json   every plan field + the four tracking fields + presentationIndex
 *   docs/data/read-011/ratings.csv       blank template, header byte-identical to read-005/ratings.csv
 */
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FontManager } from '../../src/fonts/index.js';
import { createDefaultFontProviderRegistry } from '../../src/text/index.js';
import { GeometryEngine } from '../../src/geometry/index.js';
import { analyzeOne } from './lib/productionAnalysis.mjs';
import { renderLayoutSvg, RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE } from './lib/specimenPages.mjs';
import { screenshotPages } from './lib/screenshotPages.mjs';
import { chooseTracking, bestRung, SEPARATION_TARGET } from './lib/trackingSolver.mjs';
import { buildRatingPageHtml } from './make-rating-page.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const PLAN_FILE = path.join(repoRoot, 'docs/data/read-011/render-plan.json');
const KEY_FILE = path.join(repoRoot, 'docs/data/read-011/render-key.json');
const RATINGS_TEMPLATE_FILE = path.join(repoRoot, 'docs/data/read-011/ratings.csv');
const READ_005_RATINGS_FILE = path.join(repoRoot, 'docs/data/read-005/ratings.csv');

const OUT_DIR = path.join(repoRoot, 'tools/font-certification/output/read-011');
const RENDER_DIR = path.join(OUT_DIR, 'renders');
const WORK_DIR = path.join(OUT_DIR, 'work');
const PW_PROFILE_DIR = path.join(OUT_DIR, 'pw-profile');
const RATING_HTML = path.join(OUT_DIR, 'rating.html');

// Seed for the presentation shuffle (distinct from the plan's own 0x11b2026). Recorded in the key.
const PRESENTATION_SEED = 0x011c2026;

// --- deterministic PRNG (mulberry32) — matches calibration-renders.mjs / tracking-renders.mjs -----

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- page shell (identical to calibration/tracking so all READ-005/011 sets stay comparable) ------

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

const round = (v, d = 4) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

// Every field the plan records on an entry — carried through the key verbatim.
const PLAN_FIELDS = [
  'slug', 'fontId', 'stemRegime', 'stemWidthRatio', 'mode', 'ratio', 'stoneSizeId',
  'stoneDiameterMm', 'heightMm', 'text', 'trackingTarget', 'block', 'repeatOf'
];

// The full render spec — two entries with the same tuple render byte-identically.
const SPEC_FIELDS = ['fontId', 'mode', 'ratio', 'stoneSizeId', 'text', 'letterSpacingMm'];
const specSignature = (e) => SPEC_FIELDS.map((f) => e[f]).join('|');

/**
 * Three fields derived purely from values already on each key entry — no geometry, no rendering.
 * Mutates `entries` in place (appending the fields, so they serialise after presentationIndex) and
 * returns it. Safe to re-run: recomputes from the same inputs every time.
 *
 *   separationDelta       separationRatioAfter - separationRatioBefore (4dp); null unless both are
 *                         finite numbers, i.e. null for every trackingTarget 'none' entry. A raw
 *                         measurement — deliberately NOT bucketed into pass/fail categories.
 *   identicalToUntracked  true when trackingTarget is 'separation' and the resolved letterSpacingMm
 *                         is 0 (the solve collapsed to the untracked spec); false for other
 *                         separation entries; null for 'none' entries (the N/A convention the key
 *                         already uses for the separation numbers).
 *   duplicateOf           slug of the earliest-by-presentationIndex entry sharing this entry's full
 *                         render spec (SPEC_FIELDS); null if this entry is that earliest one. This
 *                         is spec-collision detection across the WHOLE set — mostly a separation arm
 *                         that collapsed to letterSpacingMm 0 colliding with its untracked twin —
 *                         and is independent of repeatOf, which marks the deliberate repeats block
 *                         and is left untouched.
 */
export function deriveKeyFacts(entries) {
  const earliestBySpec = new Map();
  for (const e of [...entries].sort((a, b) => a.presentationIndex - b.presentationIndex)) {
    const before = e.separationRatioBefore;
    const after = e.separationRatioAfter;
    e.separationDelta = (Number.isFinite(before) && Number.isFinite(after))
      ? Number((after - before).toFixed(4))
      : null;

    e.identicalToUntracked = e.trackingTarget === 'separation'
      ? e.letterSpacingMm === 0
      : null;

    const sig = specSignature(e);
    e.duplicateOf = earliestBySpec.has(sig) ? earliestBySpec.get(sig) : null;
    if (!earliestBySpec.has(sig)) earliestBySpec.set(sig, e.slug);
  }
  return entries;
}

// READ-011C: the rhinestone probe (rs-block / rs-modern) is out of the rating pass. The audit
// (tools/font-certification/read-011-audit-renders.mjs) established that RhinestoneFontProvider
// deliberately does not scale authored stone positions by heightMm (src/text/rhinestoneFont/
// RhinestoneFontProvider.js "Validated but not applied"): all three ratio rungs (16 / 19 / 22)
// produce byte-identical geometry — the audit measured a constant 21.40mm ink height and a
// constant stone count at every specified height. Rating them would feed meaningless ratio labels
// into the band statistics, so the block is excluded rather than re-scoped.
//
// The 12 entries stay in the plan and the key with their presentationIndex untouched — the rating
// sheet simply skips them, and the exclusion is recorded per-entry so provenance survives.
const RHINESTONE_EXCLUSION_REASON =
  'RhinestoneFontProvider does not scale authored stone positions by heightMm, so ratio rungs ' +
  '16 / 19 / 22 produce byte-identical geometry — the READ-011C audit measured a constant 21.40mm ' +
  'ink height and constant stone count at every specified height. Rating these would enter ' +
  'meaningless ratio labels into the band statistics.';

/**
 * Two fields on every entry: excludedFromRating (boolean) and exclusionReason (string, null when
 * not excluded). Derived from stemRegime — the unmeasured regime is exactly the authored rhinestone
 * fonts (READ-011A §5: no outline, so stemWidthRatio and hence the regime is undefined) — never
 * from a slug list. Mutates in place; safe to re-run.
 */
export function deriveRatingExclusion(entries) {
  for (const e of entries) {
    const excluded = e.stemRegime === 'unmeasured';
    e.excludedFromRating = excluded;
    e.exclusionReason = excluded ? RHINESTONE_EXCLUSION_REASON : null;
  }
  return entries;
}

// The non-excluded slugs in the recorded presentation order — what the rating sheet and the blank
// ratings.csv both cover. presentationIndex stays a complete permutation over ALL entries; this
// just drops the excluded ones from the sequence.
function ratingSlugsInPresentationOrder(entries) {
  return [...entries]
    .filter((e) => !e.excludedFromRating)
    .sort((a, b) => a.presentationIndex - b.presentationIndex)
    .map((e) => e.slug);
}

// Writes the blank ratings.csv (header byte-identical to docs/data/read-005/ratings.csv, one row
// per non-excluded slug) and the blind rating sheet (through make-rating-page.mjs). No rendering —
// the PNGs are unchanged. Returns the rated slug list.
async function writeRatingArtifacts(keyEntries) {
  const ratingSlugs = ratingSlugsInPresentationOrder(keyEntries);

  const read005Header = (await readFile(READ_005_RATINGS_FILE, 'utf8')).split('\n', 1)[0];
  const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csvLines = [read005Header, ...ratingSlugs.map((s) => [s, '', '', ''].map(csvCell).join(','))];
  await writeFile(RATINGS_TEMPLATE_FILE, csvLines.join('\n') + '\n', 'utf8');

  const imgDir = path.relative(path.dirname(RATING_HTML), RENDER_DIR) || '.';
  await writeFile(RATING_HTML, buildRatingPageHtml({
    slugs: ratingSlugs,
    imgDir,
    storeKey: 'read011-ratings-v1',
    csvName: 'read-011-ratings.csv'
  }), 'utf8');

  return ratingSlugs;
}

async function run() {
  const args = process.argv.slice(2);
  const channel = args.includes('--channel') ? args[args.indexOf('--channel') + 1] : undefined;

  // --derive-only: recompute everything that is a pure function of the existing render-key.json —
  // the derived key fields (deriveKeyFacts), the rating exclusion (deriveRatingExclusion), and the
  // downstream rating sheet + blank CSV. No engine, no rendering — the PNGs are unchanged.
  if (args.includes('--derive-only')) {
    const key = JSON.parse(await readFile(KEY_FILE, 'utf8'));
    deriveKeyFacts(key.entries);
    deriveRatingExclusion(key.entries);
    key.meta.ratingSpecimens = key.entries.filter((e) => !e.excludedFromRating).length;
    key.meta.excludedFromRating = key.entries.length - key.meta.ratingSpecimens;
    await writeFile(KEY_FILE, JSON.stringify(key, null, 2) + '\n', 'utf8');
    const ratingSlugs = await writeRatingArtifacts(key.entries);
    console.log(`derived fields written for ${key.entries.length} entries -> ${path.relative(repoRoot, KEY_FILE)}`);
    console.log(`rating sheet + blank CSV rebuilt for ${ratingSlugs.length} non-excluded specimens (${key.meta.excludedFromRating} excluded)`);
    return;
  }

  const plan = JSON.parse(await readFile(PLAN_FILE, 'utf8'));
  const entries = plan.entries;
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const separationTarget = plan.meta?.separationTargetRatio ?? SEPARATION_TARGET;

  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'assets/fonts/manifest.json'), 'utf8'));
  const fontManager = new FontManager(manifest);
  const providerById = new Map(fontManager.manifest.fonts.map((f) => [f.id, f.providerId ?? null]));
  const engine = new GeometryEngine({
    fontProviderRegistry: createDefaultFontProviderRegistry(fontManager, {
      loadFontBuffer: async (rel) => {
        const b = await readFile(path.join(repoRoot, rel));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      }
    })
  });

  const specOf = (e) => ({
    fontId: e.fontId, text: e.text, stoneSizeId: e.stoneSizeId, heightMm: e.heightMm, mode: e.mode
  });

  // --- resolve tracking for every non-repeat entry --------------------------------------------
  // Memoised on the full spec so the ~60 separation cells that share nothing still only pay once,
  // and a repeat inherits its source's resolved values exactly.

  const trackingCache = new Map();
  const cacheKey = (e) => `${e.fontId}|${e.text}|${e.stoneSizeId}|${e.heightMm}|${e.mode}|${e.trackingTarget}`;

  async function resolveTracking(e) {
    const ck = cacheKey(e);
    if (trackingCache.has(ck)) return trackingCache.get(ck);

    let resolved;
    if (e.trackingTarget === 'separation') {
      const providerId = providerById.get(e.fontId);
      const sweep = await chooseTracking(engine, providerId, specOf(e));
      const before = round(sweep.before.separationRatio);
      if (sweep.separationAchieved) {
        resolved = {
          letterSpacingMm: round(sweep.chosen.letterSpacingMm, 6),
          separationRatioBefore: before,
          separationRatioAfter: round(sweep.chosen.separationRatio),
          separationAchieved: true
        };
      } else {
        // 0.95 unreachable — record the best achievable ladder rung, boolean false.
        const best = bestRung(sweep.rungs) ?? sweep.before;
        const after = round(best.separationRatio);
        resolved = {
          letterSpacingMm: round(best.letterSpacingMm, 6),
          separationRatioBefore: before,
          separationRatioAfter: after,
          separationAchieved: Number.isFinite(after) && after >= separationTarget // false by construction here
        };
      }
    } else {
      // 'none' — zero letter spacing, the other three fields are not applicable.
      resolved = {
        letterSpacingMm: 0,
        separationRatioBefore: null,
        separationRatioAfter: null,
        separationAchieved: null
      };
    }
    trackingCache.set(ck, resolved);
    return resolved;
  }

  const nonRepeat = entries.filter((e) => e.block !== 'repeats');
  const repeats = entries.filter((e) => e.block === 'repeats');

  const tracking = new Map(); // slug -> resolved tracking fields
  for (const e of nonRepeat) tracking.set(e.slug, await resolveTracking(e));
  for (const e of repeats) {
    const src = bySlug.get(e.repeatOf);
    if (!src) throw new Error(`repeat ${e.slug} repeatOf ${e.repeatOf} does not resolve`);
    // A repeat is a byte-identical copy of its source, so it carries the source's resolved tracking.
    tracking.set(e.slug, tracking.get(src.slug));
  }

  // --- render every non-repeat entry ----------------------------------------------------------

  await rm(WORK_DIR, { recursive: true, force: true });
  await mkdir(WORK_DIR, { recursive: true });
  await rm(RENDER_DIR, { recursive: true, force: true });
  await mkdir(RENDER_DIR, { recursive: true });

  const failures = [];
  const pageJobs = [];
  for (const e of nonRepeat) {
    const providerId = providerById.get(e.fontId);
    const t = tracking.get(e.slug);
    const m = await analyzeOne(engine, e.fontId, e.text, e.stoneSizeId, e.heightMm, {
      mode: e.mode,
      providerId,
      letterSpacingMm: t.letterSpacingMm || undefined
    });
    if (m.error || m.stoneCount === 0) {
      failures.push(`${e.slug} ${e.fontId}/${e.mode} r=${e.ratio} ${e.stoneSizeId}: ${m.error ?? 'zero stones'}`);
      continue;
    }
    const pxPerMm = RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE[e.stoneSizeId];
    const svg = svgWithoutNotes(renderLayoutSvg(m, pxPerMm));
    if (!svg) {
      failures.push(`${e.slug} ${e.fontId}/${e.mode}: renderLayoutSvg produced no <svg>`);
      continue;
    }
    await writeFile(path.join(WORK_DIR, `${e.slug}.html`), pageShell(svg), 'utf8');
    pageJobs.push({ htmlFile: `${e.slug}.html`, pngFile: path.join(RENDER_DIR, `${e.slug}.png`), slug: e.slug });
  }
  if (failures.length) {
    throw new Error(`the frozen plan has ${failures.length} entr${failures.length === 1 ? 'y' : 'ies'} that will not render:\n - ${failures.join('\n - ')}`);
  }

  // --- screenshot the fresh renders in ONE browser context ----------------------------------

  await screenshotPages({
    dir: WORK_DIR,
    pages: pageJobs.map((j) => ({ htmlFile: j.htmlFile, pngFile: j.pngFile })),
    profileDir: PW_PROFILE_DIR,
    channel
  });

  // --- materialise the byte-identical repeats ----------------------------------------------

  for (const e of repeats) {
    await copyFile(
      path.join(RENDER_DIR, `${e.repeatOf}.png`),
      path.join(RENDER_DIR, `${e.slug}.png`)
    );
  }

  // --- seeded presentation order ---------------------------------------------------------------
  // A shuffle over ALL 159 slugs so block structure (main / size-invariance / rhinestone-probe /
  // repeats) is invisible while rating.

  const rand = mulberry32(PRESENTATION_SEED);
  const presentationOrder = shuffle(entries.map((e) => e.slug), rand);
  const presentationIndex = new Map(presentationOrder.map((slug, i) => [slug, i]));

  // --- key: every plan field + the four tracking fields + the presentation index -----------

  const keyEntries = entries
    .map((e) => {
      const carried = {};
      for (const f of PLAN_FIELDS) carried[f] = e[f];
      const t = tracking.get(e.slug);
      return {
        ...carried,
        letterSpacingMm: t.letterSpacingMm,
        separationRatioBefore: t.separationRatioBefore,
        separationRatioAfter: t.separationRatioAfter,
        separationAchieved: t.separationAchieved,
        presentationIndex: presentationIndex.get(e.slug)
      };
    })
    .sort((a, b) => a.presentationIndex - b.presentationIndex);

  deriveKeyFacts(keyEntries);
  deriveRatingExclusion(keyEntries);

  const ratingSpecimens = keyEntries.filter((e) => !e.excludedFromRating).length;
  const key = {
    meta: {
      milestone: 'READ-011C',
      generatedBy: 'tools/font-certification/read-011-renders.mjs',
      sourcePlan: 'docs/data/read-011/render-plan.json',
      planSeed: plan.meta?.seed ?? null,
      presentationSeed: PRESENTATION_SEED,
      presentationSeedHex: `0x${PRESENTATION_SEED.toString(16)}`,
      separationTargetRatio: separationTarget,
      total: keyEntries.length,
      ratingSpecimens,
      excludedFromRating: keyEntries.length - ratingSpecimens,
      renderDir: 'tools/font-certification/output/read-011/renders'
    },
    entries: keyEntries
  };
  await writeFile(KEY_FILE, JSON.stringify(key, null, 2) + '\n', 'utf8');

  // --- rating sheet + blank ratings.csv, over the non-excluded specimens only ---------------

  await writeRatingArtifacts(keyEntries);

  // --- report -----------------------------------------------------------------------------

  const sep = keyEntries.filter((e) => e.trackingTarget === 'separation');
  const reached = sep.filter((e) => e.separationAchieved);
  const failed = sep.filter((e) => !e.separationAchieved);
  const failedByFont = new Map();
  for (const e of failed) failedByFont.set(e.fontId, (failedByFont.get(e.fontId) ?? 0) + 1);

  const rel = (p) => path.relative(repoRoot, p);
  const pngPath = (slug) => rel(path.join(RENDER_DIR, `${slug}.png`));
  const find = (pred) => keyEntries.filter(pred);

  console.log('render directory:   ', rel(RENDER_DIR));
  console.log('key file:           ', rel(KEY_FILE));
  console.log('ratings template:   ', rel(RATINGS_TEMPLATE_FILE));
  console.log('rating sheet:       ', rel(RATING_HTML));
  console.log('total specimens:    ', keyEntries.length);
  console.log('');
  console.log('separation entries: ', sep.length, `— reached ${separationTarget}: ${reached.length}, fell short: ${failed.length}`);
  if (failedByFont.size) {
    console.log('fonts that fell short (entry count):');
    for (const [font, n] of [...failedByFont].sort((a, b) => b[1] - a[1])) console.log(`  ${font}: ${n}`);
  }
  console.log('');

  const report = (label, matches) => {
    console.log(`${label}:`);
    for (const e of matches) {
      console.log(`  ${pngPath(e.slug)}   (${e.fontId} / ${e.text}${e.trackingTarget === 'separation' ? `, ls=${e.letterSpacingMm}mm, sepAfter=${e.separationRatioAfter}` : ''})`);
    }
  };

  report('monoline, ratio 16, outline, no tracking (main)',
    find((e) => e.block === 'main' && e.stemRegime === 'monoline' && e.ratio === 16 && e.mode === 'outline' && e.trackingTarget === 'none'));
  report('massed, ratio 22, fill, no tracking (main)',
    find((e) => e.block === 'main' && e.stemRegime === 'massed' && e.ratio === 22 && e.mode === 'fill' && e.trackingTarget === 'none'));
  report('rhinestone probe, rs-block, ratio 16, outline',
    find((e) => e.block === 'rhinestone-probe' && e.fontId === 'rs-block' && e.ratio === 16 && e.mode === 'outline'));
  report('size-invariance, SS20, ratio 19, outline',
    find((e) => e.block === 'size-invariance' && e.stoneSizeId === 'ss20' && e.ratio === 19 && e.mode === 'outline'));

  // matched pair: a font that appears in the main grid at the same mode+ratio under BOTH
  // trackingTarget none and trackingTarget separation.
  const mainByFMR = new Map();
  for (const e of keyEntries.filter((e) => e.block === 'main')) {
    const k = `${e.fontId}|${e.mode}|${e.ratio}`;
    if (!mainByFMR.has(k)) mainByFMR.set(k, []);
    mainByFMR.get(k).push(e);
  }
  let pair = null;
  for (const group of mainByFMR.values()) {
    const none = group.find((e) => e.trackingTarget === 'none');
    const separation = group.find((e) => e.trackingTarget === 'separation');
    if (none && separation) { pair = [none, separation]; break; }
  }
  if (pair) {
    report(`matched pair — ${pair[0].fontId} / ${pair[0].mode} / ratio ${pair[0].ratio}, none vs separation`, pair);
  } else {
    console.log('matched pair: none found (no font shares a mode+ratio cell across both tracking targets)');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  run().catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  });
}
