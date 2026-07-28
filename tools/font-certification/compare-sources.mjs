#!/usr/bin/env node
/**
 * FONT-SOURCE-001 comparison CLI.
 *
 * Usage: node tools/font-certification/compare-sources.mjs
 *
 * Reads every fonts/review/<FontName>/report.json already written by evaluate-source.mjs and builds
 * fonts/comparison/{comparison.json,comparison.html}: a metrics-driven leaderboard per category (and,
 * for scripts, per style -- casual/elegant/monoline), plus a "best in category" pick with rationale
 * assembled from the same structured findings claudeDesignFeedback.mjs already turns into prose --
 * mechanical and auditable, matching classification.mjs's own "rule-based, not a weighted score"
 * philosophy, rather than a hand-tuned opinion baked into the script.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { repoPath } from './lib/repoPaths.mjs';
import { FONT_SOURCE_CATALOG } from './font-source-catalog.mjs';

const EFFORT_RANK = { Low: 0, Medium: 1, High: 2 };

function sumCollisions(bySizeResults) {
  let total = 0;
  for (const perSize of Object.values(bySizeResults)) {
    for (const r of Object.values(perSize)) total += r.collisionCount ?? 0;
  }
  return total;
}

async function loadReport(fontName) {
  const reportPath = repoPath('fonts', 'review', fontName, 'report.json');
  try {
    return JSON.parse(await readFile(reportPath, 'utf8'));
  } catch {
    return null;
  }
}

function summarizeFont(catalogEntry, report) {
  if (!report || report.parseFailed) {
    return {
      name: catalogEntry.name,
      displayName: catalogEntry.displayName,
      category: catalogEntry.category,
      styleNote: catalogEntry.styleNote,
      available: false,
      reason: report ? 'TTF failed to parse' : 'no report.json found -- run evaluate-source.mjs for this font'
    };
  }

  const mid = report.heightVariants.mid;
  const midCollisions = sumCollisions(mid.glyphs) + sumCollisions(mid.words);

  return {
    name: catalogEntry.name,
    displayName: catalogEntry.displayName,
    category: catalogEntry.category,
    styleNote: catalogEntry.styleNote,
    variableFont: catalogEntry.variableFont,
    available: true,
    overall: report.classification.overall,
    modificationEffort: report.modificationEffort.level,
    blockingIssueCount: report.classification.blockingIssues.length,
    refinementNoteCount: report.classification.refinementNotes.length,
    midCollisions,
    lowStoneCountCount: mid.readability.lowStoneCountFindings.length,
    counterCollapseCount: mid.readability.counterCollapseFindings.length,
    nearIdenticalCount: mid.readability.nearIdenticalFindings.length,
    rangeSensitivityNoteCount: report.rangeSensitivityNotes.length,
    reportPath: `../review/${catalogEntry.name}/report.html`
  };
}

/** Lower is better. Mirrors classification.mjs's own severity ordering: blocking > refinement > effort > readability detail. */
function rankScore(f) {
  if (!f.available) return Number.POSITIVE_INFINITY;
  return [
    f.blockingIssueCount,
    EFFORT_RANK[f.modificationEffort] ?? 3,
    f.refinementNoteCount,
    f.midCollisions,
    f.lowStoneCountCount + f.counterCollapseCount + f.nearIdenticalCount
  ];
}

function compareRank(a, b) {
  const ra = rankScore(a), rb = rankScore(b);
  if (ra === Infinity || rb === Infinity) return ra - rb;
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] - rb[i];
  }
  return 0;
}

function buildRationale(winner, groupLabel) {
  if (!winner.available) return `No available candidate in ${groupLabel} (see reason on each entry).`;
  const parts = [`${winner.displayName} ranked best among ${groupLabel} candidates`];
  parts.push(`overall classification ${winner.overall}`);
  parts.push(`estimated modification effort ${winner.modificationEffort}`);
  if (winner.blockingIssueCount > 0) parts.push(`${winner.blockingIssueCount} blocking issue(s)`);
  else parts.push('no blocking issues');
  if (winner.midCollisions > 0) parts.push(`${winner.midCollisions} stone collision(s) at mid-range height`);
  else parts.push('no stone collisions at mid-range height');
  if (winner.lowStoneCountCount + winner.counterCollapseCount > 0) {
    parts.push(`${winner.lowStoneCountCount + winner.counterCollapseCount} readability-floor finding(s)`);
  } else {
    parts.push('no readability-floor findings');
  }
  return parts.join(', ') + '.';
}

export async function buildComparison() {
  const summaries = [];
  for (const catalogEntry of FONT_SOURCE_CATALOG) {
    const report = await loadReport(catalogEntry.name);
    summaries.push(summarizeFont(catalogEntry, report));
  }

  const categoryGroups = {
    'casual script': summaries.filter((f) => f.styleNote === 'casual script'),
    'elegant script': summaries.filter((f) => f.styleNote === 'elegant script'),
    'monoline script': summaries.filter((f) => f.styleNote === 'monoline script'),
    rounded: summaries.filter((f) => f.category === 'rounded'),
    heavy: summaries.filter((f) => f.category === 'heavy'),
    'modern sans': summaries.filter((f) => f.category === 'modern-sans')
  };

  const recommendations = {};
  for (const [groupLabel, group] of Object.entries(categoryGroups)) {
    const ranked = [...group].sort(compareRank);
    const winner = ranked[0] ?? null;
    recommendations[groupLabel] = {
      winner: winner?.available ? winner.name : null,
      ranked: ranked.map((f) => f.name),
      rationale: winner ? buildRationale(winner, groupLabel) : `No candidates found for ${groupLabel}.`
    };
  }

  const rejected = summaries.filter((f) => !f.available || f.overall === 'FAIL' || f.blockingIssueCount > 0);

  return {
    generatedAt: new Date().toISOString(),
    fonts: summaries,
    categoryGroups: Object.fromEntries(Object.entries(categoryGroups).map(([k, v]) => [k, v.map((f) => f.name)])),
    recommendations,
    rejected: rejected.map((f) => ({ name: f.name, displayName: f.displayName, available: f.available, overall: f.overall, blockingIssueCount: f.blockingIssueCount, reason: f.reason }))
  };
}

function escapeHtml(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function overallBadgeClass(overall) {
  return { PASS: 'badge-pass', CONDITIONAL_PASS: 'badge-warning', FAIL: 'badge-fail' }[overall] ?? 'badge-nv';
}

function fontRow(f) {
  if (!f.available) {
    return `<tr class="row-unavailable"><td>${escapeHtml(f.displayName)}</td><td colspan="6">${escapeHtml(f.reason)}</td></tr>`;
  }
  return `<tr>
    <td><a href="${escapeHtml(f.reportPath)}">${escapeHtml(f.displayName)}</a></td>
    <td><span class="badge ${overallBadgeClass(f.overall)}">${escapeHtml(f.overall)}</span></td>
    <td>${escapeHtml(f.modificationEffort)}</td>
    <td>${f.blockingIssueCount}</td>
    <td>${f.refinementNoteCount}</td>
    <td>${f.midCollisions}</td>
    <td>${f.lowStoneCountCount + f.counterCollapseCount + f.nearIdenticalCount}</td>
  </tr>`;
}

function buildComparisonHtml(comparison) {
  const groupSections = Object.entries(comparison.categoryGroups).map(([groupLabel, names]) => {
    const fonts = names.map((n) => comparison.fonts.find((f) => f.name === n));
    const rec = comparison.recommendations[groupLabel];
    return `
    <section class="group-section">
      <h2>${escapeHtml(groupLabel[0].toUpperCase() + groupLabel.slice(1))}</h2>
      <p class="recommendation">${rec.winner ? `<strong>Recommended: ${escapeHtml(comparison.fonts.find((f) => f.name === rec.winner)?.displayName ?? rec.winner)}</strong> -- ` : ''}${escapeHtml(rec.rationale)}</p>
      <table>
        <thead><tr><th>Font</th><th>Overall</th><th>Mod. effort</th><th>Blocking</th><th>Refinement</th><th>Collisions (mid)</th><th>Readability findings</th></tr></thead>
        <tbody>${fonts.map(fontRow).join('')}</tbody>
      </table>
    </section>`;
  }).join('\n');

  const rejectedList = comparison.rejected.length > 0
    ? `<ul>${comparison.rejected.map((r) => `<li>${escapeHtml(r.displayName)} -- ${r.available ? `${r.overall}, ${r.blockingIssueCount} blocking issue(s)` : escapeHtml(r.reason)}</li>`).join('')}</ul>`
    : '<p>No candidates rejected.</p>';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>FONT-SOURCE-001 -- Open Font Comparison</title>
<style>
  :root { color-scheme: light; }
  body { background:#fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#0b1f3a; margin:0; padding: 32px 40px 80px; line-height:1.5; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  h2 { font-size: 19px; margin: 36px 0 10px; color:#0b1f3a; border-bottom: 2px solid #0b3d91; padding-bottom: 6px; }
  .meta { color:#4a5568; font-size: 13px; margin-bottom: 20px; }
  .recommendation { font-size: 13.5px; background:#f4f7fc; border:1px solid #d8e0ee; border-radius:8px; padding: 10px 14px; }
  table { border-collapse: collapse; width:100%; margin-bottom: 14px; font-size: 13px; }
  th, td { border:1px solid #d8e0ee; padding: 6px 10px; text-align:left; }
  th { background:#f4f7fc; }
  a { color:#0b3d91; }
  .badge { display:inline-block; padding: 2px 9px; border-radius: 10px; font-size: 11px; font-weight:700; }
  .badge-pass { background:#e3f5e9; color:#0f7a3d; }
  .badge-warning { background:#fff4dd; color:#9a6400; }
  .badge-fail { background:#fde3e3; color:#b0221c; }
  .badge-nv { background:#e8ecf3; color:#4a5568; }
  .row-unavailable { color:#9a6400; background:#fff4dd; }
</style>
</head>
<body>
  <h1>FONT-SOURCE-001 &mdash; Open Font Comparison</h1>
  <div class="meta">Generated ${escapeHtml(comparison.generatedAt)} &middot; ${comparison.fonts.filter((f) => f.available).length}/${comparison.fonts.length} fonts evaluated</div>
  ${groupSections}
  <h2>Rejected candidates</h2>
  ${rejectedList}
</body>
</html>`;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  buildComparison()
    .then(async (comparison) => {
      const outputDir = repoPath('fonts', 'comparison');
      await mkdir(outputDir, { recursive: true });
      await writeFile(path.join(outputDir, 'comparison.json'), JSON.stringify(comparison, null, 2), 'utf8');
      await writeFile(path.join(outputDir, 'comparison.html'), buildComparisonHtml(comparison), 'utf8');
      console.log(`FONT-SOURCE-001 comparison written to ${path.join(outputDir, 'comparison.html')}`);
      for (const [groupLabel, rec] of Object.entries(comparison.recommendations)) {
        console.log(`  ${groupLabel}: ${rec.winner ?? 'none'}`);
      }
    })
    .catch((error) => {
      console.error('compare-sources failed:', error.message);
      process.exitCode = 1;
    });
}
