# CI-001 — Real CI Test Execution and Maintainable Test Runner

**Status:** IN PROGRESS
**Branch:** `feature/ci-001-real-test-execution` (cut from `develop`, clean at branch time)
**Scope:** CI workflow, `package.json` test scripts, and a new `tools/**` test runner. No `src/**`
file was modified. No existing test's assertions or logic were changed.

---

## Goal

Two problems exist independently of each other:

1. `.github/workflows/ci.yml` never actually runs the test suite — it only checks that a handful of
   files exist. A change that breaks every test in `tools/**` still shows a green check on GitHub.
2. `package.json`'s `test`/`test:core`/`test:integration`/`test:full` scripts are hand-maintained
   `&&` chains, one `node tools/test-*.mjs` clause per file, 58–61 clauses long. Adding a new
   standard test file means editing one or more of these chains by hand, in the right position, in
   every script it should belong to — an easy step to forget, and a diff that is pure noise. The
   chains also stop at the first failure (`&&` short-circuits), so one broken file hides the status
   of every file after it.

This milestone makes GitHub Actions run the actual suite, and replaces the `&&` chains with a small
Node test runner (`tools/run-tests.mjs`) that discovers `tools/test-*.mjs` files automatically, runs
every one of them regardless of earlier failures, and prints one summary with a correct exit code.

---

## Current-state audit (Phase 1)

### CI (`.github/workflows/ci.yml`)

One job, `repository-smoke-test`, on `ubuntu-latest`: checks out the repo and runs six `test -f`/
`test -d` assertions (`README.md`, `.gitignore`, one ADR, `docs/architecture/architecture.md`,
`src/geometry/`, `examples/`). No Node setup, no `npm ci`, no `npm test`, no dependency install of
any kind. A commit that fails every test in `tools/**` still passes CI.

### `package.json` test scripts

All six scripts (`test`, `test:core`, `test:integration`, `test:architecture`, `test:gallery`,
`test:full`) are single-line `&&` chains of `node tools/test-*.mjs` invocations. No `tools/` file is
referenced through a variable, glob, or shared list — every filename is typed out per script.

`tools/` contains 61 files matching `test-*.mjs`, plus four non-test utility files
(`generate-example-baselines.mjs`, `generate-image-trace-baselines.mjs`,
`measure-boolean-precision.mjs`, `measure-performance.mjs`) and a `tools/lib/` directory
(`browserImageBuffer.mjs`, `imageTraceFixtures.mjs`, `rhsProject.mjs`) — none of the non-test files
match the `test-*.mjs` pattern, so a `tools/test-*.mjs` glob naturally excludes all of them without
a special case.

Counting each script's `tools/test-*.mjs` references confirms:

| Script | File count |
|---|---:|
| `test` | 58 |
| `test:core` | 28 |
| `test:integration` | 26 |
| `test:architecture` | 4 |
| `test:gallery` | 3 |
| `test:full` | 61 |

`test:core` (28) + `test:integration` (26) + `test:architecture` (4) = 58 = `test`, so the default
suite is exactly the union of the three named groups, with no overlap between them.

### Files excluded from the default suite

Comparing all 61 `tools/test-*.mjs` files against the 58 referenced by `test` leaves exactly three:

- `tools/test-cup-rotation-stabilization.mjs`
- `tools/test-gallery-benchmark.mjs`
- `tools/test-object-preview-renderer.mjs`

This is not an oversight. `docs/specifications/S-111-TestSuiteRationalization.md` (status
IMPLEMENTED) explicitly moved these three files out of the default suite:

- `test-cup-rotation-stabilization.mjs` and `test-object-preview-renderer.mjs` are real, still-passing
  behavioral suites for `src/renderer/CupRenderer.js`, which `docs/ARCHITECTURE.md` documents as no
  longer wired into the live Object Preview panel (superseded by `src/preview3d/**`, RS-1006). S-111
  kept them runnable under `test:full` rather than deleting them, per the repository's "do not remove
  a module while a test still exercises it" precedent, but removed them from the fast default path
  since they no longer protect reachable behavior.
- `test-gallery-benchmark.mjs` asserts a 5-second-per-fixture timing ceiling, not correctness. S-111's
  own reasoning: "timing assertions do not belong in a suite that must stay fast and deterministic on
  every machine." Its correctness assertions duplicate `test-examples-regression.mjs`; only the timing
  ceiling is unique, and it lives in `test:gallery` instead.

`test:gallery` (`test-gallery.mjs`, `test-gallery-integration.mjs`, `test-gallery-benchmark.mjs`) is
partially redundant with the default suite by design: the first two files already run inside
`test:core`/`test:integration`, so `test:gallery` "also re-runs the two files above, so it is a
complete, self-contained Gallery check" (S-111's own words) — only the benchmark is unique to it.

No file is experimental, destructive, or interactive. No file drives a real browser — per
`docs/ARCHITECTURE.md`'s "Testing Philosophy" section, no suite in this repository (before or after
S-111) launches a browser; interactive verification is manual, per milestone, over headless Chrome,
recorded in `TASK_RESULT.md`. `test:browser` does not exist and this milestone does not add it.

**Conclusion for CI-001:** the new default-discovery exclusion list must reproduce exactly these
three filenames, for exactly these reasons, and no others. This is a continuation of S-111's already-
deliberate scope, not a new judgment call.

### `test` vs. `test:full`

They are genuinely different, not accidentally different: `test` (58 files) is `test:core` +
`test:integration` + `test:architecture`; `test:full` (61 files) is every `tools/test-*.mjs` file
with no exclusions — `test` plus the three files above. `test:full` has distinct, intentional meaning
(S-111: "everything, including test:gallery's benchmark and two legacy CupRenderer.js suites") and is
kept, not removed, by this milestone.

### Minimum supported Node version

No `engines` field in `package.json`, no `.nvmrc`. `docs/ARCHITECTURE.md` and every specification are
silent on a minimum version. The installed local Node is v22.15.0. Nothing in `tools/**` or
`package.json` requires an older runtime. This milestone's task brief directs Node 22 in the absence
of a documented incompatibility, which matches the local environment; CI-001 does not add an
`engines` field (out of scope — no requirement asked for one).

### Lockfile

`package-lock.json` is committed, so `actions/setup-node`'s npm cache and `npm ci` both work as-is.

---

## Runner design

`tools/run-tests.mjs`, Node built-ins only (`node:fs`, `node:path`, `node:child_process`,
`node:url`). No new `package.json` dependency.

Responsibilities:

1. Resolve the set of test files to run (see "Test discovery rules" and "Named groups" below).
2. Run each selected file in its own child process via `child_process.spawnSync` (or the
   `spawn`+await equivalent), using `process.execPath` so the runner always invokes the same Node
   binary it is itself running under, with `stdio: 'inherit'` so each test's own console output
   (including `console.error`) reaches the terminal/CI log unmodified.
3. Time each file (`process.hrtime.bigint()` or `Date.now()` before/after).
4. Continue to the next file regardless of the previous file's exit code — never `throw`/abort the
   loop on a non-zero child exit. A `spawnSync` error (e.g. the file doesn't exist, `ENOENT`) is
   caught and recorded as a failure for that file, not a runner crash.
5. Print a final summary: total selected, passed, failed, total elapsed wall time, and the list of
   failed filenames (empty list line when nothing failed).
6. Exit `0` only if every selected file exited `0` and at least one file was selected; exit non-zero
   otherwise (any failure, or an empty selection).

## Test discovery rules

Default discovery (`node tools/run-tests.mjs`, no arguments):

1. Read `tools/`'s direct entries (`fs.readdirSync`, no recursion — `tools/lib/**` is never scanned).
2. Keep entries matching `/^test-.*\.mjs$/`.
3. Drop `tools/test-groups.mjs` — its name matches the pattern, but it is the group/exclusion
   manifest (data, no assertions), not a test, so it is filtered out unconditionally, before the
   default-suite exclusion list and before `--all`.
4. Sort the kept filenames alphabetically (plain string sort — deterministic and matches `ls`'s
   default order).
5. Remove `run-tests.mjs` — excluded by construction, since it doesn't match the `test-*.mjs` pattern
   in the first place (the runner's own filename does not start with `test-`), but the rule is stated
   explicitly since the task requires it.
6. Remove every filename in the single exclusion list described below.

**Exclusion list** — declared once, in `tools/test-groups.mjs`, as `EXCLUDED_FROM_DEFAULT`, each
entry paired with a one-line reason (transcribed from the audit above):

```js
export const EXCLUDED_FROM_DEFAULT = [
  'test-cup-rotation-stabilization.mjs', // legacy CupRenderer.js suite, superseded by src/preview3d/** (RS-1006); test:full only
  'test-gallery-benchmark.mjs',          // timing-ceiling perf check, not correctness; test:gallery/test:full only
  'test-object-preview-renderer.mjs',    // legacy CupRenderer.js suite, superseded by src/preview3d/** (RS-1006); test:full only
];
```

This is the one place a future engineer edits to change what the *default* suite excludes. No other
file (runner, `package.json`, CI workflow) hardcodes a filename.

`--all` bypasses step 6 (keeps the exclusion-list files in the selection) — this is how `test:full`
is implemented; discovery otherwise stays identical (same directory read, same glob, same sort).

## Named test-group design

`tools/test-groups.mjs` also exports `GROUPS`, an object literal mapping each of the four existing
group names to its explicit filename list, transcribed unchanged from the current `package.json`
chains (28/26/4 files for core/integration/architecture; 3 files for gallery, including the
benchmark):

```js
export const GROUPS = {
  core: [ /* 28 filenames */ ],
  integration: [ /* 26 filenames */ ],
  architecture: [ /* 4 filenames */ ],
  gallery: [ /* 3 filenames, includes test-gallery-benchmark.mjs */ ],
};
```

`node tools/run-tests.mjs --group <name>`:

- Unknown `<name>`: print the list of valid group names, exit non-zero, run nothing.
- Known `<name>` whose manifest lists a file no longer present on disk: print which file is missing,
  exit non-zero, run nothing (fail fast rather than silently skipping a file a group is supposed to
  guarantee).
- Otherwise run exactly that group's files, in the manifest's listed order (not re-sorted — group
  order is already meaningful/reviewed, matching the current `&&` chain order).

`GROUPS` is data (an array of strings per key) — adding a new group, or adding a file to an existing
group, is a manifest edit, never a change to `run-tests.mjs` itself.

## Filtering

`node tools/run-tests.mjs <substring>` (any bare positional argument that isn't `--group`/`--all`/its
value): case-insensitive substring match against each discovered file's **basename**, over the full
61-file discovery (i.e. the exclusion list does not apply to a filter — an explicit filter is the
user asking for a specific file by name, including a normally-excluded one, e.g. `run-tests.mjs
gallery-benchmark`). No glob/regex interpretation — `String.prototype.toLowerCase().includes(...)`
only. Selecting zero files is an error (non-zero exit), same as an empty/unknown group.

`--group` and a filter are mutually exclusive in this milestone (the task only asks for each
independently); passing both is a usage error.

## CI behavior

`.github/workflows/ci.yml` keeps the existing smoke-test step (cheap, catches a missing/renamed
required file before spending time on `npm ci`) and adds a second step sequence: `actions/setup-node`
(Node 22, `cache: npm`), `npm ci`, `npm test`. `npm test` invokes `tools/run-tests.mjs` with no
arguments — the full default 58-file suite, matching the local default exactly. CI does not run
`test:full`/`test:gallery` (both are opt-in, matching their pre-existing "optional" status from
S-111; this milestone does not change that classification).

## Failure handling

- A test file that exits non-zero: recorded as failed, execution continues, filename appears in the
  final summary's failed list, overall exit code is non-zero.
- A test file that throws before calling `process.exit` (uncaught exception): Node itself exits that
  child process non-zero — indistinguishable to the runner from an explicit non-zero exit, handled
  identically.
- A spawn-level error (bad path, permission error): caught, recorded as a failure for that filename,
  execution continues.
- Selecting zero files (bad filter, bad/empty group): non-zero exit, no child processes spawned.

## Backward compatibility

- `npm test`, `npm run test:core`, `npm run test:integration`, `npm run test:architecture`,
  `npm run test:gallery`, `npm run test:full`, and `npm run doctor` all keep their current names and
  keep selecting the same files as before this milestone (58/28/26/4/3/61/58 respectively) — only how
  each script computes that selection changes (an explicit `&&` chain vs. a manifest lookup).
- No test file's assertions, structure, or import graph is touched.
- `test:full`'s distinct meaning (58 default files + the 3 excluded-by-default files) is preserved,
  not collapsed into `test`.

## Resolved: four "package.json lists my filename" checks updated to the new registration contract

Four existing test files each contained one single-check assertion that greped the literal string
`packageJson.scripts.test` (parsed from `package.json`) for that file's own filename:
`test-s107-long-text-readability.mjs` (check 7), `test-s110-design-shapes-consolidation.mjs` (check
16), `test-s110a-smart-shape-to-text-creation.mjs` (check 10), and
`test-s112a-plate-ux-corrections.mjs` (check 16). This was the same "exact-file-count / trivial
package.json-registration assertion" category `docs/specifications/S-111-TestSuiteRationalization.md`
already identified and deliberately chose not to remove from `test-s110`/`test-s110a` ("single-line,
negligible cost, not worth a risky edit to files otherwise fully Keep") — S-111's audit did not catch
all four instances (`test-s107` predates it, `test-s112a` postdates it), but the category and the
disposition were the same.

This milestone's `package.json` rewrite (Phase 4) was the direct, intended cause: the whole point of
CI-001 is that `package.json`'s test scripts no longer enumerate filenames, so a check asserting that
they do became permanently false by design, not by a bug — confirmed not a runner defect, since each
of the four files failed identically run standalone, with or without `tools/run-tests.mjs` involved.

**Follow-up CI-001A** replaced all four checks with an equivalent assertion against the *new*
registration contract, rather than removing or weakening them. The real registration contract, since
CI-001, is `tools/test-groups.mjs` (which named group a file belongs to, and the default-suite
exclusion list) plus `tools/run-tests.mjs`'s own selection logic (`resolveSelection()`, exported and
side-effect-free on import) — not `package.json`'s script text. A shared helper,
`tools/lib/test-registration-assertions.mjs`, exports `assertTestRegistered({ filename, group,
includedInDefault })`, which asserts, against the live manifest and runner (no hardcoded list of its
own):

1. `filename` is listed in `tools/test-groups.mjs`'s `GROUPS[group]`;
2. `filename`'s presence/absence in `EXCLUDED_FROM_DEFAULT` matches `includedInDefault`;
3. `tools/run-tests.mjs`'s actual default selection (`resolveSelection(parseArgs([]))` — what `npm
   test` runs) includes/excludes `filename` accordingly;
4. `tools/run-tests.mjs`'s `--all` selection (what `npm run test:full` runs) includes `filename`.

Each of the four files now calls this helper with its own filename and correct group
(`test-s107-long-text-readability.mjs`, `test-s110a-smart-shape-to-text-creation.mjs`, and
`test-s112a-plate-ux-corrections.mjs` → `integration`; `test-s110-design-shapes-consolidation.mjs`'s
check additionally verifies its three sibling S-110 files — `test-shape-library.mjs`,
`test-shape-fit.mjs`, `test-shape-library-integration.mjs` — against `core`, their actual group,
preserving that check's original "every new S-110 test file is registered" scope). No other
assertion in any of the four files was changed. `npm test` now passes completely: 58 selected, 58
passed, 0 failed.

## Out of scope

- Changing which files are excluded from the default suite (already decided by S-111; this milestone
  only reproduces that decision in a new mechanism).
- Adding a `test:browser` script (deliberately not implemented per S-111 and
  `docs/ARCHITECTURE.md`'s Testing Philosophy — no suite drives a real browser).
- Adding an `engines` field or `.nvmrc`.
- Any change to `src/**`, `app.js`, `index.html`, or any existing test's assertions.
- A GitHub Actions build/lint/typecheck job (none exists today; not requested by this milestone).
- Parallelizing test execution (the current chain runs sequentially; the runner preserves that —
  parallelism would change timing-sensitive output interleaving for no requirement in this task).

## Focused test plan (during implementation)

- `node tools/run-tests.mjs --group core`
- `node tools/run-tests.mjs --group architecture` (fastest group, quick smoke of the runner itself)
- `node tools/run-tests.mjs geometry` (filter — should select `test-geometry-engine.mjs` and any other
  filename containing "geometry")
- A controlled failure-path check using a temporary fixture file (created under `tools/`, matching
  `test-*.mjs`, deliberately exiting non-zero) to prove: execution continues past it, it is named in
  the summary's failed list, and the runner's own exit code is non-zero. The fixture is deleted before
  committing; it is never a permanent addition to `tools/**` or to `test-groups.mjs`.
- `git diff --check` before committing.

## Final verification plan (once, after implementation is complete)

- `npm test` (full default suite) — record total/passed/failed/elapsed from the runner's own summary.
- `npm run test:core`, `npm run test:integration`, `npm run test:architecture`, `npm run test:gallery`
  — each once, to confirm every retained named group still resolves and passes.
- Confirm `.github/workflows/ci.yml`'s `npm test` invocation and `package.json`'s `"test"` script
  agree on the same default command (`node tools/run-tests.mjs`, no arguments).
- `git diff --check`, `git status`.

Per the task's working rules, the complete local suite (`npm test` and each named group) is run once,
at the end of this milestone, not repeatedly during development — focused commands are used while
iterating.
