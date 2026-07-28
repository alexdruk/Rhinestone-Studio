/**
 * Overall certification classification for FONT-CERT-001, per the milestone's ACCEPTANCE RULES.
 *
 * Deliberately rule-based and auditable (not a weighted score) so every verdict traces back to
 * specific checks -- the report and this module must never disagree about *why* a result landed
 * where it did.
 */

export const STATUSES = ['PASS', 'WARNING', 'FAIL', 'NOT_VERIFIED'];

function summarizeCheckStatuses(checks) {
  const counts = { PASS: 0, WARNING: 0, FAIL: 0, NOT_VERIFIED: 0 };
  for (const c of checks) counts[c.status] = (counts[c.status] ?? 0) + 1;
  return counts;
}

function collectProductionIssues(productionAnalysis) {
  const collisionIssues = [];
  const unusableLayouts = [];
  let totalCollisions = 0;

  const scan = (map, kind) => {
    for (const [text, bySize] of map.entries()) {
      for (const [sizeId, result] of bySize.entries()) {
        if (result.error) {
          unusableLayouts.push({ kind, text, sizeId, reason: result.error });
          continue;
        }
        if (result.collisionCount > 0) {
          collisionIssues.push({ kind, text, sizeId, collisionCount: result.collisionCount });
          totalCollisions += result.collisionCount;
        }
        if (result.stoneCount === 0 && text.trim().length > 0) {
          unusableLayouts.push({ kind, text, sizeId, reason: 'zero stones generated for non-blank text' });
        }
      }
    }
  };
  scan(productionAnalysis.glyphResults, 'glyph');
  scan(productionAnalysis.wordResults, 'word');

  return { collisionIssues, unusableLayouts, totalCollisions };
}

function collectMaterialMisreads(productionAnalysis) {
  // A "materially misread" pair is stronger than ordinary shape similarity: one side of the pair
  // produced degenerate output (0 or 1 stones) while the other did not, i.e. the conversion itself
  // -- not just visual similarity -- would make the two characters indistinguishable in production.
  return productionAnalysis.similarityFindings.filter((f) => {
    const a = productionAnalysis.glyphResults.get(f.pair[0])?.get(f.stoneSizeId);
    const b = productionAnalysis.glyphResults.get(f.pair[1])?.get(f.stoneSizeId);
    if (!a || !b) return false;
    const degenerate = (r) => r.stoneCount <= 1;
    return f.flagged && (degenerate(a) !== degenerate(b));
  });
}

/**
 * @param {object} options
 * @param {object[]} options.ttfChecks From ttfValidation.validateTtf().checks.
 * @param {object} options.productionAnalysis From productionAnalysis.runProductionAnalysis().
 * @param {object} options.typographyFindings From typographyFindings.computeTypographyFindings().
 * @returns {object}
 */
export function classifyCertification({ ttfChecks, productionAnalysis, typographyFindings }) {
  const checkCounts = summarizeCheckStatuses(ttfChecks);

  const structuralFailChecks = ttfChecks.filter((c) => c.status === 'FAIL' && ['structure', 'coverage'].includes(c.category));
  const geometryFailChecks = ttfChecks.filter((c) => c.status === 'FAIL' && c.category === 'geometry');
  const { collisionIssues, unusableLayouts, totalCollisions } = collectProductionIssues(productionAnalysis);
  const materialMisreads = collectMaterialMisreads(productionAnalysis);

  const blockingIssues = [];
  for (const c of structuralFailChecks) blockingIssues.push(`[TTF structure] ${c.label}: ${c.detail}`);
  for (const c of geometryFailChecks) blockingIssues.push(`[TTF geometry] ${c.label}: ${c.detail}`);
  if (collisionIssues.length > 0) {
    blockingIssues.push(`[Production] ${collisionIssues.length} glyph/word+stone-size combination(s) produced stone collisions (${totalCollisions} total overlapping pairs): ` +
      collisionIssues.slice(0, 10).map((i) => `"${i.text}"@${i.sizeId.toUpperCase()} (${i.collisionCount})`).join(', ') +
      (collisionIssues.length > 10 ? `, +${collisionIssues.length - 10} more` : ''));
  }
  if (unusableLayouts.length > 0) {
    blockingIssues.push(`[Production] ${unusableLayouts.length} combination(s) failed to generate a usable layout: ` +
      unusableLayouts.slice(0, 10).map((i) => `"${i.text}"@${i.sizeId.toUpperCase()} (${i.reason})`).join(', '));
  }
  for (const m of materialMisreads) {
    blockingIssues.push(`[Anatomy] "${m.pair[0]}" vs "${m.pair[1]}" at ${m.stoneSizeId.toUpperCase()}: one side of the pair produced a degenerate (<=1 stone) layout, making them indistinguishable in production, not just visually similar.`);
  }

  const isFail = structuralFailChecks.length > 0 || geometryFailChecks.length > 0 || collisionIssues.length > 0 || unusableLayouts.length > 0 || materialMisreads.length > 0;

  const refinementNotes = [];
  const warningChecks = ttfChecks.filter((c) => c.status === 'WARNING');
  for (const c of warningChecks) refinementNotes.push(`[TTF] ${c.label}: ${c.detail}`);
  const softSimilarity = productionAnalysis.similarityFindings.filter((f) => f.flagged && !materialMisreads.includes(f));
  for (const f of softSimilarity) {
    refinementNotes.push(`[Production similarity] "${f.pair[0]}" vs "${f.pair[1]}" at ${f.stoneSizeId.toUpperCase()}: chamfer distance ${f.chamferDistance?.toFixed(4)} (threshold ${productionAnalysis.similarityThreshold}) -- visually close stone layouts; both produce a valid, differently-sized stone count (${f.stoneCountA} vs ${f.stoneCountB}), verify legibility in rhinestone-specimen.png.`);
  }
  if (typographyFindings.weightOutliers.length > 0) {
    refinementNotes.push(`[Typography] Visual-weight (fill-ratio) outliers vs the a-z median: ${typographyFindings.weightOutliers.map((o) => `"${o.char}"`).join(', ')}.`);
  }
  if (typographyFindings.baselineAnomalies.length > 0) {
    refinementNotes.push(`[Typography] Baseline anomalies: ${typographyFindings.baselineAnomalies.map((a) => `"${a.char}"`).join(', ')} do not match the expected descender/no-descender pattern.`);
  }
  for (const f of (typographyFindings.inadequateWordSpaces ?? [])) {
    refinementNotes.push(`[Typography] Word-space too narrow in "${f.word}" between "${f.leftChar}" and "${f.rightChar}": visual gap ${f.gapUnits}u is barely above the median intra-word letter gap (${f.medianIntraWordGapUnits}u) -- the two words visually run together (confirmed in typography-specimen.png).`);
  }

  const hasAnyWarning = refinementNotes.length > 0;

  let overall;
  if (isFail) overall = 'FAIL';
  else if (hasAnyWarning) overall = 'CONDITIONAL_PASS';
  else overall = 'PASS';

  return {
    overall,
    checkCounts,
    blockingIssues,
    refinementNotes,
    structuralFailChecks,
    geometryFailChecks,
    collisionIssues,
    unusableLayouts,
    materialMisreads,
    totalCollisions
  };
}
