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

function bandTable(rows, bands) {
  // rows: [{ ratio, sellable(boolean) }]
  const out = {};
  for (const band of bands) {
    const inBand = rows.filter((r) => bandOf(r.ratio, bands) === band.label);
    const k = inBand.filter((r) => r.sellable).length;
    out[band.label] = { n: inBand.length, sellable: k, sellablePct: pct(k, inBand.length) };
  }
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
  { label: '29–32', lo: 29, hi: 32 },
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
        bands: bandTable(rows, MODE_BANDS),
      };
    });

  // Script-face bands over key.block === 'joined-scripts'.
  const scriptRows = ratings
    .filter((r) => key[r.slug].block === 'joined-scripts')
    .map((r) => ({ ratio: key[r.slug].ratio, sellable: r.sellable === 'yes' }));
  const scriptK = scriptRows.filter((x) => x.sellable).length;

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
    scriptFaceBands: {
      block: 'joined-scripts',
      n: scriptRows.length,
      sellable: scriptK,
      sellablePct: pct(scriptK, scriptRows.length),
      bands: bandTable(scriptRows, SCRIPT_BANDS),
    },
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

  L.push('\n### Script-face bands (block = joined-scripts)\n');
  L.push(`n=${s1.scriptFaceBands.n}, sellable ${s1.scriptFaceBands.sellable}/${s1.scriptFaceBands.n} (${s1.scriptFaceBands.sellablePct}%)\n`);
  L.push('| band | n | sellable | % |');
  L.push('|---|---:|---:|---:|');
  for (const label of ['<22', '22–26', '26–29', '29–32']) {
    const b = s1.scriptFaceBands.bands[label];
    L.push(`| ${label} | ${b.n} | ${b.sellable} | ${b.sellablePct === null ? '—' : b.sellablePct + '%'} |`);
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
