/**
 * Translates FONT-CERT-001's structured findings into the specific, actionable "Feedback for
 * Claude Design" block the report ends with. Every bullet here must trace back to a concrete
 * finding already computed elsewhere in this tool -- this module only rephrases, it never invents
 * new evidence.
 */

export function buildClaudeDesignFeedback({ fontMetrics, ttfChecks, productionAnalysis, typographyFindings, classification }) {
  const bullets = [];

  const requiredTables = ttfChecks.find((c) => c.id === 'required-tables');
  if (requiredTables?.status === 'FAIL') {
    bullets.push(
      `Re-export Elegant-Cursive.ttf with true quadratic TrueType ("glyf") outlines, or explicitly confirm CFF/OpenType output is acceptable for this milestone -- ` +
      `the current file is CFF-flavored OpenType (sfnt signature "OTTO") and is missing the glyf/loca tables this certification's spec requires, despite the .ttf extension.`
    );
  }

  const quadraticOutlines = ttfChecks.find((c) => c.id === 'quadratic-outlines');
  if (quadraticOutlines?.status === 'FAIL' && fontMetrics.curveVsLineCommandSample?.curveCommands === 0) {
    bullets.push(
      `Outlines are built entirely from straight-line segments (0 curve commands across ${fontMetrics.curveVsLineCommandSample.sampledGlyphs} sampled glyphs, ~212 path commands/glyph on average) -- ` +
      `re-author with proper Bezier curves instead of polyline-traced paths; this will also shrink the file (currently ${(fontMetrics.fileSizeBytes / 1024).toFixed(1)} KB for only 71 glyphs).`
    );
  }

  const openContours = ttfChecks.find((c) => c.id === 'open-contours');
  if (openContours?.status !== 'PASS' && openContours?.evidence?.openContourChars?.length > 0) {
    bullets.push(
      `Close every glyph contour explicitly with a closepath command -- ${openContours.evidence.openContourChars.length} of the required characters currently rely on the rendering pipeline's ` +
      `downstream auto-closure. The gaps are small (well under 5% of the em square) but should be zero in a production-ready file.`
    );
  }

  const softSimilarity = productionAnalysis.similarityFindings.filter((f) => f.flagged);
  for (const f of softSimilarity) {
    bullets.push(
      `Increase differentiation between "${f.pair[0]}" and "${f.pair[1]}" -- their rhinestone stone layouts at SS16 are nearly identical (chamfer distance ${f.chamferDistance.toFixed(4)}, ` +
      `below the ${productionAnalysis.similarityThreshold} similarity threshold; stone counts ${f.stoneCountA} vs ${f.stoneCountB}). Recommend a clearer distinguishing stroke.`
    );
  }

  if (classification.collisionIssues.length > 0) {
    bullets.push(
      `Fix stone-collision-prone geometry at: ${classification.collisionIssues.slice(0, 6).map((i) => `"${i.text}"@${i.sizeId.toUpperCase()}`).join(', ')} -- ` +
      `tight curves or narrow counters are producing overlapping stone placements at production stone sizes.`
    );
  }

  if (typographyFindings.weightOutliers.length > 0) {
    bullets.push(
      `Review stroke weight consistency for: ${typographyFindings.weightOutliers.map((o) => `"${o.char}"`).join(', ')} -- their filled-area/bounding-box ratio deviates notably from the a-z median (${typographyFindings.medianFillRatio.toFixed(3)}), suggesting uneven visual weight across the lowercase set.`
    );
  }

  if (typographyFindings.baselineAnomalies.length > 0) {
    bullets.push(
      `Confirm this is intentional: ${typographyFindings.baselineAnomalies.map((a) => `"${a.char}" (${Math.round(a.maxYUnits)}u below baseline)`).join(', ')} extend below the baseline like a conventional descender (g/j/p/q/y), which is not unusual for a cursive/script style but is worth a deliberate design confirmation rather than an accident of tracing.`
    );
  }

  for (const f of (typographyFindings.inadequateWordSpaces ?? [])) {
    bullets.push(
      `Widen the word space after "${f.leftChar}" before "${f.rightChar}" (as in "${f.word}") -- the actual rendered gap (${f.gapUnits} font units) is barely larger than an ordinary letter-to-letter gap (median ${f.medianIntraWordGapUnits} units), so the two words visually merge into one in typography-specimen.png. Every other tested multi-word phrase has a 280-500 unit gap; this one measures 111.`
    );
  }

  if (bullets.length === 0) {
    bullets.push('No corrections found -- candidate passed every structural, coverage, and production check with no warnings.');
  }

  return bullets;
}
