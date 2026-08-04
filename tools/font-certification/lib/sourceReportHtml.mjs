/**
 * FONT-SOURCE-001 report.html builder -- reuses FONT-CERT-001/002's reportHtml.mjs formatting
 * primitives (escapeHtml, badges, checksTable, glyphFindingsTable, wordFindingsTable, similarityTable,
 * fontMetricsTable, readabilityMetricsSection, wordSpaceNarrative) rather than re-deriving table
 * markup. The structural difference from FONT-CERT-001's report is that stone-count/collision/
 * readability data is shown once per height variant (min/mid/max), not once total, and the report adds
 * a "Modification effort" section plus font-category metadata for the FONT-SOURCE-001 comparison.
 */
import { STONE_SIZE_IDS } from './requiredCharacters.mjs';
import {
  escapeHtml, statusBadge, overallBadge, checksTable, glyphFindingsTable, wordFindingsTable,
  similarityTable, fontMetricsTable, readabilityMetricsSection, wordSpaceNarrative
} from './reportHtml.mjs';
import { HEIGHT_VARIANT_IDS } from './sourceEvaluation.mjs';

const VARIANT_TITLES = { min: 'Minimum height', mid: 'Mid-range height', max: 'Maximum height' };

function heightRangeTable(heightRangeMmBySize) {
  const rows = STONE_SIZE_IDS.map((id) => {
    const range = heightRangeMmBySize[id];
    return `<tr><th>${id.toUpperCase()}</th><td>${range.min}mm</td><td>${(range.min + range.max) / 2}mm</td><td>${range.max}mm</td></tr>`;
  }).join('');
  return `<table class="metrics-table"><thead><tr><th>Stone size</th><th>Min</th><th>Mid (representative)</th><th>Max</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function buildSourceReportHtml({
  catalogEntry, candidateRelativePath, fontMetrics, ttfChecks, typography, heightRangeMmBySize,
  heightVariants, classification, claudeDesignFeedback, modificationEffort, rangeSensitivityNotes, generatedAt
}) {
  const counts = classification.checkCounts;

  const variantSections = HEIGHT_VARIANT_IDS.map((variantId) => {
    const v = heightVariants[variantId];
    // Rebuild a minimal productionAnalysis-shaped object (Maps, as glyphFindingsTable/wordFindingsTable/
    // similarityTable expect) from the plain-object report.json data -- no stone arrays needed for these
    // tables (they only read the scalar summary fields already present after mapToPlainSummary()).
    const asProductionAnalysis = {
      glyphResults: new Map(Object.entries(v.glyphs).map(([char, bySize]) => [char, new Map(Object.entries(bySize))])),
      wordResults: new Map(Object.entries(v.words).map(([word, bySize]) => [word, new Map(Object.entries(bySize))])),
      similarityFindings: v.similarityFindings,
      // Matches productionAnalysis.mjs's SIMILARITY_CHAMFER_THRESHOLD (not exported); used here only
      // for similarityTable()'s display text, same duplication pattern readabilityMetrics.mjs already uses.
      similarityThreshold: 0.09,
      heightMmBySize: v.heightMmBySize
    };
    return `
    <h3>${VARIANT_TITLES[variantId]} (${Object.values(v.heightMmBySize).join('/')}mm across SS6&rarr;SS30)</h3>
    <table class="metrics-table"><tbody>
      ${STONE_SIZE_IDS.map((id) => `<tr><th>${id.toUpperCase()}</th><td>text height: ${v.heightMmBySize?.[id] ?? 'n/a'}mm</td></tr>`).join('')}
    </tbody></table>
    <h4>Confusable-pair similarity (SS16 reference)</h4>
    ${similarityTable(asProductionAnalysis)}
    <h4>Stone count per glyph, by stone size</h4>
    ${glyphFindingsTable(asProductionAnalysis)}
    <h4>Word-level findings</h4>
    ${wordFindingsTable(asProductionAnalysis)}
    <h4>Readability metrics</h4>
    ${readabilityMetricsSection(v.readability)}
    `;
  }).join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FONT-SOURCE-001 -- ${escapeHtml(catalogEntry.displayName)} Review</title>
<style>
  :root { color-scheme: light; }
  body { background:#fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#0b1f3a; margin:0; padding: 32px 40px 80px; line-height:1.5; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  h2 { font-size: 19px; margin: 40px 0 12px; color:#0b1f3a; border-bottom: 2px solid #0b3d91; padding-bottom: 6px; }
  h3 { font-size: 15px; margin: 24px 0 8px; color:#1c3d6e; }
  h4 { font-size: 13px; margin: 16px 0 6px; color:#334155; }
  .meta { color:#4a5568; font-size: 13px; }
  .badge { display:inline-block; padding: 2px 9px; border-radius: 10px; font-size: 11px; font-weight:700; letter-spacing:0.02em; }
  .badge-large { font-size: 16px; padding: 6px 18px; border-radius: 14px; }
  .badge-pass { background:#e3f5e9; color:#0f7a3d; }
  .badge-warning { background:#fff4dd; color:#9a6400; }
  .badge-fail { background:#fde3e3; color:#b0221c; }
  .badge-nv { background:#e8ecf3; color:#4a5568; }
  .badge-effort-low { background:#e3f5e9; color:#0f7a3d; }
  .badge-effort-medium { background:#fff4dd; color:#9a6400; }
  .badge-effort-high { background:#fde3e3; color:#b0221c; }
  table { border-collapse: collapse; width:100%; margin-bottom: 14px; font-size: 13px; }
  th, td { border:1px solid #d8e0ee; padding: 6px 10px; text-align:left; vertical-align: top; }
  th { background:#f4f7fc; }
  .glyph-table th, .glyph-table td, .similarity-table th, .similarity-table td { font-size: 12px; }
  .row-flagged, .cell-warning { background:#fff4dd; }
  .cell-error { background:#fde3e3; }
  .summary-counts { display:flex; gap: 14px; margin: 14px 0 22px; }
  .summary-chip { border:1px solid #d8e0ee; border-radius:8px; padding: 8px 14px; font-size: 13px; }
  .blocking-list, .feedback-list { padding-left: 20px; }
  .blocking-list li, .feedback-list li { margin-bottom: 8px; font-size: 13.5px; }
  .specimen-image { max-width: 100%; border:1px solid #d8e0ee; border-radius: 6px; margin: 10px 0 18px; }
  .feedback-block, .effort-block { background:#f4f7fc; border:1px solid #d8e0ee; border-radius:8px; padding: 18px 20px; margin-top: 12px; }
  .table-note { font-size: 11.5px; color:#4a5568; margin-top: -8px; }
  code { background:#f0f2f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style>
</head>
<body>
  <h1>FONT-SOURCE-001 &mdash; ${escapeHtml(catalogEntry.displayName)} Review</h1>
  <div class="meta">
    Source: <code>${escapeHtml(candidateRelativePath)}</code> &middot; Category: ${escapeHtml(catalogEntry.category)} (${escapeHtml(catalogEntry.styleNote)})
    ${catalogEntry.variableFont ? '&middot; Variable font, evaluated at default (Regular/400) instance' : ''}
    &middot; Generated ${escapeHtml(generatedAt)}
  </div>

  <h2>1. Executive result</h2>
  <p>${overallBadge(classification.overall)}</p>
  <div class="summary-counts">
    <div class="summary-chip">${statusBadge('PASS')} ${counts.PASS}</div>
    <div class="summary-chip">${statusBadge('WARNING')} ${counts.WARNING}</div>
    <div class="summary-chip">${statusBadge('FAIL')} ${counts.FAIL}</div>
    <div class="summary-chip">${statusBadge('NOT_VERIFIED')} ${counts.NOT_VERIFIED}</div>
  </div>
  <p>Classification and the feedback below are computed at the <strong>mid-range</strong> letter height for each stone size (the representative case). Full min/mid/max data is shown in section 4.</p>
  ${classification.blockingIssues.length > 0 ? `
  <h3>Blocking issues</h3>
  <ul class="blocking-list">${classification.blockingIssues.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
  ` : '<p>No blocking issues found.</p>'}
  ${classification.refinementNotes.length > 0 ? `
  <h3>Refinement notes (non-blocking)</h3>
  <ul class="blocking-list">${classification.refinementNotes.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
  ` : ''}
  ${rangeSensitivityNotes.length > 0 ? `
  <h3>Height-range sensitivity</h3>
  <ul class="blocking-list">${rangeSensitivityNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
  ` : '<p>Min and max height produce no more collisions or low-stone-count findings than mid height.</p>'}

  <h2>2. Modification effort estimate</h2>
  <div class="effort-block">
    <p><span class="badge badge-large badge-effort-${modificationEffort.level.toLowerCase()}">${escapeHtml(modificationEffort.level)}</span></p>
    <p>${escapeHtml(modificationEffort.rationale)}</p>
  </div>

  <h2>3. TTF validation table</h2>
  ${checksTable(ttfChecks)}

  <h2>4. Specimens</h2>
  <p>Rendered from the actual source TTF via a base64-embedded <code>@font-face</code> rule (typography), and through the real production pipeline FontManager &rarr; OpenTypeProvider &rarr; GeometryEngine.generateTextLayout() &rarr; StoneLayout (rhinestone), at this milestone's own physical letter-height range per stone size:</p>
  ${heightRangeTable(heightRangeMmBySize)}
  <img class="specimen-image" src="typography-specimen.png" alt="Typography specimen">
  <img class="specimen-image" src="rhinestone-specimen.png" alt="Rhinestone specimen">
  <p><strong>Successful layout generation (a non-empty StoneLayout with no collisions) is not the same as visual readability</strong> -- see each height variant's readability metrics below for objective, threshold-based findings.</p>
  ${variantSections}

  <h3>Typography measurements</h3>
  <p>x-height measured spread: ${typography.xHeight.measuredSpreadUnits.toFixed(1)} font units across ${typography.xHeight.measurements.length} letters (declared OS/2 sxHeight: ${typography.xHeight.declared}). Cap-height measured spread: ${typography.capHeight.measuredSpreadUnits.toFixed(1)} font units across ${typography.capHeight.measurements.length} letters (declared OS/2 sCapHeight: ${typography.capHeight.declared}).</p>
  ${typography.weightOutliers.length > 0 ? `<p>Visual-weight outliers (fill-ratio vs a-z median ${typography.medianFillRatio.toFixed(3)}): ${typography.weightOutliers.map((o) => `"${escapeHtml(o.char)}" (${o.ratio.toFixed(3)})`).join(', ')}.</p>` : '<p>No visual-weight outliers found across a-z.</p>'}
  ${typography.baselineAnomalies.length > 0 ? `<p>Baseline anomalies: ${typography.baselineAnomalies.map((a) => `"${escapeHtml(a.char)}"`).join(', ')}.</p>` : '<p>No baseline anomalies found across a-z.</p>'}
  <p class="table-note">${wordSpaceNarrative(typography)}</p>

  <h2>5. Production font metrics</h2>
  ${fontMetricsTable(fontMetrics)}

  <h2>6. Recommended Claude Design revision feedback</h2>
  <div class="feedback-block">
    <ul class="feedback-list">${claudeDesignFeedback.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
  </div>
</body>
</html>`;
}
