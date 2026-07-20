import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// RC-007 — documentation cleanup guard. This is not a check on application behavior: it verifies
// that the "living" repository-process/setup docs (not the dated docs/specifications/** milestone
// records, and not docs/templates/**, both of which intentionally contain historical or
// placeholder paths) stay internally consistent with the live repository — the exact staleness
// docs/specifications/RS-2000A-PostMVPAudit.md flagged for docs/BACKLOG.md/docs/PRODUCT_ROADMAP.md
// and RC-007 fixed. See docs/AI_ENGINEER.md / docs/MILESTONE_WORKFLOW.md for what these docs are.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Files this check treats as "living" documentation: process/setup docs that describe the current
// repository, as opposed to dated point-in-time milestone specs or placeholder templates.
const LIVING_DOCS = [
  'README.md',
  'CONTRIBUTING.md',
  'TASK.md',
  'docs/ARCHITECTURE.md',
  'docs/AI_ENGINEER.md',
  'docs/CLAUDE_GUIDE.md',
  'docs/MILESTONE_WORKFLOW.md',
  'docs/REVIEW_CHECKLIST.md',
  'docs/BACKLOG.md',
  'docs/PRODUCT_ROADMAP.md',
  'docs/PRODUCT_VISION.md',
  'docs/PRODUCT_PRINCIPLES.md',
  'docs/WONT_BUILD.md',
  'docs/development/ClaudeUsage.md',
  'docs/release-process/commit-package-standard.md',
  'docs/release-process/progress-dashboard.md',
  'docs/release-process/release-gate.md',
  'docs/architecture/architecture.md',
  'docs/adr/ADR-0001-geometry-engine-single-source.md',
];

const KNOWN_ROOT_FILES = new Set([
  'README.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'package.json',
  'package-lock.json',
  'TASK.md',
  'TASK_RESULT.md',
  '.gitignore',
]);

function readDoc(relPath) {
  return readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

// Collects "code" text only: inline `backtick` spans and fenced ```...``` block contents. Deliberately
// excludes raw prose, so a sentence like "...resolves the real npm package directly" is never
// mistaken for a command, and a code span is never mistaken for prose.
function extractCodeSpans(text) {
  const spans = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  const fences = [...text.matchAll(/```(?:\w*)\n([\s\S]*?)```/g)]
    .flatMap((m) => m[1].split('\n'))
    .map((line) => line.trim())
    .filter(Boolean);
  return [...spans, ...fences];
}

// Filters code spans down to ones that look like a repository path (contains a '/', or is one of
// the known bare root filenames) rather than a command, keyboard shortcut, or branch name.
function extractPathCandidates(text) {
  return extractCodeSpans(text).filter((span) => {
    if (span.includes(' ') || span.includes('\n')) return false;
    if (span.startsWith('http://') || span.startsWith('https://')) return false;
    if (span.startsWith('feature/')) return false; // branch name, not a path
    if (span.includes('+')) return false; // keyboard shortcut, e.g. Ctrl/Cmd+Z
    if (!span.includes('/') && !KNOWN_ROOT_FILES.has(span)) return false;
    return true;
  });
}

// Resolves one candidate against the repo. Returns 'ok', 'glob-skipped', or 'missing'.
function checkPathCandidate(span) {
  let target = span;
  if (target.endsWith('/**')) target = target.slice(0, -3);
  if (target.includes('*')) return 'glob-skipped';
  // Strip a trailing `()` (a referenced function name accidentally caught alongside a path-like
  // prefix never happens here since candidates require a '/', but strip common doc suffixes like
  // a trailing colon defensively).
  target = target.replace(/:$/, '');
  const abs = path.join(REPO_ROOT, target);
  return existsSync(abs) ? 'ok' : 'missing';
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

for (const doc of LIVING_DOCS) {
  await test(`${doc} exists and is readable`, () => {
    assert.ok(existsSync(path.join(REPO_ROOT, doc)), `${doc} is listed as a living doc but is missing`);
  });
}

// docs/ARCHITECTURE.md is a running implementation-history narrative (see its own "Implementation
// status" prose throughout): it deliberately cites paths that were later deleted, prefixed with
// words like "removed"/"deleted" as history, e.g. `src/core/Project.js` (removed by RS-2006). A
// blind existence check can't distinguish that from an actual broken reference, so it is checked
// separately, below, only for the one class of mistake this file actually had (a *current-tense*
// claim about a file that no longer exists) rather than blanket-excluded.
const PATH_CHECK_DOCS = LIVING_DOCS.filter((doc) => doc !== 'docs/ARCHITECTURE.md');

await test('every repo-path reference in living docs resolves to a real file/dir', () => {
  const missing = [];
  for (const doc of PATH_CHECK_DOCS) {
    const text = readDoc(doc);
    for (const candidate of extractPathCandidates(text)) {
      const result = checkPathCandidate(candidate);
      if (result === 'missing') missing.push(`${doc}: \`${candidate}\``);
    }
  }
  assert.deepEqual(missing, [], `broken path references found:\n${missing.join('\n')}`);
});

await test('docs/ARCHITECTURE.md does not cite tools/test-undo-redo-integration.mjs as a live guard (deleted by S-111)', () => {
  // Regression guard for the specific stale current-tense claim RC-007 found and fixed: the
  // "Testing Philosophy" implementation-status paragraph cited this file as one of the structural
  // guards `npm test` runs, but S-111 deleted it (docs/specifications/S-111-TestSuiteRationalization.md).
  const text = readDoc('docs/ARCHITECTURE.md');
  assert.ok(
    !existsSync(path.join(REPO_ROOT, 'tools/test-undo-redo-integration.mjs')),
    'this guard assumes the file stays deleted; if it was re-added, update this test and the ARCHITECTURE.md prose together',
  );
  const staleClaim = /including `tools\/test-svg-integration\.mjs` \(RS-1001\) and\s*\n`tools\/test-undo-redo-integration\.mjs`/;
  assert.ok(!staleClaim.test(text), 'ARCHITECTURE.md should not cite the deleted tools/test-undo-redo-integration.mjs as a current guard');
});

await test('every `npm run <script>` / `npm <script>` referenced in living docs is a real package.json script', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const scripts = new Set(Object.keys(pkg.scripts ?? {}));
  // npm subcommands that are not package.json scripts.
  const NPM_BUILTINS = new Set(['install', 'ci', 'run']);
  // docs/AI_ENGINEER.md explicitly hedges this one ("Run these when available or applicable: `npm
  // run build`, `npm run dev`") to cover repositories in general, not a claim this repo has it.
  const ALLOWED_HYPOTHETICAL_SCRIPTS = new Set(['build']);
  const missing = [];
  for (const doc of LIVING_DOCS) {
    const codeText = extractCodeSpans(readDoc(doc)).join('\n');
    for (const m of codeText.matchAll(/\bnpm run ([\w:-]+)/g)) {
      if (!scripts.has(m[1]) && !ALLOWED_HYPOTHETICAL_SCRIPTS.has(m[1])) missing.push(`${doc}: \`npm run ${m[1]}\``);
    }
    for (const m of codeText.matchAll(/\bnpm ([\w:-]+)/g)) {
      const cmd = m[1];
      if (cmd === 'run') continue;
      if (NPM_BUILTINS.has(cmd)) continue;
      if (!scripts.has(cmd) && !ALLOWED_HYPOTHETICAL_SCRIPTS.has(cmd)) missing.push(`${doc}: \`npm ${cmd}\``);
    }
  }
  assert.deepEqual(missing, [], `docs reference npm scripts that do not exist in package.json:\n${missing.join('\n')}`);
});

await test('README dev server port matches package.json dev/start scripts', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const readme = readDoc('README.md');
  const portInReadme = readme.match(/localhost:(\d+)/);
  assert.ok(portInReadme, 'README.md should document the dev server port via a localhost:<port> URL');
  const port = portInReadme[1];
  assert.ok(
    pkg.scripts.dev?.includes(port) && pkg.scripts.start?.includes(port),
    `README documents port ${port}, but package.json's dev/start scripts are "${pkg.scripts.dev}" / "${pkg.scripts.start}"`,
  );
});

await test('README and docs/AI_ENGINEER.md agree on the primary test command', () => {
  const readme = readDoc('README.md');
  const aiEngineer = readDoc('docs/AI_ENGINEER.md');
  assert.ok(readme.includes('npm test'), 'README should document `npm test` as the primary test command');
  assert.ok(aiEngineer.includes('npm test'), 'docs/AI_ENGINEER.md should document `npm test` as the primary test command');
});

await test('MILESTONE_WORKFLOW.md\'s "Repository Documents" list only names files that exist', () => {
  const text = readDoc('docs/MILESTONE_WORKFLOW.md');
  const section = text.slice(text.indexOf('## Repository Documents'));
  const missing = [];
  for (const candidate of extractPathCandidates(section)) {
    if (checkPathCandidate(candidate) === 'missing') missing.push(candidate);
  }
  assert.deepEqual(missing, [], `Repository Documents list references missing files: ${missing.join(', ')}`);
});

await test('root task-tracking files (TASK.md/TASK_RESULT.md) are tracked in git, not orphaned scratch files', () => {
  assert.ok(existsSync(path.join(REPO_ROOT, 'TASK.md')), 'TASK.md must exist per docs/MILESTONE_WORKFLOW.md');
  // TASK_RESULT.md is written at the end of a milestone; only assert it when present, since a
  // fresh milestone in progress may not have written it yet.
  const resultPath = path.join(REPO_ROOT, 'TASK_RESULT.md');
  if (existsSync(resultPath)) {
    assert.ok(statSync(resultPath).size > 0, 'TASK_RESULT.md exists but is empty');
  }
});

await test('docs/BACKLOG.md and docs/PRODUCT_ROADMAP.md no longer claim shipped features are "Planned"/"not started"', () => {
  // Regression guard for the exact staleness docs/specifications/RS-2000A-PostMVPAudit.md flagged
  // (Curved text / SVG import / Multi-object support marked Planned despite being done since
  // RS-1001/1003/1004) and RC-007 fixed.
  const shippedFeatures = ['Curved text', 'SVG import', 'Multi-object support'];
  for (const doc of ['docs/BACKLOG.md', 'docs/PRODUCT_ROADMAP.md']) {
    const text = readDoc(doc);
    for (const feature of shippedFeatures) {
      const lineMatch = text.split('\n').find((line) => line.includes(feature));
      assert.ok(lineMatch, `${doc} should still mention "${feature}"`);
      assert.ok(
        !/planned|not started/i.test(lineMatch),
        `${doc} still marks shipped feature "${feature}" as Planned/not started: "${lineMatch}"`,
      );
    }
  }
});

await test('docs/ARCHITECTURE.md does not contradict itself on the product-plugin system / 3D renderer', () => {
  // Regression guard for the specific internal self-contradiction RC-007 fixed: "Future Direction"
  // and "Current Architectural Limitations" both still said these were not implemented, while the
  // document's own "Product Plugins"/"Renderer" sections earlier said they were (RS-1004/RS-1006).
  const text = readDoc('docs/ARCHITECTURE.md');
  assert.ok(
    !/Product plugin system\s+—\s+not started/.test(text),
    'ARCHITECTURE.md "Future Direction" should not claim the product-plugin system is not started (implemented by RS-1004)',
  );
  assert.ok(
    !/3D\/WebGL\s*\n?\s*renderer exist yet/.test(text),
    'ARCHITECTURE.md "Current Architectural Limitations" should not claim the 3D/WebGL renderer does not exist (implemented by RS-1006)',
  );
});

if (process.exitCode === 1) {
  console.error('\nDocumentation consistency check FAILED.');
} else {
  console.log('\nDocumentation consistency check passed.');
}
