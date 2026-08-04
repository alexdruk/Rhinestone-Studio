/**
 * FONT-SOURCE-001 -- per-font evaluation, reusing FONT-CERT-001/002's real, unmodified certification
 * machinery (ttfValidation, typographyFindings, productionAnalysis, readabilityMetrics, classification,
 * claudeDesignFeedback) rather than a parallel analysis pipeline. The only new behavior here is:
 *
 *  1. Running production analysis three times per font -- once each at the min/mid/max letter height of
 *     this milestone's own per-stone-size ranges (see HEIGHT_VARIANTS_BY_SIZE below), instead of
 *     FONT-CERT-001's single ratio-derived height.
 *  2. Merging the result into one report.json (FONT-CERT-001 splits the equivalent data across
 *     certification.json + font-metrics.json + glyph-findings.json).
 *  3. Adding a modificationEffort summary -- a Low/Medium/High estimate plus a short rationale -- for
 *     "estimated amount of modification required for a production-quality rhinestone font", grounded in
 *     the same findings claudeDesignFeedback() already turns into corrective bullets.
 */
import { validateTtf } from './ttfValidation.mjs';
import { loadCandidateFont } from './ttfParser.mjs';
import { computeTypographyFindings } from './typographyFindings.mjs';
import { runProductionAnalysis } from './productionAnalysis.mjs';
import { computeReadabilityFindings } from './readabilityMetrics.mjs';
import { classifyCertification } from './classification.mjs';
import { buildClaudeDesignFeedback } from './claudeDesignFeedback.mjs';

// The milestone's own physical letter-height ranges per stone size (FONT-SOURCE-001 spec), tested at
// min/mid/max -- distinct from FONT-CERT-001's ratio-derived SPECIMEN_HEIGHT_MM_BY_SIZE, which targets
// equalized stone counts across sizes rather than realistic production letter heights.
export const HEIGHT_RANGE_MM_BY_SIZE = {
  ss6: { min: 35, max: 50 },
  ss10: { min: 45, max: 60 },
  ss16: { min: 65, max: 90 },
  ss20: { min: 80, max: 110 },
  ss30: { min: 106, max: 111 }
};

export const HEIGHT_VARIANT_IDS = ['min', 'mid', 'max'];

function heightMmBySizeForVariant(variantId) {
  const out = {};
  for (const [sizeId, range] of Object.entries(HEIGHT_RANGE_MM_BY_SIZE)) {
    out[sizeId] = variantId === 'min' ? range.min : variantId === 'max' ? range.max : (range.min + range.max) / 2;
  }
  return out;
}

function mapToPlainSummary(map) {
  const out = {};
  for (const [key, bySize] of map.entries()) {
    out[key] = {};
    for (const [sizeId, result] of bySize.entries()) {
      const { stones, ...summary } = result;
      out[key][sizeId] = summary;
    }
  }
  return out;
}

/**
 * Buckets modification effort as Low/Medium/High from the same structured findings
 * claudeDesignFeedback() already rephrases into corrective bullets -- counts blocking issues (always
 * High: production-breaking) vs refinement notes (Medium if any exist, else Low).
 */
function estimateModificationEffort({ classification, feedbackBullets }) {
  if (classification.overall === 'FAIL') {
    return {
      level: 'High',
      rationale: `${classification.blockingIssues.length} blocking production issue(s) found (collisions, unusable layouts, or indistinguishable confusable pairs) -- ` +
        `this candidate needs structural rework before it could ship as a rhinestone font, not just refinement.`
    };
  }
  if (classification.overall === 'CONDITIONAL_PASS') {
    return {
      level: 'Medium',
      rationale: `No blocking production failures, but ${classification.refinementNotes.length} refinement note(s) were found (${feedbackBullets.length} actionable item(s) below) -- ` +
        `readability, spacing, or anatomy concerns that would need addressing for production quality.`
    };
  }
  return {
    level: 'Low',
    rationale: 'No blocking issues or refinement notes -- this candidate produces clean, collision-free rhinestone layouts at every tested stone size and height with no readability concerns.'
  };
}

/**
 * Runs the full FONT-SOURCE-001 evaluation for one font.
 *
 * @param {object} options
 * @param {string} options.candidateAbsolutePath Absolute path to the source TTF.
 * @param {string} options.candidateRelativePath Repo-relative path, recorded in the report for
 *   traceability (e.g. "fonts/sources/Anton/Anton.ttf").
 * @param {object} options.catalogEntry The font's FONT_SOURCE_CATALOG entry (name/displayName/category/
 *   styleNote/variableFont), embedded in the report so downstream comparison doesn't need to re-derive it.
 */
export async function evaluateSourceFont({ candidateAbsolutePath, candidateRelativePath, catalogEntry }) {
  const { checks: ttfChecks, fontMetrics, font, glyphAnalyses } = await validateTtf(candidateAbsolutePath);

  if (!font) {
    return {
      catalogEntry,
      candidateRelativePath,
      generatedAt: new Date().toISOString(),
      fontMetrics,
      ttfChecks,
      parseFailed: true
    };
  }

  const typographyFindings = computeTypographyFindings(font, glyphAnalyses);

  const productionByVariant = {};
  const readabilityByVariant = {};
  for (const variantId of HEIGHT_VARIANT_IDS) {
    const heightMmBySize = heightMmBySizeForVariant(variantId);
    const productionAnalysis = await runProductionAnalysis(candidateAbsolutePath, { heightMmBySize });
    productionByVariant[variantId] = productionAnalysis;
    readabilityByVariant[variantId] = computeReadabilityFindings(productionAnalysis);
  }

  // The single overall classification badge and modification-effort narrative are computed at "mid"
  // height (the representative case) -- see this module's doc comment and the milestone plan for why.
  const midProductionAnalysis = productionByVariant.mid;
  const midReadabilityFindings = readabilityByVariant.mid;
  const classification = classifyCertification({
    ttfChecks,
    productionAnalysis: midProductionAnalysis,
    typographyFindings,
    readabilityFindings: midReadabilityFindings
  });
  const claudeDesignFeedback = buildClaudeDesignFeedback({
    fontMetrics, ttfChecks, productionAnalysis: midProductionAnalysis, typographyFindings,
    readabilityFindings: midReadabilityFindings, classification
  });
  const modificationEffort = estimateModificationEffort({ classification, feedbackBullets: claudeDesignFeedback });

  // Flag cases where min or max height meaningfully changes the picture vs. the mid-height verdict
  // (e.g. collisions that only appear at the range's max height) -- per the milestone plan, min/mid/max
  // data is always shown in full, but this narrative note calls out when the extremes disagree with the
  // representative case.
  const rangeSensitivityNotes = [];
  for (const variantId of ['min', 'max']) {
    const variantReadability = readabilityByVariant[variantId];
    const variantCollisionTotal = Array.from(productionByVariant[variantId].glyphResults.values())
      .concat(Array.from(productionByVariant[variantId].wordResults.values()))
      .reduce((sum, bySize) => sum + Array.from(bySize.values()).reduce((s, r) => s + (r.collisionCount ?? 0), 0), 0);
    const midCollisionTotal = Array.from(midProductionAnalysis.glyphResults.values())
      .concat(Array.from(midProductionAnalysis.wordResults.values()))
      .reduce((sum, bySize) => sum + Array.from(bySize.values()).reduce((s, r) => s + (r.collisionCount ?? 0), 0), 0);
    if (variantCollisionTotal > midCollisionTotal) {
      rangeSensitivityNotes.push(`At ${variantId} height, stone collisions increase to ${variantCollisionTotal} (from ${midCollisionTotal} at mid height).`);
    }
    if (variantReadability.lowStoneCountFindings.length > midReadabilityFindings.lowStoneCountFindings.length) {
      rangeSensitivityNotes.push(`At ${variantId} height, ${variantReadability.lowStoneCountFindings.length} glyph/size combinations fall below the minimum meaningful stone count (vs ${midReadabilityFindings.lowStoneCountFindings.length} at mid height).`);
    }
  }

  const heightVariants = {};
  for (const variantId of HEIGHT_VARIANT_IDS) {
    const pa = productionByVariant[variantId];
    heightVariants[variantId] = {
      heightMmBySize: pa.heightMmBySize,
      glyphs: mapToPlainSummary(pa.glyphResults),
      words: mapToPlainSummary(pa.wordResults),
      similarityFindings: pa.similarityFindings,
      readability: readabilityByVariant[variantId]
    };
  }

  return {
    catalogEntry,
    candidateRelativePath,
    generatedAt: new Date().toISOString(),
    fontMetrics,
    ttfChecks,
    typography: typographyFindings,
    heightRangeMmBySize: HEIGHT_RANGE_MM_BY_SIZE,
    heightVariants,
    representativeHeightVariant: 'mid',
    classification,
    claudeDesignFeedback,
    modificationEffort,
    rangeSensitivityNotes,
    parseFailed: false,
    // Kept for the specimen builder, which needs the raw in-memory (stones-included) production
    // analysis at all 3 height variants to render min/mid/max sub-rows -- stripped before this object
    // is serialized to report.json.
    _productionAnalysisByVariantForSpecimen: productionByVariant
  };
}

export { loadCandidateFont };
