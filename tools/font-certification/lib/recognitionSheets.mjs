/**
 * READ-004 — recognition sheet builder.
 *
 * Turns one probe record into one or more contact-sheet HTML pages, each an image a recognition
 * oracle reads back tile by tile. The stone circles and the per-size pixel scale are reused from
 * specimenPages.mjs unchanged — this module owns only the tiling and the anti-cheat rules.
 *
 * ## Rules, in order of importance
 *
 * 1. **One probe per sheet.** Every sheet built here comes from a single probe record, i.e. a
 *    single (font, mode, height, stone size). Two probes are never composited onto one image.
 *
 * 2. **No character appears in two entries on a sheet.** A recognizer that can see the same glyph
 *    rendered legibly elsewhere on the image reads a degraded copy by cross-referencing it, not by
 *    resolving the letterforms — the same false-pass mechanism READ-000 §3 identifies for familiar
 *    phrases. (A character repeated *within one entry*, e.g. `mm`, carries no such advantage — both
 *    copies are equally degraded — so the rule is strictly cross-entry.) Enforced structurally by
 *    the two partitioners below:
 *
 *    - **Single-character entries** are grouped by confusability (union-find over `CONFUSABLE_PAIRS`)
 *      and each confusable group is placed *whole* onto one sheet — a pair split across two sheets
 *      is a hard failure, because the whole point of the `search` tier is to measure O/0, S/5, B/8,
 *      I/1 discrimination and a homogeneous letters-only / digits-only sheet makes that
 *      structurally unmeasurable (the class prior is a contamination of the same family as the
 *      language prior). The remaining characters are filled round-robin to balance tile counts,
 *      and **every single-character sheet is asserted to carry at least one letter and at least one
 *      digit** — that invariant is what kills the class prior.
 *
 *    - **Multi-character entries** are packed greedily: each entry goes on the first sheet whose
 *      character set (whitespace ignored) is disjoint from it, opening a new sheet when none fits.
 *      However many sheets that produces is accepted.
 *
 *    Single- and multi-character entries never share a sheet, so a lone `o` is never on the same
 *    image as `oo` or `Sophia`. Order within a sheet is deterministic for a given corpus (by
 *    corpus index), so the same corpus always produces the same sheets and the cache key keeps
 *    meaning something.
 *
 * 3. **Tiles are labelled with circled numerals (`①②③…`).** That alphabet is disjoint from Latin
 *    letters and Arabic digits under every composition, so the label can never spell — or even
 *    share a character with — an expected answer, regardless of what a sheet contains. The expected
 *    answer never appears as readable text anywhere in the HTML — not in a caption, comment,
 *    `title`, `alt`, `aria-*`, or `data-*`. (A lone letter or digit is unavoidably present in SVG
 *    coordinates, hex colours, and CSS keywords, so the guarantee is "not as a label or
 *    human-readable string", not "not one matching byte anywhere".)
 *
 * 4. Stone rendering and the per-size px/mm table come from specimenPages.mjs (`renderLayoutSvg`,
 *    `RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE`), imported, not copied.
 *
 * 5. The `tileInventory` ([{ index, expectedText }]) is returned alongside the HTML, never
 *    embedded in it — it is the answer key and lives only in the record store.
 */
import { renderLayoutSvg, RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE } from './specimenPages.mjs';
import { resolveCorpus } from './readabilityProbe.mjs';
import { CONFUSABLE_PAIRS } from './requiredCharacters.mjs';

export const MAX_TILES_PER_SHEET = 24;

function isSingleCharEntry(entry) {
  return [...entry].length === 1;
}

/** Distinct, whitespace-stripped characters of an entry — the unit rule 2 partitions on. */
export function entryChars(entry) {
  return [...new Set([...entry].filter((ch) => !/\s/.test(ch)))];
}

const isLatinLetter = (ch) => /[A-Za-z]/.test(ch);
const isArabicDigit = (ch) => /[0-9]/.test(ch);

// --- single-character partitioning -----------------------------------------------------------

/**
 * Union-find over CONFUSABLE_PAIRS, restricted to the characters actually present. Returns the
 * groups as arrays, each in corpus order, the groups themselves in first-appearance order.
 */
function confusableGroups(entries) {
  const present = new Set(entries);
  const parent = new Map(entries.map((ch) => [ch, ch]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  for (const [a, b] of CONFUSABLE_PAIRS) {
    if (!present.has(a) || !present.has(b)) continue;
    parent.set(find(a), find(b));
  }
  const byRoot = new Map();
  for (const ch of entries) {
    const root = find(ch);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(ch);
  }
  return [...byRoot.values()];
}

// Squared deviation of `counts` from a matching array of `targets`.
function sumSquaredDeviation(counts, targets) {
  return counts.reduce((sum, c, i) => sum + (c - targets[i]) ** 2, 0);
}

// The class prior is only neutralised if the digits are spread across sheets in PROPORTION to tile
// count, not merely present. Deviation from the proportional digit target is penalised alongside
// tile imbalance; 4 makes a one-digit swing outweigh a few tiles of imbalance without letting digit
// balance override the "keep every confusable group whole" hard rule.
const DIGIT_BALANCE_WEIGHT = 4;

function partitionSingleChars(entries) {
  if (entries.length === 0) return [];
  const corpusIndex = new Map(entries.map((ch, i) => [ch, i]));
  const corpusTiles = entries.length;
  const corpusDigits = entries.filter(isArabicDigit).length;
  const corpusLetters = corpusTiles - corpusDigits;
  const sheetCount = Math.max(1, Math.ceil(corpusTiles / MAX_TILES_PER_SHEET));
  const nominalTiles = corpusTiles / sheetCount;

  const sheets = Array.from({ length: sheetCount }, () => []);
  const sheetDigits = new Array(sheetCount).fill(0);

  // Proportional digit target for a hypothetical sheet of `tiles` tiles (Part 2): with balanced
  // tile counts this is corpusDigits / sheetCount.
  const digitTargetFor = (tiles) => corpusDigits * tiles / corpusTiles;
  // Fair per-sheet share of each class, used to steer loner placement (a fixed target, not one
  // that moves with the sheet's own current size).
  const fairDigits = corpusDigits / sheetCount;
  const fairLetters = corpusLetters / sheetCount;

  const groups = confusableGroups(entries);
  const confusable = groups
    .filter((g) => g.length > 1)
    .map((g, appearance) => ({ g, digits: g.filter(isArabicDigit).length, appearance }))
    .sort((x, y) => (y.g.length - x.g.length) || (x.appearance - y.appearance));
  const loners = groups.filter((g) => g.length === 1).map((g) => g[0])
    .sort((a, b) => corpusIndex.get(a) - corpusIndex.get(b));

  // Confusable groups, whole, largest first. Each goes to the sheet minimising the combined cost
  // of (a) resulting tile imbalance and (b) resulting deviation from the proportional digit target
  // — so the digit-bearing groups spread out instead of clustering (Part 2).
  for (const { g, digits } of confusable) {
    let best = 0;
    let bestCost = Infinity;
    for (let k = 0; k < sheetCount; k++) {
      const tileCounts = sheets.map((s, i) => s.length + (i === k ? g.length : 0));
      const digitCounts = sheetDigits.map((d, i) => d + (i === k ? digits : 0));
      const cost = sumSquaredDeviation(tileCounts, tileCounts.map(() => nominalTiles))
        + DIGIT_BALANCE_WEIGHT * sumSquaredDeviation(digitCounts, tileCounts.map(digitTargetFor));
      if (cost < bestCost) { bestCost = cost; best = k; }
    }
    sheets[best].push(...g);
    sheetDigits[best] += digits;
  }

  // Loners, in corpus order, each to whichever sheet is currently furthest below its fair share
  // for that loner's class (digit or letter); ties broken toward the smaller sheet so overall tile
  // counts stay balanced too.
  for (const ch of loners) {
    const digit = isArabicDigit(ch);
    let best = 0;
    let bestScore = -Infinity;
    for (let k = 0; k < sheetCount; k++) {
      const have = digit ? sheetDigits[k] : sheets[k].length - sheetDigits[k];
      const deficit = (digit ? fairDigits : fairLetters) - have;
      const score = deficit - 1e-6 * sheets[k].length;
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    sheets[best].push(ch);
    if (digit) sheetDigits[best] += 1;
  }

  for (const sheet of sheets) sheet.sort((a, b) => corpusIndex.get(a) - corpusIndex.get(b));

  // invariant (rule 2): every sheet mixes letters and digits, so no recognizer can lean on a
  // "this page is all letters" prior to rule out the O→0 / S→5 / B→8 error.
  sheets.forEach((sheet, i) => {
    if (!sheet.some(isLatinLetter) || !sheet.some(isArabicDigit)) {
      throw new Error(
        `recognitionSheets: single-character sheet ${i} is not letter+digit mixed ` +
        `(${JSON.stringify(sheet.join(''))}) — the class prior is not neutralised`
      );
    }
  });
  // invariant (rule 2): a confusable pair is never split across two sheets.
  const sheetOf = new Map();
  sheets.forEach((sheet, i) => sheet.forEach((ch) => sheetOf.set(ch, i)));
  for (const [a, b] of CONFUSABLE_PAIRS) {
    if (sheetOf.has(a) && sheetOf.has(b) && sheetOf.get(a) !== sheetOf.get(b)) {
      throw new Error(`recognitionSheets: confusable pair ${a}/${b} split across sheets ${sheetOf.get(a)} and ${sheetOf.get(b)}`);
    }
  }

  return sheets.filter((s) => s.length > 0).map((entries) => ({ cls: 'mixed', entries }));
}

// --- multi-character partitioning ------------------------------------------------------------

function partitionMultiChars(entries) {
  const sheets = [];
  for (const entry of entries) {
    const chars = entryChars(entry);
    let target = sheets.find((s) => chars.every((ch) => !s.chars.has(ch)));
    if (!target) {
      target = { entries: [], chars: new Set() };
      sheets.push(target);
    }
    target.entries.push(entry);
    for (const ch of chars) target.chars.add(ch);
  }
  return sheets.map((s) => ({ cls: 'string', entries: s.entries }));
}

/**
 * Splits corpus entries into sheet-sized groups that each satisfy rule 2. Single-character entries
 * and multi-character entries are partitioned separately (see the module doc) and never share a
 * sheet. Deterministic for a given corpus.
 */
export function partitionEntries(entries) {
  const singles = entries.filter(isSingleCharEntry);
  const multis = entries.filter((e) => !isSingleCharEntry(e));
  return [...partitionSingleChars(singles), ...partitionMultiChars(multis)];
}

// --- labels ---------------------------------------------------------------------------------

// Circled numerals ①..⑳ (U+2460..) then ㉑..㉟ (U+3251..) — a single alphabet that is disjoint
// from Latin letters and Arabic digits under every composition, so the label itself can never
// spell an answer regardless of what a sheet contains.
const CIRCLED_NUMERALS = [
  ...Array.from({ length: 20 }, (_, i) => String.fromCodePoint(0x2460 + i)),
  ...Array.from({ length: 15 }, (_, i) => String.fromCodePoint(0x3251 + i))
];

export function labelsForCount(count) {
  if (count > CIRCLED_NUMERALS.length) {
    throw new Error(`recognitionSheets: ${count} tiles exceeds the ${CIRCLED_NUMERALS.length}-symbol circled-numeral label alphabet`);
  }
  return CIRCLED_NUMERALS.slice(0, count);
}

const PAGE_CSS = `
  html { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: #0f1720; }
  main { padding: 24px; }
  .grid { display: flex; flex-wrap: wrap; gap: 22px; align-items: flex-start; }
  .cell { background: #131c27; border: 1px solid #26313f; border-radius: 6px; padding: 10px 10px 14px; width: 640px; max-width: 640px; overflow: hidden; box-sizing: border-box; }
  .cap { font: 600 15px ui-monospace, Menlo, monospace; color: #9fb0c3; text-align: center; margin: 0 0 8px; letter-spacing: 0.12em; }
  .art { display: flex; align-items: center; justify-content: center; min-height: 40px; }
  .art svg { display: block; max-width: 100%; height: auto; }
  .art .row-note, .art .stone-error { display: none; }
`;

function pageShell(bodyHtml) {
  // No <title> text beyond a fixed neutral string; no comments; nothing derived from any answer.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tile grid</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<div class="grid">
${bodyHtml}
</div>
</main>
</body>
</html>`;
}

// Belt-and-braces: fail loudly if any answer-key material made it into the markup as readable
// text. Comments and alt/aria/data- attributes are rejected outright. Because the labels are
// circled numerals — disjoint from Latin letters and Arabic digits — the caption check is
// unconditional: no caption can legitimately contain any run of Latin/Arabic characters. A
// full-HTML substring scan is still applied only to entries of length >= 3 (words and the long
// stress strings): a 1- or 2-character sequence coincides too readily with an SVG coordinate, a
// hex colour, or a CSS keyword to treat a raw byte match as a leak, and those short entries are
// already covered by the caption + structural checks.
function assertNoAnswerLeak(html, tileInventory) {
  if (/<!--/.test(html)) throw new Error('recognitionSheets: sheet HTML contains a comment');
  if (/\b(alt|aria-label|data-[\w-]+)\s*=/.test(html)) {
    throw new Error('recognitionSheets: sheet HTML contains an alt/aria/data- attribute');
  }
  const captions = [...html.matchAll(/<p class="cap">([^<]*)<\/p>/g)].map((m) => m[1]);
  for (const { expectedText } of tileInventory) {
    for (const caption of captions) {
      if (caption.includes(expectedText)) {
        throw new Error(`recognitionSheets: caption ${JSON.stringify(caption)} leaks an expected answer`);
      }
    }
    if ([...expectedText].length >= 3 && html.includes(expectedText)) {
      throw new Error(`recognitionSheets: sheet HTML leaks the expected string ${JSON.stringify(expectedText)}`);
    }
  }
}

/**
 * @param {object} params
 * @param {object} params.probeRecord From readabilityProbe.runProbe() — must still carry
 *   `measurements` (with each entry's `stones` array). A record whose `signalA.passed` is false
 *   (no measurements) cannot be turned into a sheet and throws.
 * @param {string | object} [params.corpus] tier name or resolved corpus; defaults to the record's
 *   own `corpusName`.
 * @returns {{ sheets: { index: number, cls: string, html: string, tileInventory: {index:string,expectedText:string}[] }[] }}
 */
export function buildRecognitionSheetHtml({ probeRecord, corpus } = {}) {
  if (!probeRecord || !Array.isArray(probeRecord.measurements)) {
    throw new Error('recognitionSheets: probeRecord has no measurements — signal A must pass before a sheet is built');
  }
  const resolved = resolveCorpus(corpus ?? probeRecord.corpusName);
  const pxPerMm = RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE[probeRecord.stoneSizeId];
  if (!pxPerMm) throw new Error(`recognitionSheets: no px/mm scale for stone size "${probeRecord.stoneSizeId}"`);

  const byText = new Map(probeRecord.measurements.map((m) => [m.text, m]));
  const groups = partitionEntries(resolved.entries);

  const sheets = groups.map((group, sheetIndex) => {
    const labels = labelsForCount(group.entries.length);
    const tileInventory = [];
    const cells = group.entries.map((text, i) => {
      const label = labels[i];
      tileInventory.push({ index: label, expectedText: text });
      const measurement = byText.get(text);
      const art = measurement
        ? renderLayoutSvg(measurement, pxPerMm)
        : '<div class="art">(no layout)</div>';
      return `<figure class="cell">
  <p class="cap">${label}</p>
  <div class="art">${art}</div>
</figure>`;
    }).join('\n');

    const html = pageShell(cells);
    assertNoAnswerLeak(html, tileInventory);
    return { index: sheetIndex, cls: group.cls, html, tileInventory };
  });

  return { sheets };
}
