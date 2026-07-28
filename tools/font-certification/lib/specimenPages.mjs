/**
 * HTML page builders for the two required PNG specimens (FONT-CERT-001).
 *
 * Typography specimen: renders the *actual* candidate TTF via a base64-embedded @font-face rule,
 * so the browser's real font rasterizer draws it -- not a hand-approximated outline.
 *
 * Rhinestone specimen: renders StoneLayouts already produced by the real GeometryEngine pipeline
 * (productionAnalysis.mjs) as inline SVG circles, the same technique tools/rhinestoneFontQaKit.mjs
 * already uses for the repo's other font QA sheets.
 */
import { TYPOGRAPHY_SPECIMEN_LINES, TYPOGRAPHY_AMBIGUITY_GROUPS, TYPOGRAPHY_WORDS, STRESS_STRINGS, CONFUSABLE_PAIRS } from './requiredCharacters.mjs';

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

function stoneCircleSvg(xMm, yMm, sizeMm, pxPerMm) {
  const r = (sizeMm / 2) * pxPerMm;
  return `<circle cx="${(xMm * pxPerMm).toFixed(1)}" cy="${(yMm * pxPerMm).toFixed(1)}" r="${r.toFixed(1)}" fill="#f3bd32" stroke="#5c4200" stroke-width="${(0.12 * pxPerMm).toFixed(1)}"/>`;
}

function renderLayoutSvg(result, pxPerMm) {
  if (result.error || result.stones.length === 0) {
    return `<div class="stone-error">No stones (${result.error ?? 'empty layout'})</div>`;
  }
  const xs = result.stones.map((s) => s.xMm);
  const ys = result.stones.map((s) => s.yMm);
  const padMm = result.stoneSizeMm;
  const minX = Math.min(...xs) - padMm;
  const minY = Math.min(...ys) - padMm;
  const maxX = Math.max(...xs) + padMm;
  const maxY = Math.max(...ys) + padMm;
  const widthPx = (maxX - minX) * pxPerMm;
  const heightPx = (maxY - minY) * pxPerMm;
  const circles = result.stones.map((s) => stoneCircleSvg(s.xMm - minX, s.yMm - minY, s.sizeMm, pxPerMm)).join('');
  return `<svg width="${widthPx.toFixed(0)}" height="${heightPx.toFixed(0)}" viewBox="0 0 ${widthPx.toFixed(0)} ${heightPx.toFixed(0)}">
    <rect width="100%" height="100%" fill="#0f1720"/>
    ${circles}
  </svg>`;
}

/**
 * @param {object} productionAnalysis From productionAnalysis.runProductionAnalysis().
 * @param {string[]} sampleWords Representative words to show across all 5 stone sizes.
 */
export function buildRhinestoneSpecimenHtml(productionAnalysis, sampleWords) {
  const sizeIds = ['ss6', 'ss10', 'ss16', 'ss20', 'ss30'];

  const wordRows = sampleWords.map((word) => {
    const cells = sizeIds.map((sizeId) => {
      const result = productionAnalysis.wordResults.get(word)?.get(sizeId);
      if (!result) return '<td>n/a</td>';
      const pxPerMm = sizeId === 'ss6' ? 8 : sizeId === 'ss10' ? 6 : sizeId === 'ss16' ? 4.5 : sizeId === 'ss20' ? 4 : 3.2;
      return `<td><div class="cell-label">${sizeId.toUpperCase()} &middot; ${result.stoneCount} stones &middot; collisions: ${result.collisionCount}</div>${renderLayoutSvg(result, pxPerMm)}</td>`;
    }).join('');
    return `<tr><th>${escapeHtml(word)}</th>${cells}</tr>`;
  }).join('\n');

  const pairCells = CONFUSABLE_PAIRS.map(([charA, charB]) => {
    const resultA = productionAnalysis.glyphResults.get(charA)?.get('ss16');
    const resultB = productionAnalysis.glyphResults.get(charB)?.get('ss16');
    const finding = productionAnalysis.similarityFindings.find((f) => f.pair[0] === charA && f.pair[1] === charB);
    const flag = finding?.flagged ? ' <span class="flag">SIMILAR</span>' : '';
    return `<div class="pair-card">
      <div class="pair-label">"${escapeHtml(charA)}" vs "${escapeHtml(charB)}" (SS16)${flag}</div>
      <div class="pair-row">
        ${resultA ? renderLayoutSvg(resultA, 6) : ''}
        ${resultB ? renderLayoutSvg(resultB, 6) : ''}
      </div>
      <div class="pair-meta">chamfer distance: ${finding?.chamferDistance?.toFixed(4) ?? 'n/a'}</div>
    </div>`;
  }).join('\n');

  const bodyHtml = `
    <div class="meta">
      Rendered through the real production pipeline: FontManager &rarr; OpenTypeProvider &rarr; GeometryEngine.generateTextLayout() &rarr; StoneLayout.
      Height: ${productionAnalysis.heightMm}mm &middot; Gap: ${productionAnalysis.gapMm}mm.
    </div>
    <h2>Representative words by stone size</h2>
    <table class="word-table">${wordRows}</table>
    <h2>Confusable-pair comparison (SS16)</h2>
    <div class="pair-grid">${pairCells}</div>
  `;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FONT-CERT-001 Rhinestone Specimen</title>
<style>
  ${PAGE_STYLE}
  table.word-table { border-collapse: collapse; }
  table.word-table th, table.word-table td { border:1px solid #d8e0ee; padding: 8px; vertical-align: top; text-align:left; }
  .cell-label { font-size: 11px; color:#4a5568; margin-bottom: 4px; }
  .stone-error { color:#c0202b; font-size: 12px; padding: 8px; }
  .pair-grid { display:flex; flex-wrap:wrap; gap: 16px; }
  .pair-card { border:1px solid #d8e0ee; border-radius:6px; padding:10px; }
  .pair-label { font-size: 12px; font-weight:600; margin-bottom: 6px; }
  .pair-row { display:flex; gap: 10px; }
  .pair-meta { font-size: 11px; color:#4a5568; margin-top: 4px; }
  .flag { color:#c0202b; }
</style>
</head>
<body>
  <h1>FONT-CERT-001 Rhinestone Production Specimen</h1>
  ${bodyHtml}
</body>
</html>`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
