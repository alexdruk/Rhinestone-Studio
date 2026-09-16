#!/usr/bin/env node
// Maintainable test runner for tools/test-*.mjs.
//
// Usage:
//   node tools/run-tests.mjs                 run the default suite (all tools/test-*.mjs files
//                                             except tools/test-groups.mjs's EXCLUDED_FROM_DEFAULT)
//   node tools/run-tests.mjs <substring>      run every discovered file whose basename contains
//                                             <substring> (case-insensitive, no glob/regex)
//   node tools/run-tests.mjs --group <name>   run exactly tools/test-groups.mjs's GROUPS[<name>]
//   node tools/run-tests.mjs --all            run every tools/test-*.mjs file, ignoring the
//                                             default-suite exclusion list
//   node tools/run-tests.mjs --verbose        stream each test file's stdout/stderr live instead
//                                             of capturing it (combinable with any of the above)
//
// By default, each test file's output is captured rather than streamed: a passing file prints
// nothing beyond its progress line, a failing file prints its full captured output under a
// heading. --verbose restores live streaming.
//
// See docs/specifications/CI-001-RealTestExecution.md for the full design.

import { readdirSync, existsSync, openSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { EXCLUDED_FROM_DEFAULT, GROUPS } from './test-groups.mjs';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEST_FILE_PATTERN = /^test-.*\.mjs$/;

// Matches TEST_FILE_PATTERN by name but is runner infrastructure, not a test file — it exports
// data, has no assertions, and is imported by run-tests.mjs itself.
const NON_TEST_INFRASTRUCTURE = new Set(['test-groups.mjs']);

export function discoverTestFiles(toolsDir = TOOLS_DIR) {
  return readdirSync(toolsDir)
    .filter((name) => TEST_FILE_PATTERN.test(name) && !NON_TEST_INFRASTRUCTURE.has(name))
    .sort();
}

export function parseArgs(argv) {
  const args = argv.slice();
  let group = null;
  let all = false;
  let filter = null;
  let verbose = false;

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--group') {
      if (args.length === 0) {
        throw new Error('--group requires a group name');
      }
      group = args.shift();
    } else if (arg === '--all') {
      all = true;
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      if (filter !== null) {
        throw new Error('Only one filter substring may be given');
      }
      filter = arg;
    }
  }

  const modesSelected = [group !== null, all, filter !== null].filter(Boolean).length;
  if (modesSelected > 1) {
    throw new Error('--group, --all, and a filename filter are mutually exclusive');
  }

  return { group, all, filter, verbose };
}

export function resolveSelection({ group, all, filter }, toolsDir = TOOLS_DIR) {
  if (group !== null) {
    const files = GROUPS[group];
    if (!files) {
      const known = Object.keys(GROUPS).sort().join(', ');
      throw new Error(`Unknown group "${group}". Known groups: ${known}`);
    }
    const missing = files.filter((name) => !existsSync(path.join(toolsDir, name)));
    if (missing.length > 0) {
      throw new Error(`Group "${group}" references missing file(s): ${missing.join(', ')}`);
    }
    return files;
  }

  const discovered = discoverTestFiles(toolsDir);

  if (all) {
    return discovered;
  }

  if (filter !== null) {
    const needle = filter.toLowerCase();
    return discovered.filter((name) => name.toLowerCase().includes(needle));
  }

  const excluded = new Set(EXCLUDED_FROM_DEFAULT);
  return discovered.filter((name) => !excluded.has(name));
}

function runFile(name, toolsDir, verbose) {
  const fullPath = path.join(toolsDir, name);
  const preloadPath = path.join(toolsDir, 'lib/paper-safe-self-preload.mjs');
  const execArgs = ['--import', `file://${preloadPath}`, fullPath];
  const start = Date.now();

  if (verbose) {
    const result = spawnSync(process.execPath, execArgs, { stdio: 'inherit' });
    const elapsedMs = Date.now() - start;
    if (result.error) {
      return { name, passed: false, elapsedMs, spawnError: result.error, output: null };
    }
    return { name, passed: result.status === 0, elapsedMs, spawnError: null, output: null };
  }

  // Redirect stdout and stderr to the same fd (rather than separate 'pipe' buffers) so the
  // captured text preserves the true chronological interleaving of the two streams, and so
  // there is no spawnSync maxBuffer to overflow on a chatty test file.
  const capturePath = path.join(os.tmpdir(), `rhinestone-run-tests-${process.pid}.log`);
  const fd = openSync(capturePath, 'w');
  let result;
  try {
    result = spawnSync(process.execPath, execArgs, { stdio: ['ignore', fd, fd] });
  } finally {
    closeSync(fd);
  }
  const elapsedMs = Date.now() - start;

  let output = '';
  try {
    output = readFileSync(capturePath, 'utf8');
  } catch {
    output = '';
  }
  try {
    unlinkSync(capturePath);
  } catch {
    // best-effort cleanup
  }

  if (result.error) {
    return { name, passed: false, elapsedMs, spawnError: result.error, output };
  }
  return { name, passed: result.status === 0, elapsedMs, spawnError: null, output };
}

function printCapturedOutput(name, output) {
  console.log(`\n--- Output: ${name} ---`);
  if (output) {
    process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
  }
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

export function main(argv, toolsDir = TOOLS_DIR) {
  let selection;
  let verbose = false;
  try {
    const parsed = parseArgs(argv);
    verbose = parsed.verbose;
    selection = resolveSelection(parsed, toolsDir);
  } catch (err) {
    console.error(`run-tests: ${err.message}`);
    return 1;
  }

  if (selection.length === 0) {
    console.error('run-tests: no test files selected');
    return 1;
  }

  const results = [];
  const suiteStart = Date.now();

  for (const name of selection) {
    console.log(`\n▶ ${name}`);
    const result = runFile(name, toolsDir, verbose);
    results.push(result);
    if (result.spawnError) {
      console.error(`✘ ${name} — failed to start: ${result.spawnError.message}`);
      if (!verbose) {
        printCapturedOutput(name, result.output);
      }
    } else {
      const mark = result.passed ? '✔' : '✘';
      console.log(`${mark} ${name} (${formatSeconds(result.elapsedMs)})`);
      if (!verbose && !result.passed) {
        printCapturedOutput(name, result.output);
      }
    }
  }

  const totalElapsedMs = Date.now() - suiteStart;
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  console.log('\n--- Summary ---');
  console.log(`Selected: ${results.length}`);
  console.log(`Passed:   ${passed.length}`);
  console.log(`Failed:   ${failed.length}`);
  console.log(`Elapsed:  ${formatSeconds(totalElapsedMs)}`);
  if (failed.length > 0) {
    console.log('Failed files:');
    for (const r of failed) {
      console.log(`  - ${r.name}`);
    }
  }

  return failed.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
