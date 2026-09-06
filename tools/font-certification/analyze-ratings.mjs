#!/usr/bin/env node
/**
 * READ-005B — reproducible ratings analysis.
 *
 * Recomputes every table in `docs/specifications/READ-005A-CalibrationFindings.md` from the four
 * tracked measurement files in `docs/data/read-005/`:
 *
 *   ratings.csv                   — session 1, 135 blind calibration ratings
 *   calibration-key.json          — session 1 held-back key
 *   tracking-renders-ratings.csv  — session 2, 75 blind tracking ratings
 *   tracking-key.json             — session 2 held-back key
 *
 * `f-ladder.json` is deliberately NOT read (7.4 MB, no table below needs it).
 *
 * READ-007 adds four analysis-only tables under `session1` (`ratioBySeparation`, `blockByRatioBand`,
 * `floorCandidates`, `nonScriptCut`) that test the auto-fit readability floor's evidence for a
 * separation-band confound. They read the same four inputs; no product code or rendered output
 * changes. See `docs/specifications/READ-007-RatioFloorEvidence.md`.
 *
 * The classifier rules in this file are fixed by the READ-005B milestone prompt. They are applied
 * verbatim and emit whatever they produce; they are NOT tuned to match numbers already written in
 * the findings document. Divergences are expected and are reported by `--check` against the golden
 * file `docs/data/read-005/derived-tables.json`.
 *
 * Modes:
 *   (default)   print a human-readable markdown report to stdout
 *   --json      print the computeAll() object as JSON
 *   --write     write docs/data/read-005/derived-tables.json (2-space indent, trailing newline)
 *   --check     recompute, deep-compare against the committed JSON, print mismatching paths, exit 1
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// READ-007 §4.4: the script-face lists are imported from a shared data-only leaf module rather than
// copied, so this analysis and calibration-renders.mjs can never drift. The leaf module has zero
// imports — this file's transitive import graph stays free of src/ and of every npm package, and
// `.meta.inputs` stays at the same four files.
import { NON_SCRIPT_FONTS, JOINED_SCRIPT_FONTS } from './lib/scriptFaceFonts.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'docs', 'data', 'read-005');
const GOLDEN_FILE = path.join(DATA_DIR, 'derived-tables.json');

// READ-011D — the rating-analysis pre-registration. `computeSession3()` reads these plus
// `assets/fonts/manifest.json` and writes its own golden, `derived-tables.json` under read-011.
// `computeAll()`'s inputs and returned shape are untouched; session 3 is a separate function with a
// separate golden. See `docs/specifications/READ-011D-AnalysisPreRegistration.md`.
const DATA_DIR_011 = path.join(REPO_ROOT, 'docs', 'data', 'read-011');
const GOLDEN_FILE_011 = path.join(DATA_DIR_011, 'derived-tables.json');
const MANIFEST_FILE = path.join(REPO_ROOT, 'assets', 'fonts', 'manifest.json');

// --- RFC 4180 CSV reader ------------------------------------------------------------------------
// Quoted fields in these files contain embedded newlines and commas, so a line-based split gives
// the wrong row count. This is a minimal compliant reader: it honours quoting, "" escapes, and
// CRLF/LF/CR row terminators, and returns an array of objects keyed by the header row.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let sawField = false;
  const endField = () => { row.push(field); field = ''; sawField = false; };
  const endRow = () => {
    endField();
    // Drop a blank trailing line (a single empty field and nothing else).
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
      sawField = true;
    } else if (c === ',') {
      endField();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += c;
      sawField = true;
    }
  }
  if (sawField || field !== '' || row.length) endRow();
  return rows;
}

export function readCsvObjects(filePath) {
  const rows = parseCsv(readFileSync(filePath, 'utf8'));
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
    return obj;
  });
}

// --- rounding helpers --------------------------------------------------------------------------

const pct = (k, n) => (n === 0 ? null : round1((100 * k) / n));
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

// --- rejection-cause classifier (fixed by the READ-005B prompt) --------------------------------

export const CAUSE_TAGS = ['inaccurate', 'tooClose', 'tooManyStones', 'ugly', 'extraStones'];

export function classifyNote(note) {
  const lower = note.toLowerCase();
  const tags = [];
  if (
    lower.includes('inaccu') ||
    lower.includes('looks like') ||
    lower.includes('extra letter') ||
    lower.includes('croosed') ||
    lower.includes('intercent')
  ) tags.push('inaccurate');
  if (lower.includes('close') || lower.includes('spacing')) tags.push('tooClose');
  if (/\btoo\s+\S+\s+st[r]?ones?/.test(lower)) tags.push('tooManyStones');
  if (note.trim() === 'ugly') tags.push('ugly');
  if (lower.includes('extra stone') || lower.includes('inside the countour')) tags.push('extraStones');
  return tags;
}

// --- combinatorics for McNemar exact ----------------------------------------------------------

function binom(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

function mcnemarExactTwoSided(b, c) {
  const nn = b + c;
  let sum = 0;
  for (let i = 0; i <= Math.min(b, c); i++) sum += binom(nn, i) * Math.pow(0.5, nn);
  return Math.min(1, 2 * sum);
}

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, x) => a - x);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// --- band helpers ----------------------------------------------------------------------------

// bands: [{ label, lo, hi }] with lo inclusive, hi exclusive.
function bandOf(value, bands) {
  for (const band of bands) {
    if (value >= band.lo && value < band.hi) return band.label;
  }
  return null;
}

// Assert that a set of band counts accounts for exactly `population` rows, and throw loudly if
// not. Every banded table in this file is a partition of a declared population — a row that lands
// in no band (as a ratio of exactly 32.0 did before the script-face top band was made open-ended)
// is a bug in the band edges, not something to swallow silently.
function assertBandSum(bandRows, population, label) {
  const sum = bandRows.reduce((acc, b) => acc + b.n, 0);
  if (sum !== population) {
    throw new Error(
      `${label}: band counts sum to ${sum} but the table population is ${population} ` +
      `(${population - sum} row(s) fall outside every band)`,
    );
  }
}

function bandTable(rows, bands, label) {
  // rows: [{ ratio, sellable(boolean) }]
  const out = {};
  for (const band of bands) {
    const inBand = rows.filter((r) => bandOf(r.ratio, bands) === band.label);
    const k = inBand.filter((r) => r.sellable).length;
    out[band.label] = { n: inBand.length, sellable: k, sellablePct: pct(k, inBand.length) };
  }
  assertBandSum(Object.values(out), rows.length, label);
  return out;
}

const MODE_BANDS = [
  { label: '<20', lo: -Infinity, hi: 20 },
  { label: '20–25', lo: 20, hi: 25 },
  { label: '25–30', lo: 25, hi: 30 },
  { label: '30+', lo: 30, hi: Infinity },
];

const SCRIPT_BANDS = [
  { label: '<22', lo: -Infinity, hi: 22 },
  { label: '22–26', lo: 22, hi: 26 },
  { label: '26–29', lo: 26, hi: 29 },
  { label: '29+', lo: 29, hi: Infinity },
];

// The interior-mode fidelity cut (findings §4.6) is scoped to ratio >= 15; rows below that are
// reported separately as `excludedBelow15` and are not part of this table's population.
const INTERIOR_BANDS = [
  { label: '15–20', lo: 15, hi: 20 },
  { label: '20–25', lo: 20, hi: 25 },
  { label: '25–30', lo: 25, hi: 30 },
  { label: '30+', lo: 30, hi: Infinity },
];

// --- floor-cut helpers -----------------------------------------------------------------------
// A "floor cut" is a straight partition of a rated population at a candidate threshold, with both
// operands of every rate emitted and never a rate itself (READ-007 §4.3 / READ-011D §7). READ-005B
// scoped every cut on the height-to-stone ratio; READ-011D reuses the same shape with other cut
// variables, so the accessor is a parameter defaulting to `row.ratio`.
//
// `withRatedCounts` is opt-in and only READ-011D's session 3 passes it. It adds `ratedBelow` /
// `ratedAtOrAbove` (rows whose `sellable` cell is non-blank) alongside the population counts, so a
// partially-rated sheet keeps population and rate denominator separate (READ-011D §3, §7). Session 1
// leaves it off and its golden (`docs/data/read-005/derived-tables.json`) stays byte-identical.

function floorCut(rows, threshold, valueOf = (row) => row.ratio, withRatedCounts = false) {
  const below = rows.filter((row) => valueOf(row) < threshold);
  const atOrAbove = rows.filter((row) => valueOf(row) >= threshold);
  const cut = {
    rowsBelow: below.length,
    sellableBelow: below.filter((row) => row.sellable).length,
    rowsAtOrAbove: atOrAbove.length,
    sellableAtOrAbove: atOrAbove.filter((row) => row.sellable).length,
  };
  if (withRatedCounts) {
    cut.ratedBelow = below.filter((row) => row.isRated).length;
    cut.ratedAtOrAbove = atOrAbove.filter((row) => row.isRated).length;
  }
  return cut;
}

function buildFloorScope(rows, candidates, label, valueOf = (row) => row.ratio, withRatedCounts = false) {
  const ratedCount = withRatedCounts ? rows.filter((row) => row.isRated).length : null;
  const byCandidate = {};
  for (const c of candidates) {
    const cut = floorCut(rows, c, valueOf, withRatedCounts);
    if (cut.rowsBelow + cut.rowsAtOrAbove !== rows.length) {
      throw new Error(`${label}: candidate ${c} — rowsBelow + rowsAtOrAbove != population ${rows.length}`);
    }
    if (withRatedCounts && cut.ratedBelow + cut.ratedAtOrAbove !== ratedCount) {
      throw new Error(`${label}: candidate ${c} — ratedBelow + ratedAtOrAbove != rated count ${ratedCount}`);
    }
    byCandidate[c] = cut;
  }
  return withRatedCounts
    ? { population: rows.length, rated: ratedCount, byCandidate }
    : { population: rows.length, byCandidate };
}

// --- session 1 --------------------------------------------------------------------------------

function computeSession1(ratings, key) {
  // Marginals — count every distinct value present, including empty.
  const marginal = (field) => {
    const counts = {};
    for (const r of ratings) {
      const v = r[field] ?? '';
      counts[v] = (counts[v] ?? 0) + 1;
    }
    return counts;
  };

  const bySlug = new Map(ratings.map((r) => [r.slug, r]));

  // Rater self-consistency over hidden repeats.
  let sc = { n: 0, readable: 0, sellable: 0, both: 0 };
  for (const [slug, meta] of Object.entries(key)) {
    if (!meta.repeatOf) continue;
    const here = bySlug.get(slug);
    const src = bySlug.get(meta.repeatOf);
    if (!here || !src) continue;
    sc.n += 1;
    const rMatch = here.readable === src.readable;
    const sMatch = here.sellable === src.sellable;
    if (rMatch) sc.readable += 1;
    if (sMatch) sc.sellable += 1;
    if (rMatch && sMatch) sc.both += 1;
  }

  // Rejection causes over sellable === 'no'.
  const noRows = ratings.filter((r) => r.sellable === 'no');
  let noNote = 0;
  let noTagMatch = 0;
  let multiTag = 0;
  const perTagCount = Object.fromEntries(CAUSE_TAGS.map((t) => [t, 0]));
  const distinctNotesMap = new Map();
  for (const r of noRows) {
    const note = r.notes ?? '';
    if (note.trim() === '') { noNote += 1; continue; }
    const tags = classifyNote(note);
    if (!distinctNotesMap.has(note)) distinctNotesMap.set(note, tags);
    if (tags.length === 0) noTagMatch += 1;
    if (tags.length > 1) multiTag += 1;
    for (const t of tags) perTagCount[t] += 1;
  }
  const perTag = {};
  for (const t of CAUSE_TAGS) {
    perTag[t] = {
      n: perTagCount[t],
      populationSharePct: pct(perTagCount[t], noRows.length),
    };
  }
  const distinctNotes = [...distinctNotesMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([note, tags]) => ({ note, tags }));

  // Letters named in notes: single characters inside double quotes, case-sensitive.
  const letterCounts = new Map();
  for (const r of ratings) {
    const matches = (r.notes ?? '').match(/"(.)"/g) || [];
    for (const m of matches) {
      const ch = m[1];
      letterCounts.set(ch, (letterCounts.get(ch) ?? 0) + 1);
    }
  }
  const lettersNamed = [...letterCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([letter, count]) => ({ letter, count }));

  // Mode × ratio table over all rows.
  const byMode = new Map();
  for (const r of ratings) {
    const meta = key[r.slug];
    if (!byMode.has(meta.mode)) byMode.set(meta.mode, []);
    byMode.get(meta.mode).push({ ratio: meta.ratio, sellable: r.sellable === 'yes' });
  }
  const modeRatio = [...byMode.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .map(([mode, rows]) => {
      const k = rows.filter((x) => x.sellable).length;
      return {
        mode,
        n: rows.length,
        sellable: k,
        sellablePct: pct(k, rows.length),
        bands: bandTable(rows, MODE_BANDS, `session1.modeRatio[${mode}].bands`),
      };
    });

  // Inaccurate-tag load by mode (findings §7 item 2): for each mode, the render count, the
  // sellable === 'no' count, and how many of those rejections carry the `inaccurate` tag. The
  // per-mode inaccurate counts must account for every inaccurate-tagged rejection exactly once.
  const modeInaccMap = new Map();
  for (const r of ratings) {
    const mode = key[r.slug].mode;
    if (!modeInaccMap.has(mode)) modeInaccMap.set(mode, { mode, n: 0, sellNo: 0, inaccurate: 0 });
    const row = modeInaccMap.get(mode);
    row.n += 1;
    if (r.sellable === 'no') {
      row.sellNo += 1;
      if (classifyNote(r.notes ?? '').includes('inaccurate')) row.inaccurate += 1;
    }
  }
  const inaccurateByMode = [...modeInaccMap.values()]
    .sort((a, b) => b.n - a.n || (a.mode < b.mode ? -1 : 1));
  const inaccurateByModeSum = inaccurateByMode.reduce((acc, m) => acc + m.inaccurate, 0);
  if (inaccurateByModeSum !== perTagCount.inaccurate) {
    throw new Error(
      `session1.inaccurateByMode: inaccurate counts sum to ${inaccurateByModeSum} but ` +
      `rejectionCauses.perTag.inaccurate.n is ${perTagCount.inaccurate}`,
    );
  }

  // Script-face bands over key.block === 'joined-scripts'.
  const scriptRows = ratings
    .filter((r) => key[r.slug].block === 'joined-scripts')
    .map((r) => ({ ratio: key[r.slug].ratio, sellable: r.sellable === 'yes' }));
  const scriptK = scriptRows.filter((x) => x.sellable).length;

  // Interior-mode fidelity cut (findings §4.6): for two mode groups, per ratio band, how much of
  // the rejection load carries the `inaccurate` tag. Scoped to ratio >= 15.
  const interiorRow = (r) => ({
    ratio: key[r.slug].ratio,
    mode: key[r.slug].mode,
    sellNo: r.sellable === 'no',
    inaccurate: classifyNote(r.notes ?? '').includes('inaccurate'),
  });
  const interiorGroup = (modes) => {
    const rows = ratings.filter((r) => modes.includes(key[r.slug].mode)).map(interiorRow);
    const inRange = rows.filter((r) => r.ratio >= 15);
    const byBand = {};
    for (const band of INTERIOR_BANDS) {
      const b = inRange.filter((r) => bandOf(r.ratio, INTERIOR_BANDS) === band.label);
      const rejections = b.filter((r) => r.sellNo).length;
      const inaccurate = b.filter((r) => r.sellNo && r.inaccurate).length;
      byBand[band.label] = {
        n: b.length,
        rejections,
        inaccurate,
        inaccuratePctOfRejections: pct(inaccurate, rejections),
        inaccuratePctOfRows: pct(inaccurate, b.length),
      };
    }
    assertBandSum(Object.values(byBand), inRange.length, `session1.interiorFidelity[${modes.join('+')}]`);
    return {
      modes,
      population: inRange.length,
      excludedBelow15: rows.length - inRange.length,
      byBand,
    };
  };
  const interiorFidelity = {
    bands: INTERIOR_BANDS.map((b) => b.label),
    groups: [
      interiorGroup(['fill', 'staggered', 'radial']),
      interiorGroup(['fill', 'staggered', 'radial', 'contour']),
    ],
  };

  // --- READ-007: ratio-floor evidence ---------------------------------------------------------
  // Every row keyed to its calibration metadata once. `ratio` is the height-to-stone-diameter
  // ratio the F+A ladder was built on (f-ladder.mjs: heightMm = ratio * stoneSizeMm), so it is
  // directly comparable to a candidate auto-fit floor expressed in stone diameters.
  const r7Rows = ratings.map((r) => ({
    ratio: key[r.slug].ratio,
    mode: key[r.slug].mode,
    block: key[r.slug].block,
    separationBand: key[r.slug].separationBand,
    fontId: key[r.slug].fontId,
    sellable: r.sellable === 'yes',
  }));

  // "Offered modes" (READ-007 §3): the two engine modes READ-006A left in the #textMode picker.
  const OFFERED_ENGINE_MODES = ['outline', 'fill'];
  const isOffered = (row) => OFFERED_ENGINE_MODES.includes(row.mode);
  const SEPARATION_BANDS = ['merge', 'aligned', 'fragmented'];

  // 4.1 — ratio × separation band. Each separation subgroup is banded over ratio through the
  // shared bandTable()/assertBandSum() path, so a row landing in no ratio band throws.
  const ratioBySeparationScope = (rows, label) => {
    const missing = rows.filter((row) => !SEPARATION_BANDS.includes(row.separationBand)).length;
    const bySeparation = {};
    let grouped = 0;
    for (const sb of SEPARATION_BANDS) {
      const sub = rows.filter((row) => row.separationBand === sb);
      grouped += sub.length;
      bySeparation[sb] = bandTable(sub, MODE_BANDS, `${label}[${sb}]`);
    }
    if (grouped + missing !== rows.length) {
      throw new Error(
        `${label}: separation subgroups (${grouped}) + rows with no band (${missing}) ` +
        `!= scope population ${rows.length}`,
      );
    }
    return { population: rows.length, noSeparationBand: missing, bySeparation };
  };
  const ratioBySeparation = {
    ratioBands: MODE_BANDS.map((b) => b.label),
    separationBands: SEPARATION_BANDS,
    scopes: {
      allModes: ratioBySeparationScope(r7Rows, 'session1.ratioBySeparation.allModes'),
      offeredModes: ratioBySeparationScope(
        r7Rows.filter(isOffered), 'session1.ratioBySeparation.offeredModes',
      ),
    },
  };

  // 4.2 — block provenance by ratio band. Each block is banded over ratio the same way.
  const R7_BLOCKS = [
    'interior-fill-positives', 'f-heldout-validation', 'joined-scripts',
    'non-script-outline', 'repeats',
  ];
  const blockByRatioBand = (() => {
    const byBlock = {};
    let grouped = 0;
    for (const b of R7_BLOCKS) {
      const sub = r7Rows.filter((row) => row.block === b);
      grouped += sub.length;
      byBlock[b] = bandTable(sub, MODE_BANDS, `session1.blockByRatioBand[${b}]`);
    }
    if (grouped !== r7Rows.length) {
      throw new Error(
        `session1.blockByRatioBand: block subgroups sum to ${grouped} but population is ` +
        `${r7Rows.length} — a row carries a block value outside ${JSON.stringify(R7_BLOCKS)}`,
      );
    }
    return { ratioBands: MODE_BANDS.map((b) => b.label), blocks: R7_BLOCKS, population: r7Rows.length, byBlock };
  })();

  // 4.3 — floor-candidate decision table. Threshold cuts, not bands: a straight partition at each
  // candidate ratio, both operands of every rate emitted.
  const FLOOR_CANDIDATES = [10, 15, 18, 20, 22, 25];
  const floorScope = (rows, label) => buildFloorScope(rows, FLOOR_CANDIDATES, label);
  const floorCandidates = {
    candidates: FLOOR_CANDIDATES,
    scopes: {
      allModes: floorScope(r7Rows, 'session1.floorCandidates.allModes'),
      offeredModes: floorScope(r7Rows.filter(isOffered), 'session1.floorCandidates.offeredModes'),
      offeredModesExcludingMerge: floorScope(
        r7Rows.filter((row) => isOffered(row) && row.separationBand !== 'merge'),
        'session1.floorCandidates.offeredModesExcludingMerge',
      ),
    },
  };

  // 4.4 — reproducibility check on READ-005A §4.2's non-script cut. Non-script = font in the
  // imported NON_SCRIPT_FONTS set. Also count fonts that fall in neither script list: those are
  // silently absent from both the non-script and the joined-script cuts.
  const nonScriptRows = r7Rows.filter((row) => NON_SCRIPT_FONTS.has(row.fontId));
  const nonScriptCutCounts = floorCut(nonScriptRows, 20);
  if (nonScriptCutCounts.rowsBelow + nonScriptCutCounts.rowsAtOrAbove !== nonScriptRows.length) {
    throw new Error('session1.nonScriptCut: rowsBelow + rowsAtOrAbove != population');
  }
  const joinedScriptSet = new Set(JOINED_SCRIPT_FONTS);
  const keyFonts = [...new Set(Object.values(key).map((k) => k.fontId))].sort();
  const fontsInNeither = keyFonts.filter((f) => !NON_SCRIPT_FONTS.has(f) && !joinedScriptSet.has(f));
  const nonScriptCut = {
    threshold: 20,
    definition: 'fontId in NON_SCRIPT_FONTS (tools/font-certification/lib/scriptFaceFonts.mjs)',
    population: nonScriptRows.length,
    ...nonScriptCutCounts,
    fontsInNeitherScriptSet: { count: fontsInNeither.length, fonts: fontsInNeither },
  };

  return {
    rowCount: ratings.length,
    marginals: { readable: marginal('readable'), sellable: marginal('sellable') },
    raterSelfConsistency: sc,
    rejectionCauses: {
      population: noRows.length,
      noNote,
      noTagMatch,
      multiTag,
      perTag,
      distinctNotes,
    },
    lettersNamed,
    modeRatio,
    inaccurateByMode,
    scriptFaceBands: {
      block: 'joined-scripts',
      n: scriptRows.length,
      sellable: scriptK,
      sellablePct: pct(scriptK, scriptRows.length),
      bands: bandTable(scriptRows, SCRIPT_BANDS, 'session1.scriptFaceBands.bands'),
    },
    interiorFidelity,
    ratioBySeparation,
    blockByRatioBand,
    floorCandidates,
    nonScriptCut,
  };
}

// --- session 2 --------------------------------------------------------------------------------

const S2_BLOCKS = ['paired-tracked', 'paired-control', 'specificity', 'harm', 'repeats'];

function computeSession2(ratings, key) {
  const bySlug = new Map(ratings.map((r) => [r.slug, r]));

  // Per-block n and sellable rate, over all rows and over rated rows only.
  const perBlock = S2_BLOCKS.map((block) => {
    const rows = ratings.filter((r) => key[r.slug].block === block);
    const rated = rows.filter((r) => r.sellable !== '');
    const allK = rows.filter((r) => r.sellable === 'yes').length;
    const ratedK = rated.filter((r) => r.sellable === 'yes').length;
    return {
      block,
      n: rows.length,
      all: { sellable: allK, sellablePct: pct(allK, rows.length) },
      rated: { n: rated.length, sellable: ratedK, sellablePct: pct(ratedK, rated.length) },
    };
  });

  // Unrated rows (empty sellable).
  const unratedRows = ratings
    .filter((r) => r.sellable === '')
    .map((r) => ({ slug: r.slug, block: key[r.slug].block, fontId: key[r.slug].fontId, mode: key[r.slug].mode }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));

  // Paired 2×2.
  const trackedSlugs = Object.keys(key).filter((s) => key[s].block === 'paired-tracked');
  const partners = trackedSlugs.map((s) => key[s].pairedWith);
  const partnersAllControl = partners.every((p) => key[p] && key[p].block === 'paired-control');
  const partnersOneToOne = new Set(partners).size === partners.length;

  const pairs = trackedSlugs
    .map((tracked) => ({ tracked, control: key[tracked].pairedWith }))
    .sort((a, b) => (a.tracked < b.tracked ? -1 : 1));

  const evaluable = [];
  const excludedPairs = [];
  for (const { tracked, control } of pairs) {
    const t = bySlug.get(tracked);
    const c = bySlug.get(control);
    const reasons = [];
    if (!t || t.sellable === '') reasons.push(`tracked ${tracked} unrated`);
    if (!c || c.sellable === '') reasons.push(`control ${control} unrated`);
    if (reasons.length === 0) evaluable.push({ tracked, control });
    else excludedPairs.push({ tracked, control, reason: reasons.join('; ') });
  }

  let trackedYesControlNo = 0;
  let trackedNoControlYes = 0;
  let both = 0;
  let neither = 0;
  for (const { tracked, control } of evaluable) {
    const ty = bySlug.get(tracked).sellable === 'yes';
    const cy = bySlug.get(control).sellable === 'yes';
    if (ty && !cy) trackedYesControlNo += 1;
    else if (!ty && cy) trackedNoControlYes += 1;
    else if (ty && cy) both += 1;
    else neither += 1;
  }

  const b = trackedYesControlNo;
  const c = trackedNoControlYes;
  const mcnemar = { b, c, p: Math.round(mcnemarExactTwoSided(b, c) * 1e4) / 1e4 };

  // Width cost over discordant pairs where tracking won (tracked yes / control no).
  const winWidths = evaluable
    .filter(({ tracked, control }) =>
      bySlug.get(tracked).sellable === 'yes' && bySlug.get(control).sellable === 'no')
    .map(({ tracked }) => key[tracked].widthGrowthPct)
    .sort((x, y) => x - y);
  const widthCostOnWins = {
    n: winWidths.length,
    medianPct: winWidths.length ? round2(median(winWidths)) : null,
    minPct: winWidths.length ? round2(winWidths[0]) : null,
    maxPct: winWidths.length ? round2(winWidths[winWidths.length - 1]) : null,
    valuesPct: winWidths.map(round2),
  };

  // Per-mode breakdown of tracked vs control over evaluable pairs.
  const modeMap = new Map();
  for (const { tracked, control } of evaluable) {
    const mode = key[tracked].mode;
    if (!modeMap.has(mode)) modeMap.set(mode, { mode, trackedYes: 0, trackedN: 0, controlYes: 0, controlN: 0 });
    const row = modeMap.get(mode);
    row.trackedN += 1;
    row.controlN += 1;
    if (bySlug.get(tracked).sellable === 'yes') row.trackedYes += 1;
    if (bySlug.get(control).sellable === 'yes') row.controlYes += 1;
  }
  const perModeEvaluable = [...modeMap.values()].sort((x, y) => (x.mode < y.mode ? -1 : 1));

  // Residual complaints on tracked members of evaluable pairs still sellable === 'no'.
  const residualRows = [];
  const residualPerTag = Object.fromEntries(CAUSE_TAGS.map((t) => [t, 0]));
  let residualNoTag = 0;
  for (const { tracked } of evaluable) {
    const t = bySlug.get(tracked);
    if (t.sellable !== 'no') continue;
    const tags = classifyNote(t.notes ?? '');
    residualRows.push({ slug: tracked, note: t.notes ?? '', tags });
    if (tags.length === 0) residualNoTag += 1;
    for (const tag of tags) residualPerTag[tag] += 1;
  }
  residualRows.sort((x, y) => (x.slug < y.slug ? -1 : 1));

  // Pairs whose tracked member has separationAchieved === false.
  const sepNotAchieved = pairs
    .filter(({ tracked }) => key[tracked].separationAchieved === false)
    .map(({ tracked }) => tracked)
    .sort();

  return {
    rowCount: ratings.length,
    perBlock,
    unratedRows: { count: unratedRows.length, rows: unratedRows },
    paired: {
      trackedCount: trackedSlugs.length,
      partnersAllInControl: partnersAllControl,
      partnersOneToOne,
      pairs: pairs.length,
      evaluablePairs: evaluable.length,
      excludedPairs,
      cells: { trackedYesControlNo, trackedNoControlYes, both, neither },
      mcnemar,
      widthCostOnWins,
      perModeEvaluable,
      residualComplaints: { rows: residualRows, perTag: residualPerTag, noTag: residualNoTag },
      trackedSeparationNotAchieved: { count: sepNotAchieved.length, slugs: sepNotAchieved },
    },
  };
}

// --- session 3 (READ-011D) -------------------------------------------------------------------
// Pre-registered before the READ-011 rating sheet is filled in. Every number is recomputed from
// docs/data/read-011/ratings.csv, docs/data/read-011/render-key.json and assets/fonts/manifest.json;
// nothing here is hardcoded from the spec. computeSession3() has its own inputs and its own golden
// (GOLDEN_FILE_011); computeAll() above is not touched.
// See docs/specifications/READ-011D-AnalysisPreRegistration.md.

const round4 = (x) => Math.round(x * 1e4) / 1e4;

// The duplicate-spec key (READ-011D §2). Two renders with an identical tuple are the same image.
const S3_DUP_KEY_FIELDS = ['fontId', 'mode', 'ratio', 'stoneSizeId', 'text', 'letterSpacingMm'];
const s3DupKey = (e) => S3_DUP_KEY_FIELDS.map((f) => e[f]).join('|');

// The two candidate cut grids (READ-011D §6). Fixed here; §11 forbids moving them post-ratings.
const S3_STONES_CANDIDATES = [0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0];
const S3_RATIO_CANDIDATES = [16, 17.5, 19, 20.5, 22];

// The clearance rule operands (READ-011D §7). Emitted as data; the analyzer never applies the rule.
const S3_CLEARANCE = { minSellableRatePctAtOrAbove: 60, minMarginPctOverBelow: 20, minRatedRowsAtOrAbove: 12 };

const S3_REGIMES = ['monoline', 'transitional', 'massed'];
const S3_MODES = ['outline', 'fill'];
const S3_ACHIEVED = ['tracked', 'untracked'];
const S3_INTENT = ['none', 'separation'];
const S3_SPAN_MIN_POSITIONS = 15; // READ-005's repeat design separation (READ-005A §3).

function s3AssertSameSet(a, b, label) {
  const only = (x, y) => [...x].filter((v) => !y.has(v)).sort();
  const missing = only(a, b);
  const extra = only(b, a);
  if (missing.length || extra.length) {
    throw new Error(`${label}: sets differ (only-left ${JSON.stringify(missing)}, only-right ${JSON.stringify(extra)})`);
  }
}

export function computeSession3() {
  const ratings = readCsvObjects(path.join(DATA_DIR_011, 'ratings.csv'));
  const key = JSON.parse(readFileSync(path.join(DATA_DIR_011, 'render-key.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));

  const rowBySlug = new Map(ratings.map((r) => [r.slug, r]));
  const entryBySlug = new Map(key.entries.map((e) => [e.slug, e]));

  // The analysis set: one row per rated (non-excluded) specimen (READ-011D §3). No row is dropped
  // on geometric grounds; the only structural handling is the duplicate rule below.
  const rated = key.entries.filter((e) => e.excludedFromRating === false);
  const sheet = [...rated].sort((a, b) => a.presentationIndex - b.presentationIndex);
  const sheetPos = new Map(sheet.map((e, i) => [e.slug, i]));

  const mk = (e) => {
    const r = rowBySlug.get(e.slug) ?? { readable: '', sellable: '', notes: '' };
    return {
      slug: e.slug,
      fontId: e.fontId,
      stemRegime: e.stemRegime,
      stemWidthRatio: e.stemWidthRatio,
      mode: e.mode,
      ratio: e.ratio,
      stoneSizeId: e.stoneSizeId,
      text: e.text,
      block: e.block,
      trackingTarget: e.trackingTarget,
      letterSpacingMm: e.letterSpacingMm,
      repeatOf: e.repeatOf,
      duplicateOf: e.duplicateOf,
      presentationIndex: e.presentationIndex,
      separationRatioBefore: e.separationRatioBefore,
      separationRatioAfter: e.separationRatioAfter,
      separationAchieved: e.separationAchieved,
      readableRaw: r.readable,
      sellableRaw: r.sellable,
      notes: r.notes ?? '',
      isRated: r.sellable !== '',
      readable: r.readable === 'yes',
      sellable: r.sellable === 'yes',
      // Achieved tracking, not intended (READ-011D §4): the causal factor is the spacing applied.
      tracked: e.letterSpacingMm > 0,
      // stonesAcrossStem = ratio × stemWidthRatio (READ-011D §6 Form A cut variable).
      stonesAcrossStem: e.stemWidthRatio == null ? null : round4(e.ratio * e.stemWidthRatio),
    };
  };
  const allRows = rated.map(mk);
  const rowBySlugA = new Map(allRows.map((r) => [r.slug, r]));

  // --- duplicate groups (READ-011D §2, §3, §5) ----------------------------------------------
  const groupMap = new Map();
  for (const r of allRows) {
    const gk = s3DupKey(r);
    if (!groupMap.has(gk)) groupMap.set(gk, []);
    groupMap.get(gk).push(r);
  }
  const groups = [...groupMap.values()]
    .filter((members) => members.length > 1)
    .map((members) => {
      const sorted = [...members].sort((a, b) => a.presentationIndex - b.presentationIndex);
      const primary = sorted[0];
      const pidx = sorted.map((m) => m.presentationIndex);
      const spos = sorted.map((m) => sheetPos.get(m.slug));
      const trackingTargets = [...new Set(sorted.map((m) => m.trackingTarget))].sort();
      const hasSeededRepeat = sorted.some((m) => m.repeatOf != null);
      const kind = sorted.length > 2 ? 'triple'
        : hasSeededRepeat ? 'main/repeats pair'
        : 'main/main collision';
      // A blank cell never counts as agreement (READ-011D §5): "same" needs every member non-blank
      // and equal. `allMembersRated` gates the agreement denominator to fully-rated groups.
      const same = (vals) => vals.every((v) => v !== '') && new Set(vals).size === 1;
      const readableSame = same(sorted.map((m) => m.readableRaw));
      const sellableSame = same(sorted.map((m) => m.sellableRaw));
      const allMembersRated = sorted.every((m) => m.sellableRaw !== '');
      const sheetSpan = spos[spos.length - 1] - spos[0];
      return {
        key: s3DupKey(primary),
        fontId: primary.fontId,
        mode: primary.mode,
        ratio: primary.ratio,
        stoneSizeId: primary.stoneSizeId,
        text: primary.text,
        letterSpacingMm: primary.letterSpacingMm,
        size: sorted.length,
        kind,
        hasSeededRepeat,
        primarySlug: primary.slug,
        memberSlugs: sorted.map((m) => m.slug),
        presentationIndices: pidx,
        presentationSpan: pidx[pidx.length - 1] - pidx[0],
        sheetPositions: spos,
        sheetSpan,
        spansUnderMinPositions: sheetSpan < S3_SPAN_MIN_POSITIONS,
        trackingTargets,
        trackingContrastPresent: trackingTargets.length > 1,
        allMembersRated,
        readableSame,
        sellableSame,
        bothSame: readableSame && sellableSame,
      };
    })
    .sort((a, b) => a.presentationIndices[0] - b.presentationIndices[0]);

  // Non-primary members leave the primary tables (READ-011D §3). Cross-check against the
  // render-key's own duplicateOf field, which implements the same "earliest presentation wins" rule.
  const droppedComputed = new Set();
  for (const g of groups) for (const s of g.memberSlugs) if (s !== g.primarySlug) droppedComputed.add(s);
  const droppedInKey = new Set(rated.filter((e) => e.duplicateOf != null).map((e) => e.slug));
  s3AssertSameSet(droppedComputed, droppedInKey, 'session3.duplicateGroups: computed non-primary set vs render-key duplicateOf');

  const primaryRows = allRows.filter((r) => r.duplicateOf == null);
  if (primaryRows.length !== allRows.length - droppedComputed.size) {
    throw new Error(`session3: primary population ${primaryRows.length} != ${allRows.length} - ${droppedComputed.size}`);
  }

  const groupSizes = {};
  for (const g of groups) groupSizes[g.size] = (groupSizes[g.size] ?? 0) + 1;

  const degenerate = groups.filter((g) => g.trackingContrastPresent);
  for (const g of degenerate) {
    if (g.letterSpacingMm !== 0) {
      throw new Error(`session3.degenerateTrackingCells: ${g.key} has a tracking contrast but letterSpacingMm ${g.letterSpacingMm} != 0`);
    }
  }

  // --- regime pool medians from the manifest (READ-011D §6) --------------------------------
  const swrByFont = new Map(manifest.fonts.map((f) => [f.id, f.stemWidthRatio]));
  const regimeMedians = {};
  const regimePools = {};
  for (const regime of S3_REGIMES) {
    const pool = [...new Set(rated.filter((e) => e.stemRegime === regime).map((e) => e.fontId))].sort();
    regimePools[regime] = pool;
    const values = pool.map((id) => swrByFont.get(id));
    if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      throw new Error(`session3: regime "${regime}" pool contains a font with no manifest stemWidthRatio`);
    }
    // Each rated entry's carried stemWidthRatio must match the manifest it was planned from.
    for (const e of rated.filter((x) => x.stemRegime === regime)) {
      if (e.stemWidthRatio !== swrByFont.get(e.fontId)) {
        throw new Error(`session3: ${e.fontId} render-key stemWidthRatio ${e.stemWidthRatio} != manifest ${swrByFont.get(e.fontId)}`);
      }
    }
    regimeMedians[regime] = median(values);
  }

  // --- marginals, unrated rows, rejection causes (READ-011D §3, §9) ------------------------
  const marginal = (field) => {
    const counts = {};
    for (const r of ratings) {
      const v = r[field] ?? '';
      counts[v] = (counts[v] ?? 0) + 1;
    }
    return counts;
  };
  const unrated = allRows
    .filter((r) => r.sellableRaw === '')
    .map((r) => ({ slug: r.slug, block: r.block, fontId: r.fontId, mode: r.mode }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));

  const noRows = allRows.filter((r) => r.sellableRaw === 'no');
  let noNote = 0;
  let noTagMatch = 0;
  let multiTag = 0;
  const perTagCount = Object.fromEntries(CAUSE_TAGS.map((t) => [t, 0]));
  const distinctNotesMap = new Map();
  for (const r of noRows) {
    const note = r.notes ?? '';
    if (note.trim() === '') { noNote += 1; continue; }
    const tags = classifyNote(note);
    if (!distinctNotesMap.has(note)) distinctNotesMap.set(note, tags);
    if (tags.length === 0) noTagMatch += 1;
    if (tags.length > 1) multiTag += 1;
    for (const t of tags) perTagCount[t] += 1;
  }
  const perTag = {};
  for (const t of CAUSE_TAGS) {
    perTag[t] = { n: perTagCount[t], populationSharePct: pct(perTagCount[t], noRows.length) };
  }
  const distinctNotes = [...distinctNotesMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([note, tags]) => ({ note, tags }));

  // --- self-consistency (READ-011D §5) ----------------------------------------------------
  // Agreement is tallied only over duplicate groups whose members are all rated; `n` (all groups)
  // and `fullyRatedGroups` (the agreement denominator) are emitted separately so a partially-rated
  // sheet reads unambiguously.
  const scAgree = { readable: 0, sellable: 0, both: 0 };
  let fullyRatedGroups = 0;
  for (const g of groups) {
    if (!g.allMembersRated) continue;
    fullyRatedGroups += 1;
    if (g.readableSame) scAgree.readable += 1;
    if (g.sellableSame) scAgree.sellable += 1;
    if (g.bothSame) scAgree.both += 1;
  }
  const seededUnderMin = groups.filter((g) => g.hasSeededRepeat && g.spansUnderMinPositions);
  // The all-groups under-15 summary (not just the seeded repeats) — a group can be a probable
  // recognition and a degenerate tracking cell at once, and both weaken its contribution.
  const groupsUnderMin = groups
    .filter((g) => g.spansUnderMinPositions)
    .map((g) => ({
      key: g.key,
      primarySlug: g.primarySlug,
      sheetSpan: g.sheetSpan,
      kind: g.kind,
      isDegenerateTrackingCell: g.trackingContrastPresent,
    }));

  // --- achieved tracking arms (READ-011D §4) --------------------------------------------
  const armSplit = (rows) => {
    const t = rows.filter((r) => r.tracked).length;
    return { tracked: t, untracked: rows.length - t };
  };
  const intentZero = allRows.filter((r) => r.trackingTarget === 'separation' && r.letterSpacingMm === 0);
  const ratedTracked = allRows.filter((r) => r.tracked);
  const courierFail = allRows.find((r) => r.fontId === 'courier-prime-regular' && r.separationAchieved === false);
  const achievedTracking = {
    definition: 'letterSpacingMm > 0',
    primaryPopulation: primaryRows.length,
    ...armSplit(primaryRows),
    byMode: Object.fromEntries(S3_MODES.map((m) => [m, armSplit(primaryRows.filter((r) => r.mode === m))])),
    ratedLevel: {
      population: allRows.length,
      ...armSplit(allRows),
      trackedByMode: Object.fromEntries(S3_MODES.map((m) => [m, ratedTracked.filter((r) => r.mode === m).length])),
    },
    intentSeparationResolvedToZeroMm: {
      total: intentZero.length,
      byMode: Object.fromEntries(S3_MODES.map((m) => [m, intentZero.filter((r) => r.mode === m).length])),
      ofSeparationEntriesByMode: Object.fromEntries(S3_MODES.map((m) => [
        m, allRows.filter((r) => r.trackingTarget === 'separation' && r.mode === m).length,
      ])),
    },
    courierPrimeFailedEntry: courierFail
      ? {
        slug: courierFail.slug,
        trackingTarget: courierFail.trackingTarget,
        letterSpacingMm: courierFail.letterSpacingMm,
        inPrimaryPopulation: courierFail.duplicateOf == null,
        countedAs: courierFail.tracked ? 'tracked' : 'untracked',
      }
      : null,
  };

  // --- floor decision tables (READ-011D §6, §9) --------------------------------------------
  const trackedMatch = (r, arm) => (arm === 'tracked' ? r.tracked : !r.tracked);
  const floorByStones = {
    form: 'A — single constant',
    cutVariable: 'stonesAcrossStem = ratio × stemWidthRatio',
    scopedBy: 'mode × achievedTracking',
    candidates: S3_STONES_CANDIDATES,
    scopes: {},
  };
  for (const m of S3_MODES) {
    for (const arm of S3_ACHIEVED) {
      const rows = primaryRows.filter((r) => r.mode === m && trackedMatch(r, arm));
      // The cut uses the unrounded ratio × stemWidthRatio product; `stonesAcrossStem` on each row is
      // the same product rounded to 4 places, emitted for display only.
      floorByStones.scopes[`${m}|${arm}`] = buildFloorScope(
        rows, S3_STONES_CANDIDATES, `session3.floorByStones[${m}|${arm}]`, (r) => r.ratio * r.stemWidthRatio, true,
      );
    }
  }
  const floorByRatio = {
    form: 'B — three class steps',
    cutVariable: 'ratio',
    scopedBy: 'stemRegime × mode × achievedTracking',
    candidates: S3_RATIO_CANDIDATES,
    scopes: {},
  };
  for (const regime of S3_REGIMES) {
    for (const m of S3_MODES) {
      for (const arm of S3_ACHIEVED) {
        const rows = primaryRows.filter((r) => r.stemRegime === regime && r.mode === m && trackedMatch(r, arm));
        floorByRatio.scopes[`${regime}|${m}|${arm}`] = buildFloorScope(
          rows, S3_RATIO_CANDIDATES, `session3.floorByRatio[${regime}|${m}|${arm}]`, (r) => r.ratio, true,
        );
      }
    }
  }

  // --- size invariance (READ-011D §9) ---------------------------------------------------
  const bigRows = allRows.filter((r) => r.stoneSizeId === 'ss16' || r.stoneSizeId === 'ss20');
  const siPairs = bigRows.map((r) => {
    const cp = allRows.find((c) => c.stoneSizeId === 'ss10' && c.fontId === r.fontId
      && c.mode === r.mode && c.ratio === r.ratio && c.block === 'main' && c.trackingTarget === 'none');
    if (!cp) throw new Error(`session3.sizeInvariance: no SS10 counterpart for ${r.slug} (${r.fontId} ${r.mode} ${r.ratio})`);
    return {
      fontId: r.fontId,
      mode: r.mode,
      ratio: r.ratio,
      bigSlug: r.slug,
      bigStoneSizeId: r.stoneSizeId,
      bigSellable: r.sellableRaw,
      bigRated: r.isRated,
      ss10Slug: cp.slug,
      ss10Sellable: cp.sellableRaw,
      ss10Rated: cp.isRated,
    };
  }).sort((a, b) => (a.bigSlug < b.bigSlug ? -1 : 1));
  const sideCount = (rows) => ({
    n: rows.length,
    rated: rows.filter((r) => r.isRated).length,
    sellable: rows.filter((r) => r.sellable).length,
  });
  const ss10Counterparts = [...new Set(siPairs.map((p) => p.ss10Slug))].map((s) => rowBySlugA.get(s));
  const sizeInvariance = {
    pairs: siPairs,
    perSize: {
      ss10: sideCount(ss10Counterparts),
      ss16: sideCount(bigRows.filter((r) => r.stoneSizeId === 'ss16')),
      ss20: sideCount(bigRows.filter((r) => r.stoneSizeId === 'ss20')),
    },
  };

  // --- tracking contrast, between-font only (READ-011D §2, §4) --------------------------
  const rateCell = (rows) => {
    const ratedRows = rows.filter((r) => r.isRated);
    const k = ratedRows.filter((r) => r.sellable).length;
    return { n: rows.length, rated: ratedRows.length, sellable: k, sellablePct: pct(k, ratedRows.length) };
  };
  const trackingContrast = {
    note: 'between-font contrast only; tracking is unpaired (spec §2). Not a McNemar-style paired test.',
    scopedBy: 'mode × achievedTracking',
    scopes: {},
  };
  for (const m of S3_MODES) {
    for (const arm of S3_ACHIEVED) {
      trackingContrast.scopes[`${m}|${arm}`] = rateCell(primaryRows.filter((r) => r.mode === m && trackedMatch(r, arm)));
    }
  }
  const trackingContrastByIntent = {
    note: 'sensitivity table on trackingTarget (intent), not achieved spacing (spec §4).',
    scopedBy: 'mode × trackingTarget',
    scopes: {},
  };
  for (const m of S3_MODES) {
    for (const intent of S3_INTENT) {
      trackingContrastByIntent.scopes[`${m}|${intent}`] = rateCell(
        primaryRows.filter((r) => r.mode === m && r.trackingTarget === intent),
      );
    }
  }

  // --- separation shortfall (READ-011D §2) ---------------------------------------------
  const shortfallRows = allRows
    .filter((r) => r.separationAchieved === false)
    .map((r) => ({
      slug: r.slug,
      fontId: r.fontId,
      mode: r.mode,
      ratio: r.ratio,
      separationRatioBefore: r.separationRatioBefore,
      separationRatioAfter: r.separationRatioAfter,
      letterSpacingMm: r.letterSpacingMm,
      inPrimaryPopulation: r.duplicateOf == null,
      countedAs: r.tracked ? 'tracked' : 'untracked',
      sellable: r.sellableRaw,
    }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const separationShortfall = {
    count: shortfallRows.length,
    allOutline: shortfallRows.every((r) => r.mode === 'outline'),
    rows: shortfallRows,
  };

  return {
    meta: {
      milestone: 'READ-011D',
      generatedBy: 'tools/font-certification/analyze-ratings.mjs',
      inputs: [
        'docs/data/read-011/ratings.csv',
        'docs/data/read-011/render-key.json',
        'assets/fonts/manifest.json',
      ],
      causeTags: CAUSE_TAGS,
      duplicateKeyFields: S3_DUP_KEY_FIELDS,
      achievedTrackingDefinition: 'letterSpacingMm > 0',
      spanMinPositions: S3_SPAN_MIN_POSITIONS,
      regimePools,
      regimeMedianStemWidthRatio: regimeMedians,
      cutGrids: { stonesAcrossStem: S3_STONES_CANDIDATES, ratio: S3_RATIO_CANDIDATES },
      clearanceRule: S3_CLEARANCE,
      selectionToleranceStones: 0.25,
      comparisonFigure: 'READ-005 session 1: 13/15 sellable self-consistency',
    },
    session3: {
      rowCount: ratings.length,
      unratedRows: { count: unrated.length, rows: unrated },
      marginals: { readable: marginal('readable'), sellable: marginal('sellable') },
      duplicateGroups: {
        count: groups.length,
        sizes: groupSizes,
        primaryPopulation: primaryRows.length,
        droppedRows: droppedComputed.size,
        byKind: {
          'main/repeats pair': groups.filter((g) => g.kind === 'main/repeats pair').length,
          'main/main collision': groups.filter((g) => g.kind === 'main/main collision').length,
          triple: groups.filter((g) => g.kind === 'triple').length,
        },
        groups,
      },
      selfConsistency: {
        n: groups.length,
        fullyRatedGroups,
        readableAgreement: scAgree.readable,
        sellableAgreement: scAgree.sellable,
        bothAgreement: scAgree.both,
        seededRepeatsUnderMinPositions: {
          count: seededUnderMin.length,
          groups: seededUnderMin.map((g) => ({ key: g.key, primarySlug: g.primarySlug, sheetSpan: g.sheetSpan })),
        },
        groupsUnderMinPositions: {
          count: groupsUnderMin.length,
          groups: groupsUnderMin,
        },
      },
      degenerateTrackingCells: {
        count: degenerate.length,
        cells: degenerate.map((g) => ({
          key: g.key,
          fontId: g.fontId,
          mode: g.mode,
          ratio: g.ratio,
          primarySlug: g.primarySlug,
          memberSlugs: g.memberSlugs,
          trackingTargets: g.trackingTargets,
        })),
      },
      achievedTracking,
      floorByStones,
      floorByRatio,
      sizeInvariance,
      trackingContrast,
      trackingContrastByIntent,
      separationShortfall,
      rejectionCauses: {
        population: noRows.length,
        noNote,
        noTagMatch,
        multiTag,
        perTag,
        distinctNotes,
      },
    },
  };
}

// --- public API ------------------------------------------------------------------------------

export function computeAll() {
  const s1Ratings = readCsvObjects(path.join(DATA_DIR, 'ratings.csv'));
  const s1Key = JSON.parse(readFileSync(path.join(DATA_DIR, 'calibration-key.json'), 'utf8'));
  const s2Ratings = readCsvObjects(path.join(DATA_DIR, 'tracking-renders-ratings.csv'));
  const s2Key = JSON.parse(readFileSync(path.join(DATA_DIR, 'tracking-key.json'), 'utf8'));

  return {
    meta: {
      milestone: 'READ-005B',
      generatedBy: 'tools/font-certification/analyze-ratings.mjs',
      inputs: ['ratings.csv', 'calibration-key.json', 'tracking-renders-ratings.csv', 'tracking-key.json'],
      causeTags: CAUSE_TAGS,
    },
    session1: computeSession1(s1Ratings, s1Key),
    session2: computeSession2(s2Ratings, s2Key),
  };
}

// --- deep compare for --check ----------------------------------------------------------------

function diffPaths(actual, expected, prefix = '', out = []) {
  const isObj = (v) => v !== null && typeof v === 'object';
  if (!isObj(actual) || !isObj(expected)) {
    if (!Object.is(actual, expected)) {
      out.push({ path: prefix || '(root)', expected, actual });
    }
    return out;
  }
  if (Array.isArray(actual) !== Array.isArray(expected)) {
    out.push({ path: prefix || '(root)', expected, actual });
    return out;
  }
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const k of keys) {
    const childPrefix = prefix ? `${prefix}.${k}` : k;
    if (!(k in actual)) { out.push({ path: childPrefix, expected: expected[k], actual: undefined }); continue; }
    if (!(k in expected)) { out.push({ path: childPrefix, expected: undefined, actual: actual[k] }); continue; }
    diffPaths(actual[k], expected[k], childPrefix, out);
  }
  return out;
}

// --- markdown report ------------------------------------------------------------------------

function renderMarkdown(data) {
  const L = [];
  const s1 = data.session1;
  const s2 = data.session2;
  L.push('# READ-005 derived tables\n');
  L.push('Recomputed from `docs/data/read-005/` by `tools/font-certification/analyze-ratings.mjs`.');
  L.push('Classifier rules are fixed by the READ-005B prompt and are not tuned to the findings doc.\n');

  L.push('## Session 1 — calibration ratings\n');
  L.push(`Rows: ${s1.rowCount}\n`);
  L.push(`- readable marginals: ${JSON.stringify(s1.marginals.readable)}`);
  L.push(`- sellable marginals: ${JSON.stringify(s1.marginals.sellable)}`);
  const sc = s1.raterSelfConsistency;
  L.push(`- rater self-consistency (n=${sc.n}): readable ${sc.readable}/${sc.n}, sellable ${sc.sellable}/${sc.n}, both ${sc.both}/${sc.n}\n`);

  const rc = s1.rejectionCauses;
  L.push('### Rejection causes (multi-label)\n');
  L.push(`- population (sellable === 'no'): ${rc.population}`);
  L.push(`- rows with no note at all: ${rc.noNote}`);
  L.push(`- rows with a note matching no tag: ${rc.noTagMatch}`);
  L.push(`- rows with more than one tag: ${rc.multiTag}\n`);
  L.push('| tag | n | population share |');
  L.push('|---|---:|---:|');
  for (const t of data.meta.causeTags) {
    L.push(`| ${t} | ${rc.perTag[t].n} | ${rc.perTag[t].populationSharePct}% |`);
  }
  L.push('\n### Every distinct note string with its tag set\n');
  L.push('| note | tags |');
  L.push('|---|---|');
  for (const dn of rc.distinctNotes) {
    L.push(`| ${JSON.stringify(dn.note)} | ${dn.tags.length ? dn.tags.join(', ') : '(none)'} |`);
  }

  L.push('\n### Letters named in notes\n');
  L.push(s1.lettersNamed.map((x) => `${x.letter} (${x.count})`).join(', '));

  L.push('\n### Mode × ratio\n');
  L.push('| mode | n | sellable | <20 | 20–25 | 25–30 | 30+ |');
  L.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const m of s1.modeRatio) {
    const cell = (label) => {
      const b = m.bands[label];
      return `${b.sellablePct === null ? '—' : b.sellablePct + '%'} (n=${b.n})`;
    };
    L.push(`| ${m.mode} | ${m.n} | ${m.sellablePct}% | ${cell('<20')} | ${cell('20–25')} | ${cell('25–30')} | ${cell('30+')} |`);
  }

  L.push('\n### Inaccurate-tag load by mode\n');
  L.push('| mode | n | rejections | inaccurate |');
  L.push('|---|---:|---:|---:|');
  for (const m of s1.inaccurateByMode) {
    L.push(`| ${m.mode} | ${m.n} | ${m.sellNo} | ${m.inaccurate} |`);
  }

  L.push('\n### Script-face bands (block = joined-scripts)\n');
  L.push(`n=${s1.scriptFaceBands.n}, sellable ${s1.scriptFaceBands.sellable}/${s1.scriptFaceBands.n} (${s1.scriptFaceBands.sellablePct}%)\n`);
  L.push('| band | n | sellable | % |');
  L.push('|---|---:|---:|---:|');
  for (const label of ['<22', '22–26', '26–29', '29+']) {
    const b = s1.scriptFaceBands.bands[label];
    L.push(`| ${label} | ${b.n} | ${b.sellable} | ${b.sellablePct === null ? '—' : b.sellablePct + '%'} |`);
  }

  L.push('\n### Interior-mode fidelity cut (ratio >= 15)\n');
  for (const g of s1.interiorFidelity.groups) {
    L.push(`**${g.modes.join(' + ')}** — population ${g.population}, excluded below ratio 15: ${g.excludedBelow15}\n`);
    L.push('| band | n | rejections | inaccurate | share of rejections | share of rows |');
    L.push('|---|---:|---:|---:|---:|---:|');
    for (const label of s1.interiorFidelity.bands) {
      const b = g.byBand[label];
      const pr = b.inaccuratePctOfRejections === null ? '—' : b.inaccuratePctOfRejections + '%';
      const pw = b.inaccuratePctOfRows === null ? '—' : b.inaccuratePctOfRows + '%';
      L.push(`| ${label} | ${b.n} | ${b.rejections} | ${b.inaccurate} | ${pr} | ${pw} |`);
    }
    L.push('');
  }

  // --- READ-007 sections ------------------------------------------------------------------
  const sumCells = (bandsObj) => Object.values(bandsObj).reduce((acc, c) => acc + c.n, 0);
  const sumScope = (byBand) => Object.values(byBand).reduce((acc, bt) => acc + sumCells(bt), 0);

  L.push('\n## READ-007 — ratio-floor evidence\n');
  L.push('New derived tables. No product code and no rendered output change; recomputed from the');
  L.push('same four frozen inputs. `ratio` throughout is height-to-stone-diameter.\n');

  L.push('### 4.1 Ratio × separation band\n');
  for (const [scopeName, scope] of Object.entries(s1.ratioBySeparation.scopes)) {
    L.push(`**${scopeName}** — population ${scope.population}, summed cells ${sumScope(scope.bySeparation)}, rows with no separationBand: ${scope.noSeparationBand}\n`);
    L.push('| separation | <20 | 20–25 | 25–30 | 30+ |');
    L.push('|---|---:|---:|---:|---:|');
    for (const sb of s1.ratioBySeparation.separationBands) {
      const bt = scope.bySeparation[sb];
      const cell = (label) => {
        const c = bt[label];
        return `${c.sellable}/${c.n}${c.sellablePct === null ? '' : ` (${c.sellablePct}%)`}`;
      };
      L.push(`| ${sb} | ${cell('<20')} | ${cell('20–25')} | ${cell('25–30')} | ${cell('30+')} |`);
    }
    L.push('');
    // Within-band collapse: below-20 against at-or-above-20, both operands, quoting the cells
    // above (the three upper bands summed). No new key path — this is a reading of 4.1's table.
    L.push('_below 20 vs at or above 20 (sellable / n), from the cells above:_\n');
    L.push('| separation | below 20 | at or above 20 |');
    L.push('|---|---:|---:|');
    for (const sb of s1.ratioBySeparation.separationBands) {
      const bt = scope.bySeparation[sb];
      const below = bt['<20'];
      const aboveN = bt['20–25'].n + bt['25–30'].n + bt['30+'].n;
      const aboveK = bt['20–25'].sellable + bt['25–30'].sellable + bt['30+'].sellable;
      L.push(`| ${sb} | ${below.sellable}/${below.n} | ${aboveK}/${aboveN} |`);
    }
    L.push('');
  }

  L.push('### 4.2 Block provenance by ratio band\n');
  const bbrb = s1.blockByRatioBand;
  L.push(`population ${bbrb.population}, summed cells ${sumScope(bbrb.byBlock)}\n`);
  L.push('| block | <20 | 20–25 | 25–30 | 30+ |');
  L.push('|---|---:|---:|---:|---:|');
  for (const b of bbrb.blocks) {
    const bt = bbrb.byBlock[b];
    L.push(`| ${b} | ${bt['<20'].n} | ${bt['20–25'].n} | ${bt['25–30'].n} | ${bt['30+'].n} |`);
  }
  L.push('');

  L.push('### 4.3 Floor candidates\n');
  L.push('Each cell: `sellableBelow / rowsBelow  ·  sellableAtOrAbove / rowsAtOrAbove`.\n');
  const floorScopeNames = Object.keys(s1.floorCandidates.scopes);
  L.push(`| floor | ${floorScopeNames.join(' | ')} |`);
  L.push(`|---|${floorScopeNames.map(() => '---').join('|')}|`);
  for (const c of s1.floorCandidates.candidates) {
    const cells = floorScopeNames.map((name) => {
      const x = s1.floorCandidates.scopes[name].byCandidate[c];
      return `${x.sellableBelow}/${x.rowsBelow} · ${x.sellableAtOrAbove}/${x.rowsAtOrAbove}`;
    });
    L.push(`| ${c} | ${cells.join(' | ')} |`);
  }
  L.push('');
  const lowestFloor = s1.floorCandidates.candidates[0];
  for (const name of floorScopeNames) {
    const sc = s1.floorCandidates.scopes[name];
    L.push(
      `- ${name}: population ${sc.population}; rows below the lowest candidate (ratio ${lowestFloor}): ` +
      `${sc.byCandidate[lowestFloor].rowsBelow}`,
    );
  }
  L.push('');
  L.push('Read `sellableBelow / rowsBelow` as two counts, never a rate: where `rowsBelow` is 0 or 1');
  L.push('the cut has no population to speak of, not a 0% result.');

  L.push('\n### 4.4 Non-script cut — reproducibility of READ-005A §4.2\n');
  const ns = s1.nonScriptCut;
  L.push(`- definition: ${ns.definition}`);
  L.push(`- population: ${ns.population}`);
  L.push(`- threshold ${ns.threshold}: below — ${ns.sellableBelow}/${ns.rowsBelow} sellable; at or above — ${ns.sellableAtOrAbove}/${ns.rowsAtOrAbove} sellable`);
  L.push(`- distinct fonts in calibration-key.json in neither NON_SCRIPT_FONTS nor JOINED_SCRIPT_FONTS: ${ns.fontsInNeitherScriptSet.count}`);
  if (ns.fontsInNeitherScriptSet.count > 0) {
    L.push('  - these fonts are silently absent from both the non-script and the joined-script cuts:');
    L.push(`    ${ns.fontsInNeitherScriptSet.fonts.join(', ')}`);
  }

  L.push('\n## Session 2 — tracking experiment\n');
  L.push(`Rows: ${s2.rowCount}\n`);
  L.push('| block | n | all sellable | rated n | rated sellable |');
  L.push('|---|---:|---:|---:|---:|');
  for (const pb of s2.perBlock) {
    L.push(`| ${pb.block} | ${pb.n} | ${pb.all.sellable}/${pb.n} (${pb.all.sellablePct}%) | ${pb.rated.n} | ${pb.rated.sellable}/${pb.rated.n} (${pb.rated.sellablePct}%) |`);
  }

  L.push(`\n### Unrated rows: ${s2.unratedRows.count}\n`);
  for (const r of s2.unratedRows.rows) {
    L.push(`- ${r.slug} — block ${r.block}, ${r.fontId}, ${r.mode}`);
  }

  const p = s2.paired;
  L.push('\n### Paired 2×2 (evaluable pairs only)\n');
  L.push(`- pairs: ${p.pairs}; evaluable: ${p.evaluablePairs}; partners all in control: ${p.partnersAllInControl}; one-to-one: ${p.partnersOneToOne}`);
  for (const e of p.excludedPairs) L.push(`- excluded: ${e.tracked} / ${e.control} — ${e.reason}`);
  L.push('');
  L.push('| | control no | control yes |');
  L.push('|---|---:|---:|');
  L.push(`| tracked yes | ${p.cells.trackedYesControlNo} | ${p.cells.both} |`);
  L.push(`| tracked no | ${p.cells.neither} | ${p.cells.trackedNoControlYes} |`);
  L.push(`\nMcNemar exact two-sided: b=${p.mcnemar.b}, c=${p.mcnemar.c}, p=${p.mcnemar.p}`);

  const w = p.widthCostOnWins;
  L.push(`\n### Width cost on the ${w.n} tracking wins\n`);
  L.push(`median +${w.medianPct}%, range +${w.minPct}% to +${w.maxPct}%; values: ${w.valuesPct.map((v) => '+' + v + '%').join(', ')}`);

  L.push('\n### Per-mode tracked vs control (evaluable pairs)\n');
  L.push('| mode | tracked | control |');
  L.push('|---|---:|---:|');
  for (const m of p.perModeEvaluable) {
    L.push(`| ${m.mode} | ${m.trackedYes}/${m.trackedN} | ${m.controlYes}/${m.controlN} |`);
  }

  L.push('\n### Residual complaints on tracked members still sellable = no\n');
  L.push(`rows: ${p.residualComplaints.rows.length}; per tag: ${JSON.stringify(p.residualComplaints.perTag)}; no tag: ${p.residualComplaints.noTag}`);
  for (const r of p.residualComplaints.rows) {
    L.push(`- ${r.slug}: ${JSON.stringify(r.note)} → ${r.tags.length ? r.tags.join(', ') : '(none)'}`);
  }

  L.push(`\n### Tracked members with separationAchieved === false: ${p.trackedSeparationNotAchieved.count}`);
  L.push(p.trackedSeparationNotAchieved.slugs.join(', '));

  L.push(renderSession3Markdown(computeSession3()));

  return L.join('\n') + '\n';
}

// --- session 3 markdown (READ-011D) -----------------------------------------------------------

function renderSession3Markdown(data) {
  const L = [];
  const s3 = data.session3;
  const m = data.meta;
  L.push('\n\n## READ-011D — rating-analysis pre-registration\n');
  L.push('Recomputed from `docs/data/read-011/{ratings.csv,render-key.json}` and');
  L.push('`assets/fonts/manifest.json`. Written before the sheet is rated: with an empty outcome');
  L.push('column every sellable rate below is `null`. See');
  L.push('`docs/specifications/READ-011D-AnalysisPreRegistration.md`.\n');

  L.push(`- rated rows: ${s3.rowCount}; unrated (blank sellable): ${s3.unratedRows.count}`);
  L.push(`- readable marginals: ${JSON.stringify(s3.marginals.readable)}`);
  L.push(`- sellable marginals: ${JSON.stringify(s3.marginals.sellable)}\n`);

  const dg = s3.duplicateGroups;
  L.push('### Duplicate groups\n');
  L.push(`count ${dg.count}, sizes ${JSON.stringify(dg.sizes)}, by kind ${JSON.stringify(dg.byKind)}`);
  L.push(`→ primary population ${dg.primaryPopulation} (= ${s3.rowCount} − ${dg.droppedRows})`);
  L.push(`degenerate tracking cells (a contrast with no contrast in it): ${s3.degenerateTrackingCells.count}\n`);

  const sc = s3.selfConsistency;
  L.push('### Self-consistency\n');
  L.push(`groups ${sc.n}; fully-rated (agreement denominator) ${sc.fullyRatedGroups}: ` +
    `readable ${sc.readableAgreement}/${sc.fullyRatedGroups}, sellable ${sc.sellableAgreement}/${sc.fullyRatedGroups}, both ${sc.bothAgreement}/${sc.fullyRatedGroups}`);
  L.push(`groups spanning < ${m.spanMinPositions} sheet positions: ${sc.groupsUnderMinPositions.count} ` +
    `(${sc.groupsUnderMinPositions.groups.map((g) => `${g.primarySlug} @ ${g.sheetSpan} [${g.kind}${g.isDegenerateTrackingCell ? ', degenerate' : ''}]`).join('; ') || '—'})`);
  L.push(`of those, seeded repeats: ${sc.seededRepeatsUnderMinPositions.count} ` +
    `(${sc.seededRepeatsUnderMinPositions.groups.map((g) => `${g.primarySlug} @ ${g.sheetSpan}`).join(', ') || '—'})`);
  L.push(`comparison figure: ${m.comparisonFigure}\n`);

  const at = s3.achievedTracking;
  L.push('### Achieved tracking (letterSpacingMm > 0)\n');
  L.push(`primary population ${at.primaryPopulation}: ${at.tracked} tracked, ${at.untracked} untracked`);
  L.push(`  by mode: ${S3_MODES.map((x) => `${x} ${at.byMode[x].tracked}/${at.byMode[x].tracked + at.byMode[x].untracked}`).join(', ')}`);
  L.push(`rated level (pre-duplicate-rule): ${at.ratedLevel.tracked} tracked ` +
    `(${S3_MODES.map((x) => `${x} ${at.ratedLevel.trackedByMode[x]}`).join(', ')}), ${at.ratedLevel.untracked} untracked`);
  L.push(`separation intent resolved to 0 mm: ${at.intentSeparationResolvedToZeroMm.total} ` +
    `(${S3_MODES.map((x) => `${x} ${at.intentSeparationResolvedToZeroMm.byMode[x]}/${at.intentSeparationResolvedToZeroMm.ofSeparationEntriesByMode[x]}`).join(', ')})`);
  if (at.courierPrimeFailedEntry) {
    const c = at.courierPrimeFailedEntry;
    L.push(`courier-prime failed separation entry ${c.slug}: counted as ${c.countedAs} (in primary: ${c.inPrimaryPopulation})`);
  }
  L.push('');

  L.push('### Regime pool-median stemWidthRatio (from the manifest)\n');
  for (const regime of S3_REGIMES) {
    L.push(`- ${regime}: ${m.regimeMedianStemWidthRatio[regime]} (pool of ${m.regimePools[regime].length})`);
  }
  L.push(`selection tolerance: ±${m.selectionToleranceStones} stones\n`);

  const floorTable = (fl, title) => {
    L.push(`### ${title}\n`);
    L.push(`form ${fl.form}; cut variable \`${fl.cutVariable}\`; scoped by ${fl.scopedBy}.`);
    L.push('Each cell: `sellableBelow/ratedBelow/rowsBelow · sellableAtOrAbove/ratedAtOrAbove/rowsAtOrAbove`');
    L.push('(`rows*` is population including unrated; `rated*` is the rate denominator).\n');
    L.push(`| cut | ${Object.keys(fl.scopes).join(' | ')} |`);
    L.push(`|---|${Object.keys(fl.scopes).map(() => '---').join('|')}|`);
    for (const c of fl.candidates) {
      const cells = Object.values(fl.scopes).map((sco) => {
        const x = sco.byCandidate[c];
        return `${x.sellableBelow}/${x.ratedBelow}/${x.rowsBelow} · ${x.sellableAtOrAbove}/${x.ratedAtOrAbove}/${x.rowsAtOrAbove}`;
      });
      L.push(`| ${c} | ${cells.join(' | ')} |`);
    }
    L.push('');
  };
  floorTable(s3.floorByStones, 'Form A — floor by stones-across-stem');
  floorTable(s3.floorByRatio, 'Form B — floor by ratio, per regime');

  L.push('### Size invariance\n');
  L.push(`| size | n | rated | sellable |`);
  L.push('|---|---:|---:|---:|');
  for (const sz of ['ss10', 'ss16', 'ss20']) {
    const c = s3.sizeInvariance.perSize[sz];
    L.push(`| ${sz} | ${c.n} | ${c.rated} | ${c.sellable} |`);
  }
  L.push('');

  const contrastTable = (ct, title) => {
    L.push(`### ${title}\n`);
    L.push(`${ct.note}\n`);
    L.push('| scope | n | rated | sellable | rate |');
    L.push('|---|---:|---:|---:|---:|');
    for (const [name, cell] of Object.entries(ct.scopes)) {
      L.push(`| ${name} | ${cell.n} | ${cell.rated} | ${cell.sellable} | ${cell.sellablePct === null ? '—' : cell.sellablePct + '%'} |`);
    }
    L.push('');
  };
  contrastTable(s3.trackingContrast, 'Tracking contrast (achieved, between-font)');
  contrastTable(s3.trackingContrastByIntent, 'Tracking contrast by intent (sensitivity)');

  L.push('### Separation shortfall\n');
  L.push(`${s3.separationShortfall.count} entries below separationRatioAfter 0.95, all outline: ${s3.separationShortfall.allOutline}\n`);
  L.push('| slug | font | ratio | before → after | letterSpacingMm | in primary |');
  L.push('|---|---|---:|---|---:|---|');
  for (const r of s3.separationShortfall.rows) {
    L.push(`| ${r.slug} | ${r.fontId} | ${r.ratio} | ${r.separationRatioBefore} → ${r.separationRatioAfter} | ${r.letterSpacingMm} | ${r.inPrimaryPopulation} |`);
  }
  L.push('');

  L.push('### Rejection causes\n');
  L.push(`population (sellable = no): ${s3.rejectionCauses.population}; ` +
    `no note ${s3.rejectionCauses.noNote}, no tag match ${s3.rejectionCauses.noTagMatch}, multi-tag ${s3.rejectionCauses.multiTag}`);

  return L.join('\n');
}

// --- CLI ------------------------------------------------------------------------------------

function checkGolden(file, data) {
  const rel = path.relative(REPO_ROOT, file);
  let committed;
  try {
    committed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    process.stderr.write(`cannot read ${rel}: ${err.message}\n`);
    return false;
  }
  const diffs = diffPaths(data, committed);
  if (diffs.length === 0) {
    process.stdout.write(`OK — ${rel} matches\n`);
    return true;
  }
  process.stderr.write(`MISMATCH — ${diffs.length} path(s) differ from ${rel}:\n`);
  for (const d of diffs) {
    process.stderr.write(`  ${d.path}\n    committed: ${JSON.stringify(d.expected)}\n    computed:  ${JSON.stringify(d.actual)}\n`);
  }
  return false;
}

function main() {
  const args = process.argv.slice(2);
  const data = computeAll();

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  if (args.includes('--write')) {
    writeFileSync(GOLDEN_FILE, JSON.stringify(data, null, 2) + '\n');
    process.stdout.write(`wrote ${path.relative(REPO_ROOT, GOLDEN_FILE)}\n`);
    writeFileSync(GOLDEN_FILE_011, JSON.stringify(computeSession3(), null, 2) + '\n');
    process.stdout.write(`wrote ${path.relative(REPO_ROOT, GOLDEN_FILE_011)}\n`);
    return;
  }

  if (args.includes('--check')) {
    const okA = checkGolden(GOLDEN_FILE, data);
    const okB = checkGolden(GOLDEN_FILE_011, computeSession3());
    if (!okA || !okB) process.exitCode = 1;
    return;
  }

  process.stdout.write(renderMarkdown(data));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
