#!/usr/bin/env node
/**
 * FONT-CERT-001 certification CLI.
 *
 * Usage: node tools/font-certification/certify.mjs [candidateRelativePath] [outputRelativePath] [--no-screenshots]
 *
 * Orchestrates the three certification parts (TTF validation, typography review, rhinestone
 * production review) through the real, unmodified production pipeline and writes the required
 * report artifacts. See the lib/ modules for each part's implementation; this file only wires them
 * together and writes files -- no analysis logic lives here.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { repoPath } from './lib/repoPaths.mjs';
import { validateTtf } from './lib/ttfValidation.mjs';
import { loadCandidateFont } from './lib/ttfParser.mjs';
import { computeTypographyFindings } from './lib/typographyFindings.mjs';
import { runProductionAnalysis } from './lib/productionAnalysis.mjs';
import { classifyCertification } from './lib/classification.mjs';
import { buildClaudeDesignFeedback } from './lib/claudeDesignFeedback.mjs';
import { buildTypographySpecimenHtml, buildRhinestoneSpecimenHtml } from './lib/specimenPages.mjs';
import { buildReportHtml } from './lib/reportHtml.mjs';
import { screenshotPages } from './lib/screenshotPages.mjs';
import { STONE_SIZE_IDS } from './lib/requiredCharacters.mjs';

export const DEFAULT_CANDIDATE_RELATIVE_PATH = 'fonts/candidates/Elegant-Cursive/ttf/v001/Elegant-Cursive.ttf';
export const DEFAULT_OUTPUT_RELATIVE_PATH = 'tmp/font-certification/Elegant-Cursive/v001';
const RHINESTONE_SPECIMEN_SAMPLE_WORDS = ['Ashley', 'Bride Squad', 'Class of 2027'];

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
 * Runs the full certification and writes every required artifact to outputRelativePath.
 *
 * @param {object} [options]
 * @param {string} [options.candidateRelativePath]
 * @param {string} [options.outputRelativePath]
 * @param {boolean} [options.skipScreenshots] Skip the Playwright PNG-generation step (used by fast
 *   focused tests that only need the deterministic JSON/HTML artifacts).
 * @returns {Promise<{ outputDir: string, classification: object, fontMetrics: object }>}
 */
export async function certify({
  candidateRelativePath = DEFAULT_CANDIDATE_RELATIVE_PATH,
  outputRelativePath = DEFAULT_OUTPUT_RELATIVE_PATH,
  skipScreenshots = false
} = {}) {
  const candidateAbsolutePath = repoPath(candidateRelativePath);
  const outputDir = repoPath(outputRelativePath);

  try {
    await access(candidateAbsolutePath);
  } catch {
    throw new Error(
      `FONT-CERT-001: candidate font not found at expected path "${candidateRelativePath}" ` +
      `(resolved: ${candidateAbsolutePath}). Stopping -- see FONT-CERT-001 spec's Input section.`
    );
  }

  await mkdir(outputDir, { recursive: true });

  const { checks: ttfChecks, fontMetrics, font, glyphAnalyses } = await validateTtf(candidateAbsolutePath);
  if (!font) {
    // Still write what we have so certification.json/report.html explain the parse failure, rather
    // than throwing and leaving no artifact at all.
    const classification = classifyCertification({
      ttfChecks,
      productionAnalysis: { glyphResults: new Map(), wordResults: new Map(), similarityFindings: [], similarityThreshold: 0, heightMm: 0, gapMm: 0 },
      typographyFindings: { weightOutliers: [], baselineAnomalies: [] }
    });
    const generatedAt = new Date().toISOString();
    await writeFile(path.join(outputDir, 'certification.json'), JSON.stringify({ generatedAt, candidate: candidateRelativePath, overall: classification.overall, checkCounts: classification.checkCounts, ttfChecks, blockingIssues: classification.blockingIssues }, null, 2), 'utf8');
    await writeFile(path.join(outputDir, 'font-metrics.json'), JSON.stringify(fontMetrics, null, 2), 'utf8');
    return { outputDir, classification, fontMetrics };
  }

  const typographyFindings = computeTypographyFindings(font, glyphAnalyses);
  const productionAnalysis = await runProductionAnalysis(candidateAbsolutePath);
  const classification = classifyCertification({ ttfChecks, productionAnalysis, typographyFindings });
  const claudeDesignFeedback = buildClaudeDesignFeedback({ fontMetrics, ttfChecks, productionAnalysis, typographyFindings, classification });
  const generatedAt = new Date().toISOString();

  // --- JSON artifacts -------------------------------------------------------------------------
  await writeFile(path.join(outputDir, 'font-metrics.json'), JSON.stringify(fontMetrics, null, 2), 'utf8');

  const glyphFindingsJson = {
    generatedAt,
    productionConfig: { heightMm: productionAnalysis.heightMm, gapMm: productionAnalysis.gapMm, stoneSizeIds: STONE_SIZE_IDS },
    glyphs: mapToPlainSummary(productionAnalysis.glyphResults),
    words: mapToPlainSummary(productionAnalysis.wordResults),
    similarityFindings: productionAnalysis.similarityFindings,
    similarityThreshold: productionAnalysis.similarityThreshold,
    typography: typographyFindings
  };
  await writeFile(path.join(outputDir, 'glyph-findings.json'), JSON.stringify(glyphFindingsJson, null, 2), 'utf8');

  const certificationJson = {
    generatedAt,
    candidate: candidateRelativePath,
    overall: classification.overall,
    checkCounts: classification.checkCounts,
    ttfChecks,
    blockingIssues: classification.blockingIssues,
    refinementNotes: classification.refinementNotes,
    totalCollisions: classification.totalCollisions,
    claudeDesignFeedback
  };
  await writeFile(path.join(outputDir, 'certification.json'), JSON.stringify(certificationJson, null, 2), 'utf8');

  // --- HTML report ------------------------------------------------------------------------------
  const reportHtml = buildReportHtml({
    candidateRelativePath,
    fontMetrics,
    ttfChecks,
    typographyFindings,
    productionAnalysis,
    classification,
    claudeDesignFeedback,
    generatedAt
  });
  await writeFile(path.join(outputDir, 'report.html'), reportHtml, 'utf8');

  // --- Specimen PNGs (Playwright) -----------------------------------------------------------------
  if (!skipScreenshots) {
    const { buffer } = await loadCandidateFont(candidateAbsolutePath);
    const typographyHtml = buildTypographySpecimenHtml(buffer, fontMetrics);
    const rhinestoneHtml = buildRhinestoneSpecimenHtml(productionAnalysis, RHINESTONE_SPECIMEN_SAMPLE_WORDS);
    await writeFile(path.join(outputDir, '_typography-specimen-source.html'), typographyHtml, 'utf8');
    await writeFile(path.join(outputDir, '_rhinestone-specimen-source.html'), rhinestoneHtml, 'utf8');

    await screenshotPages({
      dir: outputDir,
      pages: [
        { htmlFile: '_typography-specimen-source.html', pngFile: path.join(outputDir, 'typography-specimen.png') },
        { htmlFile: '_rhinestone-specimen-source.html', pngFile: path.join(outputDir, 'rhinestone-specimen.png') }
      ],
      profileDir: repoPath('tmp/font-certification/.playwright-profile')
    });
  }

  return { outputDir, classification, fontMetrics, ttfChecks, productionAnalysis, typographyFindings };
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const [candidateArg, outputArg] = positionalArgs;
  const skipScreenshots = process.argv.includes('--no-screenshots');
  certify({
    ...(candidateArg ? { candidateRelativePath: candidateArg } : {}),
    ...(outputArg ? { outputRelativePath: outputArg } : {}),
    skipScreenshots
  })
    .then(({ outputDir, classification }) => {
      console.log(`FONT-CERT-001 certification complete: ${classification.overall}`);
      console.log(`Checks: PASS=${classification.checkCounts.PASS} WARNING=${classification.checkCounts.WARNING} FAIL=${classification.checkCounts.FAIL} NOT_VERIFIED=${classification.checkCounts.NOT_VERIFIED}`);
      console.log(`Report written to: ${path.join(outputDir, 'report.html')}`);
      if (classification.blockingIssues.length > 0) {
        console.log('\nBlocking issues:');
        for (const issue of classification.blockingIssues) console.log(`  - ${issue}`);
      }
    })
    .catch((error) => {
      console.error('FONT-CERT-001 certification failed:', error.message);
      process.exitCode = 1;
    });
}
