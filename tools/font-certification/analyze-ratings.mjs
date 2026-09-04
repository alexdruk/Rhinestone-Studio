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

// READ-007 §4.4: the script-face lists are imported from the render builder rather than copied, so
// the two files can never drift. calibration-renders.mjs reads f-ladder.json only inside run(), so
// importing it here loads no data and keeps `.meta.inputs` at the same four files.
import { NON_SCRIPT_FONTS, JOINED_SCRIPT_FONTS } from './calibration-renders.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'docs', 'data', 'read-005');
const GOLDEN_FILE = path.join(DATA_DIR, 'derived-tables.json');

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
  const floorCut = (rows, threshold) => {
    const below = rows.filter((row) => row.ratio < threshold);
    const atOrAbove = rows.filter((row) => row.ratio >= threshold);
    return {
      rowsBelow: below.length,
      sellableBelow: below.filter((row) => row.sellable).length,
      rowsAtOrAbove: atOrAbove.length,
      sellableAtOrAbove: atOrAbove.filter((row) => row.sellable).length,
    };
  };
  const floorScope = (rows, label) => {
    const byCandidate = {};
    for (const c of FLOOR_CANDIDATES) {
      const cut = floorCut(rows, c);
      if (cut.rowsBelow + cut.rowsAtOrAbove !== rows.length) {
        throw new Error(`${label}: candidate ${c} — rowsBelow + rowsAtOrAbove != population ${rows.length}`);
      }
      byCandidate[c] = cut;
    }
    return { population: rows.length, byCandidate };
  };
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
    definition: 'fontId in NON_SCRIPT_FONTS (imported from calibration-renders.mjs)',
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

  return L.join('\n') + '\n';
}

// --- CLI ------------------------------------------------------------------------------------

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
    return;
  }

  if (args.includes('--check')) {
    let committed;
    try {
      committed = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'));
    } catch (err) {
      process.stderr.write(`cannot read ${path.relative(REPO_ROOT, GOLDEN_FILE)}: ${err.message}\n`);
      process.exitCode = 1;
      return;
    }
    const diffs = diffPaths(data, committed);
    if (diffs.length === 0) {
      process.stdout.write('OK — derived-tables.json matches computeAll()\n');
      return;
    }
    process.stderr.write(`MISMATCH — ${diffs.length} path(s) differ from ${path.relative(REPO_ROOT, GOLDEN_FILE)}:\n`);
    for (const d of diffs) {
      process.stderr.write(`  ${d.path}\n    committed: ${JSON.stringify(d.expected)}\n    computed:  ${JSON.stringify(d.actual)}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(renderMarkdown(data));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
