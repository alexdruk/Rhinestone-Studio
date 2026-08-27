import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Source-hygiene guard. Not a check on application behavior: it asserts that no tracked JavaScript
// source file contains a raw NUL (0x00) byte.
//
// Why this matters: an embedded NUL causes `grep` to classify the file as binary and suppress all
// match output unless `-a` is passed, so ordinary code search silently skips the file. If the NUL
// byte later shifts earlier in the file, `git diff` also starts rendering the whole file as
// "Binary files differ" instead of a readable diff. A NUL that belongs in a string must be written
// as the escape sequence '\x00', which produces a byte-identical runtime value from a plain-text
// source. This regression was introduced once in src/geometry/StoneSampler.js (the
// findCrossGroupCollisions pair-key separator) and fixed on branch fix/stonesampler-nul-byte.

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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

await test('no src/**/*.js file or app.js contains a raw NUL (0x00) byte', () => {
  const files = [
    path.join(REPO_ROOT, 'app.js'),
    ...collectJsFiles(path.join(REPO_ROOT, 'src')),
  ];

  const offenders = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    const index = bytes.indexOf(0x00);
    if (index !== -1) {
      offenders.push(`${path.relative(REPO_ROOT, file)} (first NUL at byte offset ${index})`);
    }
  }

  assert.equal(
    offenders.length,
    0,
    'These files contain a raw NUL (0x00) byte:\n' +
      offenders.map((o) => `  - ${o}`).join('\n') +
      '\n\nAn embedded NUL makes grep classify the file as binary and suppress match output ' +
      '(unless -a is passed), and can make git diff render as "Binary files differ" if the byte ' +
      "later shifts earlier in the file. Write an intentional NUL in a string as the escape " +
      "sequence '\\x00' instead — it yields a byte-identical runtime value from plain-text source.",
  );
});
