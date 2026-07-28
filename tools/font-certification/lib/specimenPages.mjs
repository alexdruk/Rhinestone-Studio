/**
 * HTML page builders for the two required PNG specimens (FONT-CERT-001).
 *
 * Typography specimen: renders the *actual* candidate TTF via a base64-embedded @font-face rule,
 * so the browser's real font rasterizer draws it -- not a hand-approximated outline.
 *
 * Rhinestone specimen: renders StoneLayouts already produced by the real GeometryEngine pipeline
 * (productionAnalysis.mjs) as inline SVG circles, the same technique tools/rhinestoneFontQaKit.mjs
 * already uses for the repo's other font QA sheets.
 *
 * FONT-CERT-002: the rhinestone specimen was previously one densely-scaled composite image -- every
 * stone size sharing the same fixed 25mm text height and shrinking pxPerMm as sizes grew, so a
 * lowercase letter at SS30 (2 stones) or a whole phrase at SS30 (3.2 px/mm) was not meaningfully
 * inspectable. This rewrite gives each stone size its own clearly labeled section, at a scale chosen
 * so stone circles are never smaller than MIN_STONE_PX regardless of stone size (see
 * RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE below), and never shrinks a row below that scale to force
 * everything into one image -- a row wider than MAX_SINGLE_ROW_WIDTH_PX wraps onto additional rows
 * instead (see wrapStonesIntoRows()). Text height itself is no longer fixed at 25mm either: it is
 * derived per stone size by productionAnalysis.deriveSpecimenHeightMm(), so every size keeps a
 * comparable, meaningful stone count per glyph (see that module's own doc comment for the reasoning).
 */
import { TYPOGRAPHY_SPECIMEN_LINES, TYPOGRAPHY_AMBIGUITY_GROUPS, TYPOGRAPHY_WORDS, STRESS_STRINGS, STONE_SIZE_IDS } from './requiredCharacters.mjs';

const PAGE_STYLE = `
  body { background:#fff; font-family: -apple-system, sans-serif; color:#0b1f3a; padding: 28px; margin:0; }
  h1 { font-size: 20px; margin: 0 0 4px; color:#0b1f3a; }
  h2 { font-size: 14px; margin: 26px 0 8px; color:#1c3d6e; border-bottom: 1px solid #d8e0ee; padding-bottom: 4px; }
  .meta { color:#4a5568; font-size: 12px; margin-bottom: 18px; }
  .line { font-size: 34px; line-height: 1.5; white-space: pre; }
  .ambiguity-line { font-size: 40px; letter-spacing: 0.3em; }
  .word-grid { display:flex; flex-wrap:wrap; gap: 18px; }
  .word-card { border:1px solid #d8e0ee; border-radius:6px; padding:10px 16px; font-size: 30px; }
  .stress-grid { display:flex; flex-wrap:wrap; gap: 14px; }
  .stress-card { border:1px solid #d8e0ee; border-radius:6px; padding:8px 14px; font-size: 26px; }
`;

function pageShell({ title, fontFaceCss, bodyHtml }) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  ${fontFaceCss}
  ${PAGE_STYLE}
  .specimen { font-family: 'FontCertCandidate', sans-serif; }
</style>
</head>
<body>
  <h1>${title}</h1>
  ${bodyHtml}
</body>
</html>`;
}

/**
 * @param {Buffer} fontBuffer Raw candidate TTF bytes.
 * @param {object} fontMetrics From ttfValidation.validateTtf().fontMetrics.
 */
export function buildTypographySpecimenHtml(fontBuffer, fontMetrics) {
  const base64 = fontBuffer.toString('base64');
  const fontFaceCss = `@font-face { font-family: 'FontCertCandidate'; src: url(data:font/ttf;base64,${base64}) format('truetype'); }`;

  const alphabetLines = TYPOGRAPHY_SPECIMEN_LINES
    .map((line) => `<div class="line specimen">${escapeHtml(line)}</div>`).join('\n');

  const ambiguityLines = TYPOGRAPHY_AMBIGUITY_GROUPS
    .map((group) => `<div class="ambiguity-line specimen">${escapeHtml(group.join('  '))}</div>`).join('\n');

  const wordCards = TYPOGRAPHY_WORDS
    .map((word) => `<div class="word-card specimen">${escapeHtml(word)}</div>`).join('\n');

  const stressCards = STRESS_STRINGS
    .map((text) => `<div class="stress-card specimen">${escapeHtml(text)}</div>`).join('\n');

  const bodyHtml = `
    <div class="meta">
      Candidate: ${escapeHtml(fontMetrics.family ?? 'unknown')} ${escapeHtml(fontMetrics.subfamily ?? '')}
      &middot; ${escapeHtml(fontMetrics.version ?? '')}
      &middot; Rendered via the browser's own font rasterizer from the actual TTF bytes (base64 @font-face), not an approximation.
    </div>
    <h2>Alphabet &amp; digits</h2>
    ${alphabetLines}
    <h2>Disambiguation characters</h2>
    ${ambiguityLines}
    <h2>Representative words</h2>
    <div class="word-grid">${wordCards}</div>
    <h2>Stress strings</h2>
    <div class="stress-grid">${stressCards}</div>
  `;

  return pageShell({ title: 'FONT-CERT-001 Typography Specimen', fontFaceCss, bodyHtml });
}

// --- Rhinestone specimen (FONT-CERT-002 redesign) ----------------------------------------------------

// Documented, explicit pixel-per-millimeter scale for each stone size, chosen so every stone renders
// at MIN_STONE_PX or larger on screen regardless of stone diameter -- the opposite of the old
// composite image, which shrank pxPerMm as stone size grew (8 -> 3.2) specifically because it was
// squeezing every size into one shared image. Each of these is comfortably above the bare minimum
// needed for MIN_STONE_PX (see the FONT-CERT-002 final report for the derivation), not just the
// minimum itself, so the specimen is generously readable, not merely technically compliant.
export const MIN_STONE_PX = 8;
export const RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE = { ss6: 5, ss10: 4, ss16: 3.5, ss20: 3, ss30: 2.5 };
// A row wider than this wraps onto additional rows rather than shrinking pxPerMm to fit -- see
// wrapStonesIntoRows(). Matches this tool's own default screenshot viewport width (screenshotPages.mjs).
const MAX_SINGLE_ROW_WIDTH_PX = 1600;

const REPRESENTATIVE_LOWERCASE_LETTERS = ['o', 'a', 'g', 'm']; // varied counters/features: round counter (o), descender+counter (g), stem+counter (m)/(a)
// A curated subset of the 12 confusable pairs shown visually in every size's section -- the full 12
// (including at all 5 sizes) remain in glyph-findings.json and report.html's similarity table; this
// image shows the pairs the milestone's own required specimen list calls out by name (O 0, G C, Q O,
// S 5, B 8, 6 9), keeping the image a manageable size instead of repeating all 12 pairs x 5 sizes.
const SPECIMEN_IMAGE_CONFUSABLE_PAIRS = [['O', '0'], ['G', 'C'], ['Q', 'O'], ['S', '5'], ['B', '8'], ['6', '9']];

function stoneCircleSvg(xMm, yMm, sizeMm, pxPerMm) {
  const r = (sizeMm / 2) * pxPerMm;
  return `<circle cx="${(xMm * pxPerMm).toFixed(1)}" cy="${(yMm * pxPerMm).toFixed(1)}" r="${r.toFixed(1)}" fill="#f3bd32" stroke="#5c4200" stroke-width="${(0.12 * pxPerMm).toFixed(1)}"/>`;
}

/**
 * Splits a stone list into left-to-right row groups, each no wider than maxWidthPx at the given
 * scale, without shrinking pxPerMm. A single-row layout (the common case for this tool's corpus,
 * verified empirically to stay well under MAX_SINGLE_ROW_WIDTH_PX at every documented scale) is
 * returned as one group; a layout that is genuinely too wide is cut into as many left-to-right
 * chunks as needed. This is a purely geometric split (not word-boundary-aware) -- deliberately, since
 * it needs no additional GeometryEngine call and works for both single glyphs and whole phrases.
 */
function wrapStonesIntoRows(stones, pxPerMm, maxWidthPx) {
  if (stones.length === 0) return [];
  const sorted = [...stones].sort((a, b) => a.xMm - b.xMm);
  const maxWidthMm = maxWidthPx / pxPerMm;
  const rows = [];
  let currentRow = [sorted[0]];
  let rowStartXMm = sorted[0].xMm;
  for (let i = 1; i < sorted.length; i++) {
    const stone = sorted[i];
    if ((stone.xMm - rowStartXMm) > maxWidthMm) {
      rows.push(currentRow);
      currentRow = [];
      rowStartXMm = stone.xMm;
    }
    currentRow.push(stone);
  }
  if (currentRow.length > 0) rows.push(currentRow);
  return rows;
}

/**
 * Renders one result's stones as an SVG, wrapping onto multiple rows (see wrapStonesIntoRows()) at a
 * fixed, never-shrunk pxPerMm rather than scaling the whole layout down to fit a target width.
 */
// FONT-SOURCE-001: exported (alongside escapeHtml below) so sourceSpecimenPages.mjs can reuse the exact
// same stones-to-SVG rendering primitive for its min/mid/max height-variant sub-rows, instead of
// re-deriving row-wrapping/circle-scaling logic.
export function renderLayoutSvg(result, pxPerMm) {
  if (result.error || result.stones.length === 0) {
    return `<div class="stone-error">No stones (${result.error ?? 'empty layout'})</div>`;
  }
  const padMm = result.stoneSizeMm;
  const rows = wrapStonesIntoRows(result.stones, pxPerMm, MAX_SINGLE_ROW_WIDTH_PX);

  // Each row is sized to its own actual stone extent (+ padding), not a fixed heightMm-based pitch --
  // a specimen showing "o" (short) next to "Class of 2027" (has descenders/ascenders) should not both
  // reserve the same tall, mostly-empty box. Rows stack using each row's own real height, so the SVG
  // is always exactly as tall as its content, never inflated.
  const rowMetrics = rows.map((row) => {
    const minX = Math.min(...row.map((s) => s.xMm));
    const maxX = Math.max(...row.map((s) => s.xMm));
    const minY = Math.min(...row.map((s) => s.yMm));
    const maxY = Math.max(...row.map((s) => s.yMm));
    return { row, minX, minY, widthMm: maxX - minX + padMm * 2, heightMm: maxY - minY + padMm * 2 };
  });
  const maxRowWidthMm = Math.max(...rowMetrics.map((r) => r.widthMm));
  const rowGapMm = padMm * 3;
  const totalHeightMm = rowMetrics.reduce((sum, r) => sum + r.heightMm, 0) + rowGapMm * (rowMetrics.length - 1);

  const widthPx = maxRowWidthMm * pxPerMm;
  const heightPx = totalHeightMm * pxPerMm;

  let cursorYMm = 0;
  const circles = rowMetrics.flatMap(({ row, minX, minY, heightMm }) => {
    const circlesForRow = row.map((s) => stoneCircleSvg(s.xMm - minX + padMm, s.yMm - minY + padMm + cursorYMm, s.sizeMm, pxPerMm));
    cursorYMm += heightMm + rowGapMm;
    return circlesForRow;
  }).join('');

  return `<svg width="${widthPx.toFixed(0)}" height="${heightPx.toFixed(0)}" viewBox="0 0 ${widthPx.toFixed(0)} ${heightPx.toFixed(0)}">
    <rect width="100%" height="100%" fill="#0f1720"/>
    ${circles}
  </svg>
  ${rows.length > 1 ? `<div class="row-note">wrapped across ${rows.length} rows -- see FONT-CERT-002 spec's "long phrases may use multiple rows" requirement</div>` : ''}`;
}

function stoneSizeSectionLabel(sizeId, productionAnalysis) {
  const anyResult = productionAnalysis.glyphResults.get('o')?.get(sizeId);
  const stoneSizeMm = anyResult?.stoneSizeMm ?? '?';
  const heightMm = productionAnalysis.heightMmBySize?.[sizeId] ?? anyResult?.heightMm ?? '?';
  return `${sizeId.toUpperCase()} &middot; ${stoneSizeMm}mm stone diameter &middot; ${heightMm}mm text height &middot; ${productionAnalysis.gapMm}mm gap &middot; ${RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE[sizeId]}px/mm`;
}

/**
 * @param {object} productionAnalysis From productionAnalysis.runProductionAnalysis().
 * @param {string[]} sampleWords Representative words/phrases to render in every size's section.
 */
export function buildRhinestoneSpecimenHtml(productionAnalysis, sampleWords) {
  const sections = STONE_SIZE_IDS.map((sizeId) => {
    const pxPerMm = RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE[sizeId];

    const letterCards = REPRESENTATIVE_LOWERCASE_LETTERS.map((char) => {
      const result = productionAnalysis.glyphResults.get(char)?.get(sizeId);
      if (!result) return '';
      return `<div class="glyph-card">
        <div class="cell-label">"${escapeHtml(char)}" &middot; ${result.stoneCount} stones</div>
        ${renderLayoutSvg(result, pxPerMm)}
      </div>`;
    }).join('\n');

    const pairCards = SPECIMEN_IMAGE_CONFUSABLE_PAIRS.map(([charA, charB]) => {
      const resultA = productionAnalysis.glyphResults.get(charA)?.get(sizeId);
      const resultB = productionAnalysis.glyphResults.get(charB)?.get(sizeId);
      if (!resultA || !resultB) return '';
      return `<div class="pair-card">
        <div class="pair-label">"${escapeHtml(charA)}" vs "${escapeHtml(charB)}"</div>
        <div class="pair-row">
          ${renderLayoutSvg(resultA, pxPerMm)}
          ${renderLayoutSvg(resultB, pxPerMm)}
        </div>
        <div class="pair-meta">${resultA.stoneCount} vs ${resultB.stoneCount} stones</div>
      </div>`;
    }).join('\n');

    const wordCards = sampleWords.map((word) => {
      const result = productionAnalysis.wordResults.get(word)?.get(sizeId);
      if (!result) return '';
      return `<div class="word-card-r">
        <div class="cell-label">"${escapeHtml(word)}" &middot; ${result.stoneCount} stones &middot; collisions: ${result.collisionCount} &middot; min spacing: ${result.minSpacingMm?.toFixed(2) ?? 'n/a'}mm</div>
        ${renderLayoutSvg(result, pxPerMm)}
      </div>`;
    }).join('\n');

    return `
    <section class="size-section">
      <h2>${stoneSizeSectionLabel(sizeId, productionAnalysis)}</h2>
      <h3>Representative lowercase letters</h3>
      <div class="glyph-grid">${letterCards}</div>
      <h3>Confusable-pair comparison</h3>
      <div class="pair-grid">${pairCards}</div>
      <h3>Words &amp; phrases</h3>
      <div class="word-column-r">${wordCards}</div>
    </section>`;
  }).join('\n');

  const bodyHtml = `
    <div class="meta">
      Rendered through the real production pipeline: FontManager &rarr; OpenTypeProvider &rarr; GeometryEngine.generateTextLayout() &rarr; StoneLayout.
      Gap: ${productionAnalysis.gapMm}mm. Text height scales with stone size (height = ${productionAnalysis.heightToStoneSizeRatio}&times; stone diameter) so every size keeps a comparable stone count per glyph --
      see FONT-CERT-002's final report for the full per-size height table and rationale.
      <strong>Successful layout generation (a non-empty StoneLayout with no collisions) is not the same as visual readability</strong> --
      see the Readability metrics table in report.html for objective, threshold-based readability findings alongside this specimen.
    </div>
    ${sections}
  `;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FONT-CERT-001 Rhinestone Specimen</title>
<style>
  ${PAGE_STYLE}
  .size-section { margin-bottom: 48px; }
  .cell-label { font-size: 11px; color:#4a5568; margin-bottom: 4px; }
  .stone-error { color:#c0202b; font-size: 12px; padding: 8px; }
  .row-note { font-size: 10px; color:#9a6400; margin-top: 2px; }
  .glyph-grid, .pair-grid { display:flex; flex-wrap:wrap; gap: 16px; margin-bottom: 8px; }
  .glyph-card, .pair-card { border:1px solid #d8e0ee; border-radius:6px; padding:10px; }
  .pair-label { font-size: 12px; font-weight:600; margin-bottom: 6px; }
  .pair-row { display:flex; gap: 10px; }
  .pair-meta { font-size: 11px; color:#4a5568; margin-top: 4px; }
  .word-column-r { display:flex; flex-direction:column; gap: 14px; }
  .word-card-r { border:1px solid #d8e0ee; border-radius:6px; padding:10px; }
</style>
</head>
<body>
  <h1>FONT-CERT-001 Rhinestone Production Specimen</h1>
  ${bodyHtml}
</body>
</html>`;
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
