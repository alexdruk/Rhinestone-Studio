/**
 * Assembles report.html, the primary FONT-CERT-001 review artifact, from the structured data every
 * other module in this tool already computed. This module does no analysis of its own -- it only
 * formats.
 */
import { STONE_SIZE_IDS } from './requiredCharacters.mjs';
import { MIN_MEANINGFUL_STONE_COUNT, MIN_STONE_COUNT_FOR_COUNTER_BEARING } from './readabilityMetrics.mjs';

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function statusBadge(status) {
  const cls = { PASS: 'badge-pass', WARNING: 'badge-warning', FAIL: 'badge-fail', NOT_VERIFIED: 'badge-nv' }[status] ?? 'badge-nv';
  return `<span class="badge ${cls}">${status.replace('_', ' ')}</span>`;
}

export function overallBadge(overall) {
  const cls = { PASS: 'badge-pass', CONDITIONAL_PASS: 'badge-warning', FAIL: 'badge-fail' }[overall] ?? 'badge-nv';
  const label = { PASS: 'PASS', CONDITIONAL_PASS: 'CONDITIONAL PASS', FAIL: 'FAIL' }[overall] ?? overall;
  return `<span class="badge badge-large ${cls}">${label}</span>`;
}

export function checksTable(checks) {
  const rows = checks.map((c) => `
    <tr>
      <td>${statusBadge(c.status)}</td>
      <td class="check-label">${escapeHtml(c.label)}</td>
      <td class="check-category">${escapeHtml(c.category)}</td>
      <td class="check-detail">${escapeHtml(c.detail)}</td>
    </tr>`).join('');
  return `<table class="checks-table"><thead><tr><th>Status</th><th>Check</th><th>Category</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function glyphFindingsTable(productionAnalysis) {
  const rows = [];
  for (const char of Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')) {
    const bySize = productionAnalysis.glyphResults.get(char);
    if (!bySize) continue;
    const cells = STONE_SIZE_IDS.map((sizeId) => {
      const r = bySize.get(sizeId);
      if (!r || r.error) return '<td class="cell-error">error</td>';
      const flag = r.collisionCount > 0 ? ' class="cell-warning"' : '';
      return `<td${flag}>${r.stoneCount}${r.collisionCount > 0 ? ` (${r.collisionCount} coll.)` : ''}</td>`;
    }).join('');
    rows.push(`<tr><th>"${escapeHtml(char)}"</th>${cells}</tr>`);
  }
  return `<table class="glyph-table">
    <thead><tr><th>Char</th>${STONE_SIZE_IDS.map((s) => `<th>${s.toUpperCase()}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>
  <p class="table-note">Cell values are stone count per glyph at that stone size ("coll." = colliding stone pairs found).</p>`;
}

export function wordFindingsTable(productionAnalysis) {
  const rows = [];
  for (const [word, bySize] of productionAnalysis.wordResults.entries()) {
    const cells = STONE_SIZE_IDS.map((sizeId) => {
      const r = bySize.get(sizeId);
      if (!r || r.error) return '<td class="cell-error">error</td>';
      const flag = r.collisionCount > 0 ? ' class="cell-warning"' : '';
      return `<td${flag}>${r.stoneCount} stones, min spacing ${r.minSpacingMm?.toFixed(2) ?? 'n/a'}mm, ${r.clusterCount} cluster(s)${r.collisionCount > 0 ? `, ${r.collisionCount} collisions` : ''}</td>`;
    }).join('');
    rows.push(`<tr><th>${escapeHtml(word)}</th>${cells}</tr>`);
  }
  return `<table class="word-findings-table">
    <thead><tr><th>Word</th>${STONE_SIZE_IDS.map((s) => `<th>${s.toUpperCase()}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

/**
 * FONT-CERT-002: this narrative used to be a hardcoded sentence naming "Happy Birthday" as the one
 * phrase that "reads as running together" -- true for the candidate that text was written against,
 * but never re-derived, so it kept printing verbatim even after a later candidate's actual measured
 * gap ratio (3.05x the median) put it well above the adequacy threshold. Every word in this narrative
 * must now come from typographyFindings.inadequateWordSpaces / wordSpaceFindings, never a fixed string.
 */
export function wordSpaceNarrative(typographyFindings) {
  const findings = typographyFindings.wordSpaceFindings ?? [];
  const inadequate = typographyFindings.inadequateWordSpaces ?? [];

  if (findings.length === 0) {
    return 'No multi-word phrases were available to measure word-space adequacy against.';
  }

  if (inadequate.length === 0) {
    const tightest = [...findings].sort((a, b) => (a.gapUnits / a.medianIntraWordGapUnits) - (b.gapUnits / b.medianIntraWordGapUnits))[0];
    return `All ${findings.length} tested word-space boundar${findings.length === 1 ? 'y' : 'ies'} measure at least 1.3&times; the median intra-word letter gap ` +
      `(tightest: "${escapeHtml(tightest.word)}" between "${escapeHtml(tightest.leftChar)}" and "${escapeHtml(tightest.rightChar)}" at ${(tightest.gapUnits / tightest.medianIntraWordGapUnits).toFixed(2)}&times;) -- ` +
      'no word-space is flagged as reading like an ordinary letter gap.';
  }

  return `${inadequate.length} of ${findings.length} tested word-space boundar${findings.length === 1 ? 'y' : 'ies'} measure below the 1.3&times; adequacy threshold: ` +
    inadequate.map((f) => `"${escapeHtml(f.word)}" between "${escapeHtml(f.leftChar)}" and "${escapeHtml(f.rightChar)}" (${(f.gapUnits / f.medianIntraWordGapUnits).toFixed(2)}&times; median)`).join(', ') +
    ' -- recommend visually confirming word separation in typography-specimen.png for these specific phrases.';
}

export function readabilityMetricsSection(readabilityFindings) {
  if (!readabilityFindings) return '<p>Not computed.</p>';
  const { lowStoneCountFindings, counterCollapseFindings, nearIdenticalFindings, scaleCompliance } = readabilityFindings;

  const lowStoneRows = lowStoneCountFindings.length === 0
    ? '<p>No glyph/size combination falls below the minimum meaningful stone count.</p>'
    : `<table class="checks-table"><thead><tr><th>Char</th><th>Size</th><th>Stone count</th><th>Threshold</th></tr></thead><tbody>
      ${lowStoneCountFindings.map((f) => `<tr class="row-flagged"><td>"${escapeHtml(f.char)}"</td><td>${f.sizeId.toUpperCase()}</td><td>${f.stoneCount}</td><td>${f.threshold}</td></tr>`).join('')}
      </tbody></table>`;

  const counterRows = counterCollapseFindings.length === 0
    ? '<p>No counter-bearing glyph/size combination falls below the counter-bearing stone-count floor.</p>'
    : `<table class="checks-table"><thead><tr><th>Char</th><th>Size</th><th>Stone count</th><th>Threshold</th></tr></thead><tbody>
      ${counterCollapseFindings.map((f) => `<tr class="row-flagged"><td>"${escapeHtml(f.char)}"</td><td>${f.sizeId.toUpperCase()}</td><td>${f.stoneCount}</td><td>${f.threshold}</td></tr>`).join('')}
      </tbody></table>`;

  const nearIdenticalRows = nearIdenticalFindings.length === 0
    ? '<p>No confusable pair produces a near-identical layout at any stone size.</p>'
    : `<table class="checks-table"><thead><tr><th>Pair</th><th>Size</th><th>Chamfer distance</th><th>Stone counts</th></tr></thead><tbody>
      ${nearIdenticalFindings.map((f) => `<tr class="row-flagged"><td>"${escapeHtml(f.pair[0])}" vs "${escapeHtml(f.pair[1])}"</td><td>${f.sizeId.toUpperCase()}</td><td>${f.chamferDistance.toFixed(4)}</td><td>${f.stoneCountA} / ${f.stoneCountB}</td></tr>`).join('')}
      </tbody></table>`;

  const scaleRows = scaleCompliance.bySize.map((s) => `<tr><td>${s.sizeId.toUpperCase()}</td><td>${s.stoneSizeMm}mm</td><td>${s.pxPerMm}px/mm</td><td>${s.renderedStonePx}px</td><td>${s.compliant ? statusBadge('PASS') : statusBadge('FAIL')}</td></tr>`).join('');

  return `
    <h4>Low stone count (threshold: ${MIN_MEANINGFUL_STONE_COUNT} stones)</h4>
    ${lowStoneRows}
    <h4>Counter-bearing glyphs with too few stones (threshold: ${MIN_STONE_COUNT_FOR_COUNTER_BEARING} stones)</h4>
    ${counterRows}
    <h4>Near-identical confusable-pair layouts (all 5 stone sizes)</h4>
    ${nearIdenticalRows}
    <h4>Specimen render-scale compliance (minimum ${scaleCompliance.minStonePx}px rendered stone diameter)</h4>
    <table class="checks-table"><thead><tr><th>Size</th><th>Diameter</th><th>Scale</th><th>Rendered stone size</th><th>Result</th></tr></thead><tbody>${scaleRows}</tbody></table>
  `;
}

export function similarityTable(productionAnalysis) {
  const rows = productionAnalysis.similarityFindings.map((f) => `
    <tr class="${f.flagged ? 'row-flagged' : ''}">
      <td>"${escapeHtml(f.pair[0])}" vs "${escapeHtml(f.pair[1])}"</td>
      <td>${f.stoneSizeId.toUpperCase()}</td>
      <td>${f.stoneCountA} / ${f.stoneCountB}</td>
      <td>${f.chamferDistance !== null ? f.chamferDistance.toFixed(4) : 'n/a'}</td>
      <td>${f.flagged ? statusBadge('WARNING') : statusBadge('PASS')}</td>
    </tr>`).join('');
  return `<table class="similarity-table">
    <thead><tr><th>Pair</th><th>Size</th><th>Stone counts</th><th>Chamfer distance</th><th>Result</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="table-note">Threshold: ${productionAnalysis.similarityThreshold} (normalized, unit-height point clouds). Below threshold = flagged as visually similar.</p>`;
}

export function fontMetricsTable(fontMetrics) {
  const entries = [
    ['File size', `${(fontMetrics.fileSizeBytes / 1024).toFixed(1)} KB`],
    ['sfnt signature', fontMetrics.sfntVersionTag],
    ['Outline format', fontMetrics.outlinesFormat],
    ['unitsPerEm', fontMetrics.unitsPerEm],
    ['Glyph count', fontMetrics.glyphCount],
    ['cmap entries', fontMetrics.cmapEntryCount],
    ['Tables present', fontMetrics.tableTags.join(', ')],
    ['Family / Subfamily', `${fontMetrics.family} / ${fontMetrics.subfamily}`],
    ['Version', fontMetrics.version],
    ['PostScript name', fontMetrics.postScriptName],
    ['Ascender / Descender', `${fontMetrics.ascender} / ${fontMetrics.descender}`],
    ['Line gap', fontMetrics.lineGap],
    ['sxHeight / sCapHeight', `${fontMetrics.sxHeight} / ${fontMetrics.sCapHeight}`],
    ['Italic angle', fontMetrics.italicAngle],
    ['Fixed pitch', fontMetrics.isFixedPitch ? 'yes' : 'no'],
    ['Curve vs line commands (sample)', `${fontMetrics.curveVsLineCommandSample.curveCommands} curve / ${fontMetrics.curveVsLineCommandSample.lineCommands} line (${fontMetrics.curveVsLineCommandSample.sampledGlyphs} glyphs)`]
  ];
  return `<table class="metrics-table"><tbody>${entries.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</tbody></table>`;
}

export function buildReportHtml({ candidateRelativePath, fontMetrics, ttfChecks, typographyFindings, productionAnalysis, readabilityFindings, classification, claudeDesignFeedback, generatedAt }) {
  const counts = classification.checkCounts;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FONT-CERT-001 -- Elegant Cursive Certification Report</title>
<style>
  :root { color-scheme: light; }
  body { background:#fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#0b1f3a; margin:0; padding: 32px 40px 80px; line-height:1.5; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  h2 { font-size: 19px; margin: 40px 0 12px; color:#0b1f3a; border-bottom: 2px solid #0b3d91; padding-bottom: 6px; }
  h3 { font-size: 15px; margin: 20px 0 8px; color:#1c3d6e; }
  .meta { color:#4a5568; font-size: 13px; }
  .badge { display:inline-block; padding: 2px 9px; border-radius: 10px; font-size: 11px; font-weight:700; letter-spacing:0.02em; }
  .badge-large { font-size: 16px; padding: 6px 18px; border-radius: 14px; }
  .badge-pass { background:#e3f5e9; color:#0f7a3d; }
  .badge-warning { background:#fff4dd; color:#9a6400; }
  .badge-fail { background:#fde3e3; color:#b0221c; }
  .badge-nv { background:#e8ecf3; color:#4a5568; }
  table { border-collapse: collapse; width:100%; margin-bottom: 14px; font-size: 13px; }
  th, td { border:1px solid #d8e0ee; padding: 6px 10px; text-align:left; vertical-align: top; }
  th { background:#f4f7fc; }
  .checks-table .check-detail { font-size: 12.5px; color:#233; }
  .glyph-table th, .glyph-table td, .similarity-table th, .similarity-table td { font-size: 12px; }
  .row-flagged, .cell-warning { background:#fff4dd; }
  .cell-error { background:#fde3e3; }
  .summary-counts { display:flex; gap: 14px; margin: 14px 0 22px; }
  .summary-chip { border:1px solid #d8e0ee; border-radius:8px; padding: 8px 14px; font-size: 13px; }
  .blocking-list, .feedback-list { padding-left: 20px; }
  .blocking-list li, .feedback-list li { margin-bottom: 8px; font-size: 13.5px; }
  .specimen-image { max-width: 100%; border:1px solid #d8e0ee; border-radius: 6px; margin: 10px 0 18px; }
  .feedback-block { background:#f4f7fc; border:1px solid #d8e0ee; border-radius:8px; padding: 18px 20px; margin-top: 12px; }
  .table-note { font-size: 11.5px; color:#4a5568; margin-top: -8px; }
  code { background:#f0f2f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style>
</head>
<body>
  <h1>FONT-CERT-001 &mdash; Elegant Cursive Certification Report</h1>
  <div class="meta">
    Candidate: <code>${escapeHtml(candidateRelativePath)}</code> &middot; Generated ${escapeHtml(generatedAt)}
  </div>

  <h2>1. Executive certification result</h2>
  <p>${overallBadge(classification.overall)}</p>
  <div class="summary-counts">
    <div class="summary-chip">${statusBadge('PASS')} ${counts.PASS}</div>
    <div class="summary-chip">${statusBadge('WARNING')} ${counts.WARNING}</div>
    <div class="summary-chip">${statusBadge('FAIL')} ${counts.FAIL}</div>
    <div class="summary-chip">${statusBadge('NOT_VERIFIED')} ${counts.NOT_VERIFIED}</div>
  </div>
  ${classification.blockingIssues.length > 0 ? `
  <h3>Blocking issues</h3>
  <ul class="blocking-list">${classification.blockingIssues.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
  ` : '<p>No blocking issues found.</p>'}
  ${classification.refinementNotes.length > 0 ? `
  <h3>Refinement notes (non-blocking)</h3>
  <ul class="blocking-list">${classification.refinementNotes.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
  ` : ''}

  <h2>2. TTF validation table</h2>
  ${checksTable(ttfChecks)}

  <h2>3. Typography specimen</h2>
  <p>Rendered from the actual candidate TTF via a base64-embedded <code>@font-face</code> rule (the browser's own font rasterizer), not an approximation.</p>
  <img class="specimen-image" src="typography-specimen.png" alt="Typography specimen">

  <h2>4. Rhinestone specimen by supported stone size</h2>
  <p>Rendered through the real production pipeline: FontManager &rarr; OpenTypeProvider &rarr; GeometryEngine.generateTextLayout() &rarr; StoneLayout.
     Gap ${productionAnalysis.gapMm}mm. Text height scales with stone size (height = ${productionAnalysis.heightToStoneSizeRatio}&times; stone diameter) rather than a single fixed height, so
     every size keeps a comparable stone count per glyph -- see the per-size table below.
     <strong>Successful layout generation (a non-empty StoneLayout with no collisions) is not the same as visual readability</strong>; see section 5's readability metrics for objective, threshold-based findings.</p>
  <table class="metrics-table"><tbody>
    ${STONE_SIZE_IDS.map((id) => `<tr><th>${id.toUpperCase()}</th><td>text height: ${productionAnalysis.heightMmBySize?.[id] ?? 'n/a'}mm</td></tr>`).join('')}
  </tbody></table>
  <p>The specimen below is organized as one clearly labeled section per stone size (SS6, SS10, SS16, SS20, SS30), each with its own representative lowercase letters, all 12 confusable pairs, and representative words/phrases -- not one shared, densely-scaled composite image.</p>
  <img class="specimen-image" src="rhinestone-specimen.png" alt="Rhinestone specimen">
  <h3>Confusable-pair similarity (all 12 pairs, SS16 reference)</h3>
  ${similarityTable(productionAnalysis)}

  <h2>5. Glyph-by-glyph findings</h2>
  <h3>Stone count per glyph, by stone size</h3>
  ${glyphFindingsTable(productionAnalysis)}
  <h3>Readability metrics</h3>
  <p><strong>Successful layout generation (a non-empty StoneLayout with no collisions) is not the same as visual readability.</strong> The checks below are separate, threshold-based readability findings computed from the same production data.</p>
  ${readabilityMetricsSection(readabilityFindings)}
  <h3>Typography measurements</h3>
  <p>x-height measured spread: ${typographyFindings.xHeight.measuredSpreadUnits.toFixed(1)} font units across ${typographyFindings.xHeight.measurements.length} letters (declared OS/2 sxHeight: ${typographyFindings.xHeight.declared}). Cap-height measured spread: ${typographyFindings.capHeight.measuredSpreadUnits.toFixed(1)} font units across ${typographyFindings.capHeight.measurements.length} letters (declared OS/2 sCapHeight: ${typographyFindings.capHeight.declared}).</p>
  ${typographyFindings.weightOutliers.length > 0 ? `<p>Visual-weight outliers (fill-ratio vs a-z median ${typographyFindings.medianFillRatio.toFixed(3)}): ${typographyFindings.weightOutliers.map((o) => `"${escapeHtml(o.char)}" (${o.ratio.toFixed(3)})`).join(', ')}.</p>` : '<p>No visual-weight outliers found across a-z.</p>'}
  ${typographyFindings.baselineAnomalies.length > 0 ? `<p>Baseline anomalies: ${typographyFindings.baselineAnomalies.map((a) => `"${escapeHtml(a.char)}"`).join(', ')}.</p>` : '<p>No baseline anomalies found across a-z.</p>'}
  <h3>Word-space adequacy</h3>
  <p>Median intra-word (letter-to-letter) ink gap: ${typographyFindings.medianIntraWordGapUnits} font units. A word-space is flagged if its own ink-to-ink gap is not at least 1.3&times; that median (i.e. it reads no wider than an ordinary letter gap).</p>
  <table class="word-space-table">
    <thead><tr><th>Word</th><th>Boundary</th><th>Gap (units)</th><th>vs. median</th><th>Result</th></tr></thead>
    <tbody>${(typographyFindings.wordSpaceFindings ?? []).map((f) => `
      <tr class="${f.adequate ? '' : 'row-flagged'}">
        <td>${escapeHtml(f.word)}</td>
        <td>"${escapeHtml(f.leftChar)}" | "${escapeHtml(f.rightChar)}"</td>
        <td>${f.gapUnits}</td>
        <td>${(f.gapUnits / f.medianIntraWordGapUnits).toFixed(2)}&times;</td>
        <td>${f.adequate ? statusBadge('PASS') : statusBadge('WARNING')}</td>
      </tr>`).join('')}</tbody>
  </table>
  <p class="table-note">${wordSpaceNarrative(typographyFindings)}</p>

  <h2>6. Word-level findings</h2>
  ${wordFindingsTable(productionAnalysis)}

  <h2>7. Production metrics</h2>
  ${fontMetricsTable(fontMetrics)}

  <h2>8. Exact blocking issues</h2>
  ${classification.blockingIssues.length > 0
    ? `<ul class="blocking-list">${classification.blockingIssues.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
    : '<p>None.</p>'}

  <h2>9. Recommended Claude Design revision feedback</h2>
  <div class="feedback-block">
    <h3>Feedback for Claude Design</h3>
    <ul class="feedback-list">${claudeDesignFeedback.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
  </div>
</body>
</html>`;
}
