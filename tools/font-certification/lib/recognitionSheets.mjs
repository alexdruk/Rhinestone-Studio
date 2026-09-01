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
 * 2. **No character appears twice on a sheet.** A recognizer that can see the same glyph rendered
 *    legibly elsewhere on the image reads a degraded copy by cross-referencing, not by resolving
 *    it — the same false-pass mechanism READ-000 §3 identifies for familiar phrases. Enforced two
 *    ways: (a) every tile on a sheet has a distinct `expectedText`, and (b) single-character
 *    tiles are partitioned by class (letters on their own sheets, digits on their own sheets,
 *    multi-character strings on their own sheets) so a lone glyph is never on the same image as a
 *    string that contains it.
 *
 * 3. **Tiles are labelled by index only.** The expected answer never appears as readable text
 *    anywhere in the HTML — not in a caption, not in a comment, not in `title`/`alt`/`aria`/
 *    `data-`. (A lone letter or digit is unavoidably present in SVG coordinates, hex colours, CSS
 *    keywords, and tag names, so the guarantee is "not as a label or human-readable string", not
 *    "not one matching byte anywhere".) The index label alphabet is chosen to be disjoint from the
 *    sheet's own expected glyphs (numeric labels for letter/string sheets, letter labels for digit
 *    sheets), so the label itself can't spell an answer either.
 *
 * 4. Stone rendering and the per-size px/mm table come from specimenPages.mjs (`renderLayoutSvg`,
 *    `RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE`), imported, not copied.
 *
 * 5. The `tileInventory` ([{ index, expectedText }]) is returned alongside the HTML, never
 *    embedded in it — it is the answer key and lives only in the record store.
 */
import { renderLayoutSvg, RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE } from './specimenPages.mjs';
import { resolveCorpus } from './readabilityProbe.mjs';

export const MAX_TILES_PER_SHEET = 24;

function classifyEntry(entry) {
  if ([...entry].length !== 1) return 'string';
  return /[0-9]/.test(entry) ? 'digit' : 'letter';
}

/**
 * Splits corpus entries into sheet-sized groups that each satisfy rule 2. Order within a class is
 * preserved; classes are emitted letters → digits → strings.
 */
export function partitionEntries(entries) {
  const byClass = { letter: [], digit: [], string: [] };
  for (const entry of entries) byClass[classifyEntry(entry)].push(entry);

  const groups = [];
  for (const cls of ['letter', 'digit', 'string']) {
    const list = byClass[cls];
    for (let i = 0; i < list.length; i += MAX_TILES_PER_SHEET) {
      groups.push({ cls, entries: list.slice(i, i + MAX_TILES_PER_SHEET) });
    }
  }
  return groups;
}

// Label alphabet disjoint from the sheet's expected glyphs: a digit sheet gets letter labels, a
// letter or string sheet gets zero-padded numeric labels.
function labelsForClass(cls, count) {
  if (cls === 'digit') {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    return Array.from({ length: count }, (_, i) => {
      if (i < alphabet.length) return alphabet[i];
      const hi = Math.floor(i / alphabet.length) - 1;
      return alphabet[hi] + alphabet[i % alphabet.length];
    });
  }
  return Array.from({ length: count }, (_, i) => String(i + 1).padStart(2, '0'));
}

const PAGE_CSS = `
  html { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: #0f1720; }
  main { padding: 24px; }
  .grid { display: flex; flex-wrap: wrap; gap: 22px; align-items: flex-start; }
  .cell { background: #131c27; border: 1px solid #26313f; border-radius: 6px; padding: 10px 10px 14px; width: 640px; max-width: 640px; overflow: hidden; box-sizing: border-box; }
  .cap { font: 600 13px ui-monospace, Menlo, monospace; color: #9fb0c3; text-align: center; margin: 0 0 8px; letter-spacing: 0.12em; }
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
// text. Comments and alt/aria/data- attributes are rejected outright. Captions are checked against
// every expected answer. A full-HTML substring scan is applied only to entries of length >= 3
// (words and the long stress strings): a 1- or 2-character sequence coincides too readily with an
// SVG coordinate, a hex colour, or a CSS keyword to treat a raw byte match as a leak, and those
// short entries are already covered by the caption + structural checks and by the label alphabet
// being disjoint from the sheet's glyphs.
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
    const labels = labelsForClass(group.cls, group.entries.length);
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
