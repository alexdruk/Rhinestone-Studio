# MAINT-005 — Release Hygiene Audit (v1.1.0)

**Status:** audit only. No source files edited, no `.gitignore` rule changed, nothing deleted.
Branch `feature/maint-005-release-hygiene` off `develop` (local only, not pushed).

Measurement cross-check: 610 tracked files, `docs/` 16M, `docs/data/read-005` 7.2M,
`docs/screenshots` 6.2M, 17 tracked `.png`, 30 `.py`, 27 `.rhs`, 30 `.ttf` — all confirmed
identical to the figures supplied for this audit. No disagreement to report.

---

## Section A — Deletion Candidates

### Class 1 — `docs/screenshots/**` (per-milestone verification images)

Evidence gathered per milestone subdirectory. "Inbound refs" below is `grep -rn "<dirname>" .
--exclude-dir=.git --exclude-dir=node_modules`, filtered to lines outside the directory itself;
a second, narrower check for the literal path `docs/screenshots/<dir>` is called out separately
since the bare milestone name (e.g. `mono-012`) also matches test-file names and prose that have
nothing to do with the images.

**PATH:** `docs/screenshots/mono-012/`
**SIZE:** 1.2M
**LAST TOUCHED:** `63472d6 2026-09-07 MONO-012: single-chain OpenType script fonts in the Monogram tool`
**INBOUND REFS:** `grep -rn "mono-012" .` returns 12 lines, all in `tools/test-mono-*.mjs` comments/test-group registration or `docs/specifications/MONO-*.md` prose about the *milestone*, not the image path. `grep -rn "docs/screenshots/mono-012" .` → NO INBOUND REFERENCES. No generator script targets this directory (`tools/mono-013-screenshots.mjs` and `tools/mono-014-screenshots.mjs` exist; no `mono-012` counterpart).
**VERDICT: DELETE.** Nothing reads these images by path and nothing can regenerate them; they are orphaned manual-capture evidence with no citation anywhere in the docs.

**PATH:** `docs/screenshots/mono-013/`
**SIZE:** 728K
**LAST TOUCHED:** `75dcbf8 2026-09-08 MONO-013: interlocked script monograms - one mark, not three boxes`
**INBOUND REFS:** `grep -rn "mono-013" .` returns 13 lines (test files, `test-groups.mjs`, `docs/BACKLOG.md`'s playwright-dependency item, `MONO-013-Interlock.md` prose). `grep -rn "docs/screenshots/mono-013" .` → NO INBOUND REFERENCES. However `tools/mono-013-screenshots.mjs:10` writes to this exact path (`const OUT = 'docs/screenshots/mono-013'`), so the directory is this script's live output target.
**VERDICT: UNDECIDED.** No doc cites the images by path, but the generator that produces them is itself a kept file (see Class 3) — deleting the directory just means the next run of that script recreates it. Low cost either way; a judgment call on whether stale QA renders should sit in the tree between runs.

**PATH:** `docs/screenshots/mono-014/`
**SIZE:** 1.2M
**LAST TOUCHED:** `e5c1106 2026-09-08 MONO-014: frame hierarchy and "No frame"`
**INBOUND REFS:** `grep -rn "mono-014" .` returns 8 lines (test files, `test-groups.mjs`, `docs/BACKLOG.md`, `MONO-014-FrameHierarchy.md` prose). `grep -rn "docs/screenshots/mono-014" .` → NO INBOUND REFERENCES. `tools/mono-014-screenshots.mjs:6` writes to this exact path.
**VERDICT: UNDECIDED.** Same reasoning as mono-013.

**PATH:** `docs/screenshots/mono-015/`
**SIZE:** 1.4M
**LAST TOUCHED:** `2f59c4c 2026-09-09 MONO-016: unified letter spacing across monogram layouts` (touched incidentally by the MONO-016 commit, not a MONO-015 commit — the directory's content is MONO-015 evidence but git's last-touch on the path is the later commit)
**INBOUND REFS:** `grep -rn "mono-015" .` returns 8 lines. `grep -rn "docs/screenshots/mono-015" .` → 1 line: `docs/specifications/MONO-015-WeightSizing.md:273: * Screenshots (\`docs/screenshots/mono-015/\`, Mug / gold / Great Vibes "A" / layout single / frame`.
**VERDICT: KEEP.** Cited by path in its own spec's prose as the documented visual evidence; deleting would leave a dead citation.

**PATH:** `docs/screenshots/mono-016/`
**SIZE:** 1.6M
**LAST TOUCHED:** `8ab1488 2026-09-09 MONO-016 follow-up: test 7 disclosure + OpenType-slot screenshots + spec reachability`
**INBOUND REFS:** `grep -rn "mono-016" .` returns 9 lines. `grep -rn "docs/screenshots/mono-016" .` → 1 line: `docs/specifications/MONO-016-LetterSpacing.md:260: The \`docs/screenshots/mono-016/slot-natural.png\` / \`slot-wide.png\` pair is therefore`.
**VERDICT: KEEP.** Same reasoning as mono-015 — cited by path in its own spec.

---

### Class 2 — `docs/data/read-005/**`, `docs/data/read-011/**`, `f-ladder.json` called out separately

**PATH:** `docs/data/read-005/` (all files except `f-ladder.json`: `README.md` 8.0K, `calibration-key.json` 40K, `derived-tables.json` 32K, `ratings.csv` 8.0K, `tracking-key.json` 36K, `tracking-renders-ratings.csv` 4.0K)
**SIZE:** 7.2M for the whole directory; 7.0M of that is `f-ladder.json` alone (see below), so the other six files total ≈128K.
**LAST TOUCHED:** `9d76610 2026-09-04 READ-007A: correct nonScriptCut provenance string` (path scoped to exclude `f-ladder.json`'s own history)
**INBOUND REFS:** `grep -rln "read-005" .` → 21 files, including three that actually *read* these files at runtime, not just mention them: `tools/test-read-005-derived-tables.mjs` (golden-file pin on `derived-tables.json`), `tools/test-read-011c-tracking-solver-regression.mjs:40` (`readFile(... 'docs/data/read-005/tracking-key.json' ...)`), and `tools/font-certification/read-011-renders.mjs:51` (reads `docs/data/read-005/ratings.csv` as a header template).
**VERDICT: KEEP.** Two committed test files fail without these exact bytes (PIN-ONCE golden guards, matching `MAINT-004-TestSuiteRationalization.md`'s own classification of `test-read-005-derived-tables.mjs`). Not deletable without breaking the default test suite.

**PATH:** `docs/data/read-005/f-ladder.json`
**SIZE:** 7.0M
**LAST TOUCHED:** `5ea88b7 2026-09-03 READ-005A: archive the rating data, record the calibration findings, supersede READ-005 §1.2/3.2/3.4/4.2/4.3/7`
**INBOUND REFS:** `grep -rn "f-ladder" .` → 18 lines. Critically, `tools/test-read-005-derived-tables.mjs:7` states explicitly: *"directly (no subprocess), never reads f-ladder.json"*, and `tools/font-certification/analyze-ratings.mjs:13` states: *"f-ladder.json is deliberately NOT read (7.4 MB, no table below needs it)"*. Every other reference is doc prose or the offline `tools/font-certification/f-ladder.mjs`/`calibration-renders.mjs` generator/consumer pair (dev tooling, not tests). `docs/data/read-005/README.md:113` documents its sha256 checksum as an archival integrity record.
**VERDICT: UNDECIDED.** No test reads this file — by its own neighboring test's admission — so it is not load-bearing for `npm test`. It is 97% of `read-005`'s footprint and is deliberately archived with a documented checksum (a conscious "keep the raw research data" decision from READ-005A, not an oversight). Whether that archival value is worth 7.0M in a JS/HTML/CSS repo is a call for the user, not this audit.

**PATH:** `docs/data/read-011/`
**SIZE:** 252K
**LAST TOUCHED:** `1b30123 2026-09-07 READ-011E: land the READ-011 ratings, regenerate the session-3 golden, amend tests 3 and 10`
**INBOUND REFS:** `grep -rln "read-011" .` → 24 files. Confirmed actual runtime reads (not just mentions): `tools/test-read-011d-session3.mjs` (pins `derived-tables.json`), `tools/test-read-011c-render-key.mjs:34-35,182` (reads `render-plan.json`, `render-key.json`, `ratings.csv`), `tools/test-read-011b-render-plan.mjs:31` (reads `render-plan.json`), `tools/test-font-lib-005-montserrat-retired.mjs:35,38` (reads `render-key.json`, `render-plan.json`).
**VERDICT: KEEP.** Four committed test files read these files directly; deleting breaks the default suite (same PIN-ONCE pattern as read-005).

---

### Class 3 — `tools/mono-013-screenshots.mjs`, `tools/mono-014-screenshots.mjs`

**PATH:** `tools/mono-013-screenshots.mjs`
**SIZE:** 4.0K
**LAST TOUCHED:** `2f59c4c 2026-09-09 MONO-016: unified letter spacing across monogram layouts`
**INBOUND REFS:** `grep -rn "mono-013-screenshots.mjs" .` → 1 line: `docs/BACKLOG.md:44` (the tracked playwright-not-in-package.json backlog item, listing this file as one of eight affected). No test file, no npm script.
**VERDICT: KEEP.** Not run by `npm test` and not invoked by any script, but it is the sole regeneration path for `docs/screenshots/mono-013/` (see Class 1) — same category as `tools/generate-example-baselines.mjs`, which this repo's own convention deliberately keeps despite an identical "not part of npm test" status.

**PATH:** `tools/mono-014-screenshots.mjs`
**SIZE:** 4.0K
**LAST TOUCHED:** `e5c1106 2026-09-08 MONO-014: frame hierarchy and "No frame"`
**INBOUND REFS:** `grep -rn "mono-014-screenshots.mjs" .` → 1 line: `docs/BACKLOG.md:44` (same playwright item).
**VERDICT: KEEP.** Same reasoning as `mono-013-screenshots.mjs`.

---

### Class 4 — `tools/rs2013-instanced-stone-harness.html`

**PATH:** `tools/rs2013-instanced-stone-harness.html`
**SIZE:** 32K
**LAST TOUCHED:** `d3ac127 2026-08-03 RS-2013 step 7: remove the old texture-based stone rendering path`
**INBOUND REFS:** `grep -rn "rs2013-instanced-stone-harness.html" .` → 4 lines, all in `src/` production code comments citing it as the origin of ported algorithms: `src/preview3d/ObjectGeometryBuilder.js:332`, `src/preview3d/Preview3DRenderer.js:61,99,444`.
**VERDICT: KEEP.** Actively cited as the documented source of three separate pieces of production math in `Preview3DRenderer.js`/`ObjectGeometryBuilder.js`. Standalone Three.js dev harness, matches the "standalone Three.js harness pattern for tools/" convention already established for RS-2013.

---

### Class 5 — `tools/generate-*.mjs` and `tools/measure-*.mjs`

No `package.json` script invokes any file in this class (`grep -A30 '"scripts"' package.json` lists only `test*`/`dev`/`start`/`doctor`).

**PATH:** `tools/generate-example-baselines.mjs` — 8.0K — `9743b60 2026-07-13`. Referenced by `tools/test-examples-regression.mjs:154`, `examples/baselines.json:3`'s own `generatedNote`, and 8+ spec docs as the deliberate manual-regeneration tool for the committed baseline. **VERDICT: KEEP** — active regeneration tool for a load-bearing golden file.

**PATH:** `tools/generate-image-trace-baselines.mjs` — 4.0K — `6ae42f2 2026-07-12`. Referenced by `tools/test-image-trace-regression.mjs:19,42` and `tools/lib/imageTraceFixtures.mjs:4` as the source of the committed baseline JSON it pins. **VERDICT: KEEP** — same pattern as above.

**PATH:** `tools/generate-rs-block-prototype-qa-sheet.mjs` — 12K — `da2be76 2026-07-23`. Referenced by `tools/test-rhinestone-font-prototype.mjs:16` and `src/text/rhinestoneFont/RhinestoneFontProvider.js:49`, `families/rsBlockPrototypeSS10.js:87` as the QA-sheet generator for the still-live diagnostic-only RS Block Prototype font. **VERDICT: KEEP.**

**PATH:** `tools/generate-rs-block-qa-sheets.mjs` — 4.0K — `0a2a5ce 2026-07-24`. Referenced by `tools/rhinestoneFontQaKit.mjs:4`, `tools/rsBlockQaCorpus.mjs:3`, `tools/test-rs-block.mjs:10`, `src/text/rhinestoneFont/index.js:41` and `RhinestoneFontProvider.js:132` — QA-sheet generator for the production RS Block font. **VERDICT: KEEP.**

**PATH:** `tools/generate-rs-modern-qa-sheets.mjs` — 4.0K — `0a2a5ce 2026-07-24`. Referenced by `tools/test-rs-modern.mjs:9`, `tools/rsModernQaCorpus.mjs:3` — QA-sheet generator for the production RS Modern font. **VERDICT: KEEP.**

**PATH:** `tools/measure-boolean-precision.mjs` — 28K — `c34a4b0 2026-07-12`. Referenced by `tools/test-boolean-precision-validation.mjs:5`, `src/geometry/PathBoolean.js:37,100`, `src/geometry/README.md:240`, and `docs/specifications/RS-1012A-ProductionPrecisionValidation.md` (the measurement harness its numbers come from). **VERDICT: KEEP** — cited as the source of production-code comments' numeric claims.

**PATH:** `tools/measure-font-height-ratios.mjs` — 12K — `6628a86 2026-08-03`. Referenced by `tools/test-font-height-ratios.mjs:16` (imported directly — `measureFontHeightRatios`/`roundRatio` are live functions called by a committed test) and `src/fonts/FontManager.js:51`. **VERDICT: KEEP** — actually imported by a test, not just cited.

**PATH:** `tools/measure-font-stem-width.mjs` — 24K — `ac3750f 2026-08-31`. Referenced by `tools/test-read-003-stem-width.mjs:33` (imported directly) and `src/text/StrokeWidthGate.js:12`, `src/fonts/FontManager.js:59`. **VERDICT: KEEP** — imported by a test.

**PATH:** `tools/measure-instanced-stone-performance.mjs` — 24K — `d3ac127 2026-08-03 RS-2013 step 7: remove the old texture-based stone rendering path`. `grep -rn "measure-instanced-stone-performance" .` → 1 line, its own file (`tools/measure-instanced-stone-performance.mjs:9`, its own usage comment). NO INBOUND REFERENCES from any other file — no test, no doc, no sibling script mentions it (contrast with `measure-performance.mjs` and `measure-boolean-precision.mjs`, which cite each other and appear in `docs/specifications/CI-001-RealTestExecution.md`).
**VERDICT: UNDECIDED.** Same "human-run diagnostic, not part of `npm test`" category as its siblings by its own doc comment, but unlike them it has zero external citations anywhere — not even a backlog or spec mention. Genuinely orphaned by the grep evidence; whether it retains standalone diagnostic value is a call for the user.

**PATH:** `tools/measure-performance.mjs` — 8.0K — `348459c 2026-08-06`. Referenced by `tools/measure-instanced-stone-performance.mjs:6`, `tools/test-examples-regression.mjs:149`, and 4 spec docs (`RS-2000`, `RS-2000A`, `RS-2002`) citing its measured numbers. **VERDICT: KEEP.**

---

### Class 6 — `tools/font-generator/` (30 Python files) and `tools/font-certification/`

**PATH:** `tools/font-generator/`
**SIZE:** 528K tracked (41 tracked files via `git ls-files tools/font-generator | wc -l`; working tree also has gitignored `__pycache__/`, `.pytest_cache/`, `lib/__pycache__/`, `tests/__pycache__/`, which don't count toward tracked size). 30 of the 41 tracked files are `.py`.
**LAST TOUCHED:** `24e5d43 2026-07-31 RC-009: file structure cleanup — orphaned files, milestone scripts, closed font-selection study data`
**INBOUND REFS:** `grep -rln "font-generator" .` → 19 files, all `docs/specifications/*.md` prose (`FONT-POLICY-001*`, `FONT-DECISION-001*`, `FONT-GEN-001..005*`, `TXT-104*`, `ARCH-REVIEW-001*`, `RS-2013*`, `RS-3001*`, `MAINT-004*`) plus `app.js` and `tools/test-stone-size-library.mjs`/`test-font-height-ratios.mjs`/`test-font-decision-001-stone-size-ux.mjs`/`src/renderer/StoneSizes.js`. Checked directly: none of those `app.js`/`test-*`/`src/` hits actually import or invoke anything under `tools/font-generator/` — they match on the substring "font-generator" appearing in comment prose citing the historical experiments, not on a live import. `tools/font-generator/tests/test_studio_registration.mjs` is **not** discovered by `tools/run-tests.mjs` (its discovery is `readdirSync(toolsDir)` — non-recursive, over `tools/` only — matched against `/^test-.*\.mjs$/`; a file one directory deeper is invisible to it), so this nested test has never run as part of `npm test`.
**VERDICT: DELETE candidate, but a documentation-linked one.** Per this project's own memory of the FONT-GEN-001/002/004/005 milestones, every procedural-font experiment this pipeline produced was rejected (no shipped font uses it). RC-009's own commit message already frames the directory as "closed font-selection study data." Nothing here is imported, run by `npm test`, or invoked by any script — it is cited only as historical narration inside spec docs, which stays true whether the code exists or not. The one caveat: this is Python in a repo whose CLAUDE.md states "JavaScript (ES Modules) ... No TypeScript" and doesn't mention Python at all, so its presence is already an architectural outlier independent of this audit.

**PATH:** `tools/font-certification/`
**SIZE:** 548K tracked (42 tracked files via `git ls-files tools/font-certification | wc -l`). `du -sh tools/font-certification` reports 310M on disk — almost entirely the gitignored `output/` subdirectory (309M, confirmed via `git status --short --ignored` showing `!! tools/font-certification/output/` and `du -sh tools/font-certification/*/` showing `309M tools/font-certification/output/` against `268K lib/` and `8.0K fixtures/`). The 310M figure is not a repo-size concern — it is untracked local working-tree state, not part of the 16M `docs/` or the 610-file count.
**LAST TOUCHED:** `3c19ec8 2026-09-07 FONT-LIB-005: correct the variable-font instance label and two stale documentation claims`
**INBOUND REFS:** `grep -rln "font-certification" .` → 40+ files including 13 committed test files that directly import or read its modules/data (`tools/test-read-011d-session3.mjs`, `tools/test-font-cert-001-classification.mjs`, `tools/test-read-011c-render-key.mjs`, `tools/test-read-011e-reachability.mjs`, `tools/test-read-011c-tracking-solver-regression.mjs`, `tools/test-read-005-derived-tables.mjs`, `tools/test-font-source-001-evaluate.mjs`, `tools/test-font-cert-002-word-space-narrative.mjs`, `tools/test-font-lib-004-height-readability.mjs`, `tools/test-font-cert-002-readability-metrics.mjs`, `tools/test-read-011b-render-plan.mjs`, `tools/test-read-002-radial-per-glyph.mjs`, `tools/test-read-004-recognition-harness.mjs`, `tools/test-read-003-stem-width.mjs`, `tools/test-font-cert-002-outline-detector-fixtures.mjs`), plus `.gitignore:54` itself, `tools/measure-font-stem-width.mjs`, and `src/geometry/GlyphSeparation.js:10`.
**VERDICT: KEEP.** This is a live pipeline, not a spent one-off — over a dozen default-suite test files depend on its code or on data it produced (`docs/data/read-005/**`, `docs/data/read-011/**`).

---

### Class 7 — `examples/*.rhs` not referenced by `gallery.json`, `baselines.json`, or any `test-*.mjs`

Checked all 27 tracked `.rhs` files individually against `examples/gallery.json`, `examples/baselines.json`, and every `tools/test-*.mjs` file:

```
boolean-union-badge.rhs              | gallery:1 | baselines:1 | tests: test-maint-003-materializer-contract.mjs
bottle-front-design.rhs              | gallery:1 | baselines:1 | tests: none
business-logo-monogram-bottle.rhs    | gallery:1 | baselines:1 | tests: none
circle-only.rhs                      | gallery:1 | baselines:1 | tests: test-gallery.mjs, test-maint-003-materializer-contract.mjs
front-wrap-light-cup.rhs             | gallery:1 | baselines:1 | tests: none
image-trace-monogram.rhs             | gallery:1 | baselines:1 | tests: test-examples-regression.mjs, test-maint-003-materializer-contract.mjs
large-stones-wide-gap.rhs            | gallery:1 | baselines:1 | tests: none
long-name-autofit.rhs                | gallery:1 | baselines:1 | tests: test-mono-015-weight-sizing.mjs, test-read-008-ratio-floor.mjs, test-read-009-bridge-autofit-floor.mjs
long-script-name.rhs                 | gallery:1 | baselines:1 | tests: test-read-008-ratio-floor.mjs, test-geometry-stone-overlap-same-contour.mjs
mixed-all-layers.rhs                 | gallery:1 | baselines:1 | tests: none
mixed-fill-styles-and-sizes.rhs      | gallery:1 | baselines:1 | tests: none
mixed-text-circle.rhs                | gallery:1 | baselines:1 | tests: none
mixed-text-rectangle.rhs             | gallery:1 | baselines:1 | tests: test-rs3012-step5-rectangle-select.mjs
monogram-fill.rhs                    | gallery:1 | baselines:1 | tests: none
monogram-outline.rhs                 | gallery:1 | baselines:1 | tests: none
multi-color-mixed-layers.rhs         | gallery:1 | baselines:1 | tests: none
rectangle-only.rhs                   | gallery:1 | baselines:1 | tests: test-geometry-stone-overlap-same-contour.mjs, test-maint-003-materializer-contract.mjs
script-name-great-vibes.rhs          | gallery:1 | baselines:1 | tests: test-mono-015-weight-sizing.mjs
short-name-block.rhs                 | gallery:1 | baselines:1 | tests: test-mono-015-weight-sizing.mjs, test-examples-regression.mjs, test-maint-003-materializer-contract.mjs
small-stones-tight-gap.rhs           | gallery:1 | baselines:1 | tests: none
svg-logo-import.rhs                  | gallery:1 | baselines:1 | tests: test-maint-003-materializer-contract.mjs
team-jersey-name-number.rhs          | gallery:1 | baselines:1 | tests: none
tumbler-wrap-design.rhs              | gallery:1 | baselines:1 | tests: none
vitalina-serbin.rhs                  | gallery:1 | baselines:1 | tests: test-gallery.mjs, test-examples-regression.mjs
vitalina.rhs                         | gallery:1 | baselines:1 | tests: test-gallery.mjs, test-project-model-consolidation.mjs, test-examples-regression.mjs
wedding-bride-tribe-tumbler.rhs      | gallery:1 | baselines:1 | tests: test-gallery.mjs
wide-wrap-dark-cup.rhs               | gallery:1 | baselines:1 | tests: none
```

**VERDICT: KEEP — all 27, no candidates.** Every single tracked `.rhs` file is referenced by both `examples/gallery.json` and `examples/baselines.json`; none are orphaned. This class produces zero deletion candidates.

---

### Class 8 — `assets/fonts/*.ttf` absent from `assets/fonts/manifest.json`

`comm -23` between the sorted list of 30 tracked `.ttf` basenames and the sorted, de-duplicated set of `"assets/fonts/*.ttf"` path strings extracted from `manifest.json` → empty output.

**VERDICT: KEEP — all 30, no candidates.** Every tracked `.ttf` file (including `Montserrat-Regular.ttf`, retained per the established `FONT-LIB-005` decision even though its manifest entry has `enabled: false`) has a corresponding manifest `path` entry. This class produces zero deletion candidates.

---

### Class 9 — `src/` files with zero importers (established by grep, the `CupRenderer.js` precedent)

**PATH:** `src/tests/README.md`
**SIZE:** 4.0K
**LAST TOUCHED:** `65a8004 2026-07-09 chore(repo): initialize Rhinestone Studio repository` (never touched since initial scaffold)
**INBOUND REFS:** `grep -rn "src/tests" . --exclude-dir=.git --exclude-dir=node_modules` → NO INBOUND REFERENCES.
**VERDICT: DELETE.** This is the exact "legacy/empty" directory this project's own convention memory already flags: tests live in `tools/test-*.mjs`, never `src/tests/`. Its README's own text ("Unit, geometry, export, and golden project tests") describes a layout the project abandoned before this repo's first non-scaffold commit. Zero references anywhere.

**Remaining `src/**/*.js` files (104 total):** a basename-grep sweep across the whole tree (excluding `.git`, `node_modules`, and the gitignored `tools/font-certification/output/`/`__pycache__/` dirs) for every one of the 104 files was run to find any with zero non-self references, mirroring the `CupRenderer.js` precedent from MAINT-004. That sweep did not finish inside this audit's session — it is a 104× full-repo grep and repeatedly exceeded the tool's execution window without completing. **This sub-check is INCOMPLETE, not clean.** Do not read the absence of other findings here as "everything in `src/` has importers" — only `src/tests/README.md` (found by inspection, not the sweep) and the classes above are confirmed. A follow-up pass with a single-pass tool (e.g., one script that indexes all import specifiers once rather than 104 separate full-tree greps) is needed to actually close this item.

---

## Section B — `.gitignore` Audit

One line per rule: rule → verdict → evidence.

```
node_modules/                    KEEP   — 88M / 3,420 files on disk; obviously real, standard.
dist/                             DROP   — git check-ignore -v confirms the pattern fires
                                            (.gitignore:5), but `git log --all --oneline -- dist`
                                            is empty and the directory does not exist in the
                                            working tree. Never real in this repo.
build/                            DROP   — same evidence pattern as dist/ (.gitignore:6); never
                                            tracked, doesn't exist, matches nothing.
coverage/                         DROP   — same pattern (.gitignore:7); no coverage tool is
                                            configured anywhere in package.json; never real.
*.log                             KEEP   — generic/cheap boilerplate line, standard Node hygiene,
                                            costs nothing to keep even though nothing currently
                                            matches.
npm-debug.log*                    KEEP   — same reasoning; standard npm boilerplate.
yarn-debug.log*                   FOLD   — repo uses npm (package-lock.json, npm scripts only,
                                            no yarn.lock anywhere); yarn-specific lines are inherited
                                            boilerplate for a package manager this repo doesn't use.
yarn-error.log*                   FOLD   — same as yarn-debug.log*.
.DS_Store                         KEEP   — actively matches; `docs/screenshots/.DS_Store` and
                                            `tools/font-certification/.DS_Store` both show up in
                                            `git status --short --ignored` as real, currently
                                            present ignored files on this macOS box.
Thumbs.db                         KEEP   — cheap Windows-hygiene boilerplate; contributors may be
                                            on Windows even if this session is on macOS.
.vscode/                          KEEP   — standard editor-config boilerplate, near-zero cost.
.idea/                             KEEP   — same.
*.swp                             KEEP   — same (vim swap files).
*.swo                              KEEP   — same.
.env                               KEEP   — no .env file is tracked or present, but this is a
                                            security-relevant line (secrets) that must stay even
                                            when unused right now — dropping it is the wrong kind
                                            of cleanup.
.env.local                        KEEP   — same reasoning.
.env.*.local                       KEEP   — same reasoning.
exports/                           DROP   — git check-ignore -v fires (.gitignore:31); git log
                                            --all shows nothing; directory absent. Never real.
release/                           DROP   — same pattern (.gitignore:32); never real.
releases/                          DROP   — same pattern (.gitignore:33); never real.
screenshots/generated/             DROP   — same pattern (.gitignore:34); never real. Note this
                                            is a *different* path from the tracked
                                            docs/screenshots/ tree audited in Section A — this
                                            rule is for a top-level screenshots/ that doesn't exist.
tests/output/                      DROP   — same pattern (.gitignore:35); never real. Also shadows
                                            nothing, since the real test output convention is
                                            stdout from tools/run-tests.mjs, not a file tree.
golden-output/                     DROP   — same pattern (.gitignore:36); never real.
tmp/                                DROP   — same pattern (.gitignore:37); never real in the repo
                                            itself (this session's own scratch files live outside
                                            the repo, per the harness's scratchpad convention).
*.zip                              KEEP   — cheap, plausible accidental-archive-commit guard.
*.tar.gz                           KEEP   — same.
__pycache__/                       KEEP   — actively matches: git status --ignored shows
                                            tools/font-generator/__pycache__/,
                                            tools/font-generator/.pytest_cache/,
                                            tools/font-generator/lib/__pycache__/, and
                                            tools/font-generator/tests/__pycache__/ all present
                                            right now.
*.pyc                              KEEP   — companion to __pycache__/, same live evidence class.
tools/font-cal-001/output/fonts/   DROP   — tools/font-cal-001/ itself no longer exists: per
                                            release-gate.md's RC-014 entry, CLEANUP-002 removed
                                            "the font-cal-001 tooling directory under tools/
                                            (calibration tooling for the already-rejected
                                            Sacramento procedural-font approach)". git log --all
                                            --oneline -- tools/font-cal-001 shows history but the
                                            path is gone from the working tree and current HEAD.
                                            Dead rule for a directory that was deleted outright,
                                            not one that still produces gitignored output.
tools/font-certification/output/   KEEP   — actively matches 309M of real, currently-present
                                            output (git status --ignored confirms
                                            `!! tools/font-certification/output/`). Load-bearing:
                                            without this rule the next font-certification run
                                            would offer to commit 309M.
tools/scratch/                     KEEP   — the documented, actively-referenced scratch-work
                                            convention (cited by name in release-gate.md's RC-014
                                            entry: "a scratch verification script under tools/
                                            (gitignored, not committed — this repo's standing
                                            convention for ad hoc QA tooling)").
tools/*-verify.mjs                 KEEP   — part of the same documented convention, no evidence
                                            it's unused.
tools/*-verification.mjs           KEEP   — same.
tools/*-screenshots/               KEEP   — same convention, matches directories (not the .mjs
                                            generator scripts in Section A Class 3 — see gap below).
tools/rc-014-font-spotcheck.mjs                    KEEP — file exists on disk right now
                                                      (untracked, gitignored); explicit
                                                      pre-convention exception, doc says "do not
                                                      imitate."
tools/rs-3011-step4-flash-check.mjs                KEEP — same, exists on disk right now.
tools/rs-3011-step4-flash-check-heavy.mjs          KEEP — same, exists on disk right now.
tools/rs2013-instanced-stone-harness-screenshot.mjs FOLD — file does NOT exist in the working
                                                      tree (confirmed absent). git log --all
                                                      --oneline -- shows it was tracked and then
                                                      untracked by commit 430c867 "tools: untrack 4
                                                      one-shot milestone-verification scripts" —
                                                      so the historical need this exact line
                                                      documents is gone; the general
                                                      tools/*-verify.mjs / tools/*-screenshots/
                                                      globs already cover any future script with
                                                      this kind of name. Safe to fold away, but
                                                      not urgent.
```

**Ten rules matching nothing in the current tree** (`dist/`, `build/`, `coverage/`, `exports/`,
`release/`, `releases/`, `screenshots/generated/`, `tests/output/`, `golden-output/`, `tmp/`):
all ten behave identically under evidence — `git check-ignore -v` confirms each pattern is
syntactically live and would fire the moment a matching path appeared, but `git log --all
--oneline -- <path>` is empty for every one of them and none of the directories exist in the
current working tree. There is no commit in this repository's history where any of these
directories held tracked content that was later ignored-and-removed — they read as **inherited
boilerplate from a generic Node-project `.gitignore` template**, not as patterns this repo's own
history ever exercised. (Contrast with `tools/font-cal-001/output/fonts/`, which *did* have real
history and a real, documented removal event — that one earns a DROP for a different, project-specific
reason: the directory it protects was deliberately deleted by name in `RC-014`.)

**Lines 80–83 (pre-convention one-offs):**

```
tools/rc-014-font-spotcheck.mjs                      exists
tools/rs-3011-step4-flash-check.mjs                  exists
tools/rs-3011-step4-flash-check-heavy.mjs            exists
tools/rs2013-instanced-stone-harness-screenshot.mjs  absent
```

**Tracked files also matched by an ignore rule:** `git ls-files --cached -i --exclude-standard`
→ empty output. No currently tracked file is shadowed by any `.gitignore` rule.

**Would the `tools/*-screenshots/` glob have caught `mono-013-screenshots.mjs` /
`mono-014-screenshots.mjs`?** No. `git check-ignore -v tools/mono-013-screenshots.mjs` and the
`mono-014` equivalent both report "NOT IGNORED." This is mechanically correct, not a bug: the glob
`tools/*-screenshots/` (trailing slash) matches *directories* named `something-screenshots`
(the output folders these two scripts write into, e.g. a hypothetical
`tools/mono-013-screenshots/`), while the two files in question are `.mjs` **scripts** ending in
`-screenshots.mjs`, a different shape the glob was never written to match — and they are, in fact,
committed on purpose (Section A Class 3: KEEP, as the regeneration tools for tracked
`docs/screenshots/mono-013/` and `mono-014/`). The minimal glob that *would* additionally catch
files shaped like `tools/*-screenshots.mjs` is simply adding that one line:
`tools/*-screenshots.mjs` — but adding it would gitignore these two specific tracked files going
forward (a behavior change, and out of this audit's no-edit scope), so it is reported here as the
answer to "what would close the gap," not as a recommendation to apply it.

### Proposed rewritten `.gitignore` (not applied)

```gitignore
# Dependencies
node_modules/

# Logs
*.log
npm-debug.log*

# OS files
.DS_Store
Thumbs.db

# IDE/editor
.vscode/
.idea/
*.swp
*.swo

# Environment/local config
.env
.env.local
.env.*.local

# Generated exports and QA output
tools/font-certification/output/

# Archives
*.zip
*.tar.gz

# Python helper caches
__pycache__/
*.pyc

# ---------------------------------------------------------------------------
# Scratch + one-off verification artifacts -- never tracked
# ---------------------------------------------------------------------------
# Per-milestone spikes, ad hoc live-browser Playwright verification scripts, and
# their screenshot folders are working aids, not repo artifacts. Findings get
# written up in docs/ or reported to the user; the scripts and images never get
# committed.
#
# This section used to be ~85 individual lines -- one per milestone -- which
# meant every new milestone had to remember to add its own line. Once one
# didn't, and four scratch scripts got tracked by mistake. The globs below cover
# the whole class, so that mistake is now structurally impossible.
#
# Do NOT add new per-milestone lines. Instead:
#   - put scratch spikes / verification scripts under  tools/scratch/   (all ignored), or
#   - name the script       tools/<milestone>-verify.mjs
#     and its screenshots   tools/<milestone>-...-screenshots/          (both ignored below)
tools/scratch/
tools/*-verify.mjs
tools/*-verification.mjs
tools/*-screenshots/

# Pre-convention one-offs whose names fit neither glob. Kept explicit; do not
# imitate these names -- new scratch work goes under tools/scratch/.
tools/rc-014-font-spotcheck.mjs
tools/rs-3011-step4-flash-check.mjs
tools/rs-3011-step4-flash-check-heavy.mjs
```

Changes from current: dropped the ten never-real boilerplate lines (`dist/`, `build/`,
`coverage/`, `exports/`, `release/`, `releases/`, `screenshots/generated/`, `tests/output/`,
`golden-output/`, `tmp/`); dropped `yarn-debug.log*`/`yarn-error.log*` (npm-only repo); dropped
`tools/font-cal-001/output/fonts/` (the directory it protects no longer exists); dropped
`tools/rs2013-instanced-stone-harness-screenshot.mjs` (file no longer exists, general globs cover
its shape). Everything with live, current evidence of matching something real is kept unchanged.
This is a proposal only — no `.gitignore` edit was applied, per this task's instructions.

---

## Section C — Release-Gate Readiness

`docs/release-process/release-gate.md`'s checklist (Sections 1–5) verbatim:

```
1. Functional tests
- Text change updates layout
- Font change updates layout
- Stone size change updates layout
- Gap change updates layout
- Color change updates layout
- 2D, 3D, and export use the same StoneLayout

2. Geometry tests
- Coordinates are in millimeters
- No duplicate stones
- Minimum gap is respected where applicable
- Long text auto-fits
- Stones remain inside printable area

3. Export tests
- Project JSON exports
- Layout JSON exports
- SVG exports in millimeters
- PNG exports render the same visible design

4. Visual QA
- Text is readable
- Cup is centered
- Handle is attached
- Stones are visible
- No obvious desynchronization

5. Known issues
- Every known issue must be documented before release.
```

**What's not yet satisfied on `develop`:** the file's own Release Record section ends at
"Version 1.1.0 — released 2026-08-27." `git log v1.1.0..develop --oneline` shows **150 commits**
landed since that tag — READ-001 through READ-011E (a full readability-architecture program
touching text-fill geometry and export-time warnings), FONT-LIB-002 through FONT-LIB-005
(font-picker gating, Montserrat retirement), PERF-005/PERF-006 (geometry sweep changes),
FONT-PITCH-001, MONO-012 through MONO-022, RS-3015, MAINT-003, and MAINT-004 — and **none of them
has a corresponding Release Record entry**. This repo's own established convention (the RC-011,
RC-012, RC-014 entries above) is to re-audit the gate explicitly whenever substantial `src/**`
work lands on `develop` after the last recorded pass, rather than assume a prior pass still
covers it. That re-audit has not happened for any of these 150 commits.

Per this task's audit-only scope and this project's Testing Policy (no `npm test`/`test:full` run
"unless changing shared architecture" — this task changes nothing), the following is based on
documentation already on record, not a fresh test run:

- **Categories 1–3 (Functional/Geometry/Export tests):** indirectly supported.
  `docs/specifications/MAINT-004-TestSuiteRationalization.md` records all 150 `tools/test-*.mjs`
  files passing as of that audit (the tip this branch is built from), which is evidence the
  automated suite is green, but that was MAINT-004's own audit for its own narrower purpose (test
  rationalization), not a release-gate pass — it was never entered into `release-gate.md` as a
  gate confirmation the way RC-011/012/014 were.
- **Category 4 (Visual QA):** **not satisfied / unverified.** No live-browser QA pass is recorded
  for `develop` since `v1.1.0`. `RC-011`'s own history shows this category catches real defects
  (`RC-011`'s plate-mirroring bug) that automated Node tests miss — headless coverage isn't a
  substitute for this line item, and this audit did not perform browser verification (out of
  scope for an audit-only task with no UI change to verify).
- **Category 5 (Known issues documented):** **not satisfied / stale.** The last "Known issues"
  update is the RC-014/v1.1.0 entry. It does not mention anything from the 150-commit READ-*/
  FONT-LIB-*/MONO-01x-02x program — in particular, `READ-011E`'s own recorded conclusion ("ships
  NO floor, `MIN_HEIGHT_TO_STONE_RATIO` stays 16" — see this project's `READ-011E
  pre-registration defect` memory) is a real product-behavior decision with no corresponding line
  in `release-gate.md`'s Known Issues section.

No blocking defect is claimed here — this section is reporting *documentation-gate staleness*
(no recorded re-audit since `v1.1.0`), not a discovered regression. Whether `develop` is actually
release-ready is a question the next gate re-audit (in the style of `RC-011`/`RC-014`) needs to
answer, not this hygiene audit.
