/**
 * MAINT-007: Chrome 103 browser baseline guard.
 *
 * Chrome 103.0.5060.134 (macOS Sierra 10.12.6's last available Chrome) is this project's minimum
 * supported browser (see docs/specifications/MAINT-007-BrowserBaseline.md and CLAUDE.md's "Browser
 * baseline (MAINT-007)" section). This test scans every tracked .js file under src/, plus app.js and
 * index.html, for JS/CSS syntax newer than Chrome 103 and fails with file:line on any hit.
 *
 * It deliberately does NOT check for Set methods (.union(), .intersection(), etc.) -- Paper.js's own
 * Rectangle.union() is used legitimately in this codebase and would false-positive on a naive
 * `.union(` scan. It also does not check every possible post-Chrome-103 feature; see the
 * "does not cover" list in docs/specifications/MAINT-007-BrowserBaseline.md.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function jsFilesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await jsFilesUnder(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
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

// Each pattern is paired with a synthetic sample string that MUST match it, so this test cannot
// pass vacuously by scanning nothing or matching nothing.
const PATTERNS = [
  // Import attributes/assertions (Chrome 123+ / a since-removed earlier proposal). MAINT-007
  // itself removed the only real uses of these from this codebase.
  { name: 'import attribute (with { type: ... })', regex: /with\s*\{\s*type\s*:/g, sample: "import data from './x.json' with { type: 'json' };" },
  { name: 'import assertion (assert { type: ... })', regex: /assert\s*\{\s*type\s*:/g, sample: "import data from './x.json' assert { type: 'json' };" },

  // JS features newer than Chrome 103.
  { name: 'Array.prototype.toSorted()', regex: /\.toSorted\(/g, sample: 'arr.toSorted();' },
  { name: 'Array.prototype.toReversed()', regex: /\.toReversed\(/g, sample: 'arr.toReversed();' },
  { name: 'Array.prototype.toSpliced()', regex: /\.toSpliced\(/g, sample: 'arr.toSpliced(0, 1);' },
  { name: 'Object.groupBy()', regex: /Object\.groupBy\(/g, sample: 'Object.groupBy(items, fn);' },
  { name: 'Map.groupBy()', regex: /Map\.groupBy\(/g, sample: 'Map.groupBy(items, fn);' },
  { name: 'Array.fromAsync()', regex: /Array\.fromAsync\(/g, sample: 'Array.fromAsync(iter);' },
  { name: 'Promise.withResolvers()', regex: /Promise\.withResolvers\(/g, sample: 'Promise.withResolvers();' },
  { name: 'URL.canParse()', regex: /URL\.canParse\(/g, sample: 'URL.canParse(str);' },
  { name: 'AbortSignal.any()', regex: /AbortSignal\.any\(/g, sample: 'AbortSignal.any(signals);' },
  { name: 'String.prototype.isWellFormed()', regex: /\.isWellFormed\(/g, sample: 'str.isWellFormed();' },

  // CSS features newer than Chrome 103.
  { name: 'CSS :has()', regex: /:has\(/g, sample: '.card:has(> img) { color: red; }' },
  { name: 'CSS @container', regex: /@container\b/g, sample: '@container (min-width: 400px) { .card { color: red; } }' },
  { name: 'CSS container-type', regex: /container-type\s*:/g, sample: '.el { container-type: inline-size; }' },
  { name: 'CSS color-mix()', regex: /color-mix\(/g, sample: '.el { color: color-mix(in srgb, red, blue); }' },
  { name: 'CSS oklch()', regex: /oklch\(/g, sample: '.el { color: oklch(0.7 0.1 200); }' },
  { name: 'CSS oklab()', regex: /oklab\(/g, sample: '.el { color: oklab(0.7 0.1 0.1); }' },
  { name: 'CSS light-dark()', regex: /light-dark\(/g, sample: '.el { color: light-dark(white, black); }' },
  { name: 'CSS dynamic viewport units', regex: /\b\d+(\.\d+)?(dvh|svh|lvh|dvw|svw|lvw)\b/g, sample: '.el { height: 100dvh; }' },
  { name: 'CSS text-wrap', regex: /text-wrap\s*:/g, sample: 'p { text-wrap: balance; }' },
  { name: 'CSS subgrid', regex: /\bsubgrid\b/g, sample: '.el { grid-template-columns: subgrid; }' },
  { name: 'CSS @scope', regex: /@scope\b/g, sample: '@scope (.card) { :scope { color: red; } }' },
  { name: 'CSS @starting-style', regex: /@starting-style\b/g, sample: '@starting-style { opacity: 0; }' }
];

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function findOffenders(relPath, content) {
  const offenders = [];
  for (const pattern of PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(content))) {
      const line = lineNumberAt(content, match.index);
      offenders.push(`${relPath}:${line}: ${pattern.name} matched "${match[0]}"`);
      if (match[0].length === 0) regex.lastIndex++;
    }
  }
  return offenders;
}

const scannedFiles = [
  ...(await jsFilesUnder(path.join(repoRoot, 'src'))),
  path.join(repoRoot, 'app.js'),
  path.join(repoRoot, 'index.html')
];

await test('every pattern matches its own synthetic positive sample (guards against a vacuous scan)', () => {
  for (const pattern of PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    assert.match(pattern.sample, regex, `pattern "${pattern.name}" must match its own sample: ${pattern.sample}`);
  }
});

await test('the scan covers at least 100 files (guards against a vacuous scan)', () => {
  assert.ok(scannedFiles.length >= 100, `expected at least 100 scanned files, found ${scannedFiles.length}`);
});

await test('no scanned file contains JS/CSS syntax newer than Chrome 103', async () => {
  const allOffenders = [];
  for (const file of scannedFiles) {
    const content = await readFile(file, 'utf8');
    const relPath = path.relative(repoRoot, file);
    allOffenders.push(...findOffenders(relPath, content));
  }
  assert.deepEqual(allOffenders, [], `found Chrome-103-incompatible syntax:\n${allOffenders.join('\n')}`);
});

if (process.exitCode === 1) {
  console.log(`Browser baseline (Chrome 103) guard FAILED -- scanned ${scannedFiles.length} files.`);
} else {
  console.log(`Browser baseline (Chrome 103) guard passed -- scanned ${scannedFiles.length} files.`);
}
