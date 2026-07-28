/**
 * FONT-SOURCE-001 rhinestone specimen builder -- adapts FONT-CERT-001/002's specimenPages.mjs for
 * this milestone's min/mid/max letter-height variants per stone size (see sourceEvaluation.mjs's
 * HEIGHT_RANGE_MM_BY_SIZE) instead of one fixed height per size. Reuses the exact same stones-to-SVG
 * rendering primitive (renderLayoutSvg) and per-size pixel scale table
 * (RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE) FONT-CERT-001 already uses -- no parallel rendering logic.
 *
 * The typography specimen (real font rasterization, not stone-based) has no height-range concern and
 * is reused unchanged from specimenPages.mjs's buildTypographySpecimenHtml().
 */
import { STONE_SIZE_IDS } from './requiredCharacters.mjs';
import { renderLayoutSvg, escapeHtml, RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE } from './specimenPages.mjs';
import { HEIGHT_VARIANT_IDS } from './sourceEvaluation.mjs';

const PAGE_STYLE = `
  body { background:#fff; font-family: -apple-system, sans-serif; color:#0b1f3a; padding: 28px; margin:0; }
  h1 { font-size: 20px; margin: 0 0 4px; color:#0b1f3a; }
  h2 { font-size: 14px; margin: 26px 0 8px; color:#1c3d6e; border-bottom: 1px solid #d8e0ee; padding-bottom: 4px; }
  h3 { font-size: 12px; margin: 14px 0 6px; color:#334155; }
  .meta { color:#4a5568; font-size: 12px; margin-bottom: 18px; }
  .size-section { margin-bottom: 48px; }
  .variant-block { margin-bottom: 14px; }
  .cell-label { font-size: 11px; color:#4a5568; margin-bottom: 4px; }
  .stone-error { color:#c0202b; font-size: 12px; padding: 8px; }
  .row-note { font-size: 10px; color:#9a6400; margin-top: 2px; }
  .word-column-r { display:flex; flex-direction:column; gap: 14px; }
  .word-card-r { border:1px solid #d8e0ee; border-radius:6px; padding:10px; }
`;

function variantLabel(variantId, heightMm) {
  const names = { min: 'Min height', mid: 'Mid height', max: 'Max height' };
  return `${names[variantId] ?? variantId} &middot; ${heightMm}mm letter height`;
}

/**
 * @param {Record<string, object>} productionAnalysisByVariant { min, mid, max } -> runProductionAnalysis() result.
 * @param {string[]} sampleWords The milestone's exact sample texts (Ashley, Bride Squad, Happy Birthday, Class of 2027).
 */
export function buildSourceRhinestoneSpecimenHtml(productionAnalysisByVariant, sampleWords) {
  const sections = STONE_SIZE_IDS.map((sizeId) => {
    const pxPerMm = RHINESTONE_SPECIMEN_PX_PER_MM_BY_SIZE[sizeId];
    const anyResult = productionAnalysisByVariant.mid.glyphResults.get('o')?.get(sizeId);
    const stoneSizeMm = anyResult?.stoneSizeMm ?? '?';

    const variantBlocks = HEIGHT_VARIANT_IDS.map((variantId) => {
      const productionAnalysis = productionAnalysisByVariant[variantId];
      const heightMm = productionAnalysis.heightMmBySize?.[sizeId] ?? '?';
      const wordCards = sampleWords.map((word) => {
        const result = productionAnalysis.wordResults.get(word)?.get(sizeId);
        if (!result) return '';
        return `<div class="word-card-r">
          <div class="cell-label">"${escapeHtml(word)}" &middot; ${result.stoneCount} stones &middot; collisions: ${result.collisionCount} &middot; min spacing: ${result.minSpacingMm?.toFixed(2) ?? 'n/a'}mm</div>
          ${renderLayoutSvg(result, pxPerMm)}
        </div>`;
      }).join('\n');

      return `
      <div class="variant-block">
        <h3>${variantLabel(variantId, heightMm)}</h3>
        <div class="word-column-r">${wordCards}</div>
      </div>`;
    }).join('\n');

    return `
    <section class="size-section">
      <h2>${sizeId.toUpperCase()} &middot; ${stoneSizeMm}mm stone diameter &middot; ${pxPerMm}px/mm</h2>
      ${variantBlocks}
    </section>`;
  }).join('\n');

  const bodyHtml = `
    <div class="meta">
      Rendered through the real production pipeline: FontManager &rarr; OpenTypeProvider &rarr; GeometryEngine.generateTextLayout() &rarr; StoneLayout.
      Each stone size is shown at the FONT-SOURCE-001 milestone's own min/mid/max physical letter-height range for that size (not a fixed ratio-derived height) --
      see report.json's heightRangeMmBySize for the full table.
    </div>
    ${sections}
  `;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FONT-SOURCE-001 Rhinestone Specimen</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
  <h1>FONT-SOURCE-001 Rhinestone Production Specimen</h1>
  ${bodyHtml}
</body>
</html>`;
}
