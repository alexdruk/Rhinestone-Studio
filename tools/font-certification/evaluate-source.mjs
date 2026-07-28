#!/usr/bin/env node
/**
 * FONT-SOURCE-001 per-font evaluation CLI.
 *
 * Usage: node tools/font-certification/evaluate-source.mjs <FontName> [--no-screenshots]
 *
 * <FontName> must match a `name` in font-source-catalog.mjs. Reads fonts/sources/<FontName>/<FontName>.ttf
 * (already downloaded by download-sources.mjs) and writes fonts/review/<FontName>/{report.html,
 * report.json,typography-specimen.png,rhinestone-specimen.png}. Orchestrates existing FONT-CERT-001/002
 * lib functions (see lib/sourceEvaluation.mjs's doc comment) -- no parallel analysis logic.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { repoPath } from './lib/repoPaths.mjs';
import { FONT_SOURCE_CATALOG, sourceTtfRelativePath } from './font-source-catalog.mjs';
import { evaluateSourceFont, loadCandidateFont } from './lib/sourceEvaluation.mjs';
import { buildSourceReportHtml } from './lib/sourceReportHtml.mjs';
import { buildTypographySpecimenHtml } from './lib/specimenPages.mjs';
import { buildSourceRhinestoneSpecimenHtml } from './lib/sourceSpecimenPages.mjs';
import { screenshotPages } from './lib/screenshotPages.mjs';

// The milestone's exact required sample texts, shown in the rhinestone specimen.
const SPECIMEN_SAMPLE_WORDS = ['Ashley', 'Bride Squad', 'Happy Birthday', 'Class of 2027'];

/**
 * @param {object} options
 * @param {string} options.fontName Catalog `name` (e.g. "Anton"), used to resolve the source path and
 *   as the catalog entry unless `candidateRelativePathOverride` is given.
 * @param {string} [options.outputRelativePath] Defaults to fonts/review/<FontName>. Override only for
 *   test isolation -- an absolute path is used as-is, never joined against the repo root.
 * @param {string} [options.candidateRelativePathOverride] FONT-CERT test isolation only: evaluate an
 *   arbitrary TTF (e.g. the repo's existing Elegant-Cursive fixture) under a catalog font's identity,
 *   so the focused test needs no network download.
 * @param {boolean} [options.skipScreenshots]
 */
export async function evaluateSource({ fontName, outputRelativePath, candidateRelativePathOverride, skipScreenshots = false } = {}) {
  const catalogEntry = FONT_SOURCE_CATALOG.find((e) => e.name === fontName);
  if (!catalogEntry) {
    throw new Error(`FONT-SOURCE-001: unknown font name "${fontName}" -- must match a name in font-source-catalog.mjs.`);
  }

  const candidateRelativePath = candidateRelativePathOverride ?? sourceTtfRelativePath(fontName);
  const candidateAbsolutePath = repoPath(candidateRelativePath);
  try {
    await access(candidateAbsolutePath);
  } catch {
    throw new Error(`FONT-SOURCE-001: source font not found at "${candidateRelativePath}" (resolved: ${candidateAbsolutePath}). Run download-sources.mjs first.`);
  }

  const resolvedOutputRelativePath = outputRelativePath ?? path.posix.join('fonts', 'review', fontName);
  const outputDir = path.isAbsolute(resolvedOutputRelativePath) ? resolvedOutputRelativePath : repoPath(resolvedOutputRelativePath);
  await mkdir(outputDir, { recursive: true });

  const evaluation = await evaluateSourceFont({ candidateAbsolutePath, candidateRelativePath, catalogEntry });

  if (evaluation.parseFailed) {
    await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(evaluation, null, 2), 'utf8');
    await writeFile(path.join(outputDir, 'report.html'),
      `<!doctype html><html><body><h1>${catalogEntry.displayName}</h1><p>TTF parsing failed -- see report.json for details.</p></body></html>`, 'utf8');
    return { outputDir, evaluation };
  }

  const { _productionAnalysisByVariantForSpecimen, ...reportJson } = evaluation;

  await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(reportJson, null, 2), 'utf8');

  const reportHtml = buildSourceReportHtml(reportJson);
  await writeFile(path.join(outputDir, 'report.html'), reportHtml, 'utf8');

  if (!skipScreenshots) {
    const { buffer } = await loadCandidateFont(candidateAbsolutePath);
    const typographyHtml = buildTypographySpecimenHtml(buffer, evaluation.fontMetrics);
    const rhinestoneHtml = buildSourceRhinestoneSpecimenHtml(_productionAnalysisByVariantForSpecimen, SPECIMEN_SAMPLE_WORDS);
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

    await rm(path.join(outputDir, '_typography-specimen-source.html'), { force: true });
    await rm(path.join(outputDir, '_rhinestone-specimen-source.html'), { force: true });
  }

  return { outputDir, evaluation: reportJson };
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const skipScreenshots = process.argv.includes('--no-screenshots');

  if (positionalArgs.length !== 1) {
    console.error(
      'FONT-SOURCE-001 evaluation failed: expected exactly one FontName argument.\n' +
      'Usage: node tools/font-certification/evaluate-source.mjs <FontName> [--no-screenshots]'
    );
    process.exitCode = 1;
  } else {
    const [fontName] = positionalArgs;
    console.log(`FONT-SOURCE-001 evaluating: ${fontName}`);
    evaluateSource({ fontName, skipScreenshots })
      .then(({ outputDir, evaluation }) => {
        if (evaluation.parseFailed) {
          console.log(`FONT-SOURCE-001 ${fontName}: TTF PARSE FAILED. Report written to: ${path.join(outputDir, 'report.json')}`);
          return;
        }
        console.log(`FONT-SOURCE-001 ${fontName} complete: ${evaluation.classification.overall} (modification effort: ${evaluation.modificationEffort.level})`);
        console.log(`Report written to: ${path.join(outputDir, 'report.html')}`);
      })
      .catch((error) => {
        console.error(`FONT-SOURCE-001 evaluation failed for ${fontName}:`, error.message);
        process.exitCode = 1;
      });
  }
}
