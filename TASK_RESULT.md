# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RC-009 — File Structure Cleanup (Housekeeping)

---

# Status

IMPLEMENTED

---

# Branch

chore/rc-009-file-structure-cleanup (cut from `develop`)

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

Changes are left staged/unstaged, not committed, per the task instructions.

---

# Summary

Audited every candidate `ARCH-REVIEW-001` §2.2/§2.3 named, re-derived the script list by checking
imports and spec-doc coverage rather than copying the review's list verbatim, and applied the
safety rule (grep the whole repo before deleting anything) to every item. Result: **31 items
deleted** (1 file + 25 tracked files across four dirs' worth of scripts/output + 3 directories'
untracked generated output), **8 items kept** despite being named as candidates, because the
reference check found a live dependency the review's characterization missed. A follow-up pass
inside the kept `review/` directory (prompted by a direct question about `review/assets/`) found a
genuinely orphaned 596-file subset within it and deleted those too (see §3). Sasha then explicitly
directed deletion of all 10 `review/*-rater-*.html` files (the ones `FONT-POLICY-001-ClosedNoAction
.md` had said should stay as "evidence") — an explicit override of that stated intent, executed as
instructed (see §3a).

**~112.1 MB (106.9 MiB) of tracked repository content removed.**

`fonts/sources/` and `generated-fonts/` were not touched, read, or modified.

---

## 1. Orphaned files / stale references

### Deleted

- **`style.css` (2256 bytes) — DELETED.** Reference check: `grep -rn "style\.css"` across
  `src/**`, `app.js`, `index.html`, `tools/**`, `docs/**`, `.github/**`, `package.json` returned
  zero hits — no `<link>` tag or import anywhere points at it. Confirmed `index.html` carries its
  own complete, current inline `<style>` block (the `UI-001` design-token redesign, starting at
  `index.html:7`) that fully supersedes whatever `style.css` once provided. Deleted with no
  reference to clean up, since nothing pointed at it.
- **`docs/fonts/Elegant-Cursive/` (empty directory) — DELETED.** Untracked, empty, not present in
  `git ls-files`. No code constructs a `docs/fonts` path (`candidatePath.mjs`,
  `evaluate-source.mjs`, `certify.mjs`, `claudeDesignFeedback.mjs` all reference the string
  `"Elegant-Cursive"` as a font/catalog name, never as a `docs/fonts` path). Removed via `rmdir` —
  not a git-tracked change since it was never committed.
- **`.gitignore` stale entry — FIXED.** Line 52, `tools/font-cal-002/output/fonts/`, pointed at a
  directory this milestone deletes (see §2). Removed that line; kept the sibling
  `tools/font-cal-001/output/fonts/` line since `tools/font-cal-001/` stays (see §2).

### Checked, not orphaned

- No other empty directories found under `src/`, `tools/`, `docs/`, `assets/`, `examples/`
  (`find . -type d -empty`, excluding `node_modules/`, `.git/`, `tmp/`).
- `SPEC_REVIEW_RESULT.md` — already confirmed absent by `RC-007`; still absent.

---

## 2. `tools/font-generator/` milestone scripts, and `font-cal-001/002`, `font-diag-001`

Re-derived `ARCH-REVIEW-001` §2.2's 15-script list by checking actual Python imports (not just
filenames) and cross-referencing each script against `docs/specifications/FONT-*.md` for captured
findings.

### Deleted (11 scripts, all milestone-named, unimported by anything outside themselves, findings
captured in a spec doc)

| Script | Findings captured in |
|---|---|
| `build_rater_tool_v2.py` | `FONT-DECISION-001-VisionStandardLongformCorpusAndRaterTool.md` (its output, `review/FONT-DECISION-001-rater-v2.html`, is the 156-item v2 rating pass the doc's §4 discusses) |
| `build_rater_tool_font_policy_001.py` | `FONT-POLICY-001-SS30HeightCeilingPolicyStudy.md`, `FONT-POLICY-001-ClosedNoAction.md` |
| `render_font_policy_001.py` | same two `FONT-POLICY-001-*.md` docs |
| `render_font_policy_001_rater_batch.py` | same two `FONT-POLICY-001-*.md` docs |
| `render_decision001_longform.py` | `FONT-DECISION-001-VisionStandardLongformCorpusAndRaterTool.md` |
| `render_human_panel.py` | `FONT-EVAL-002-HumanCalibratedLegibilityBaseline.md` |
| `render_vision_sample.py` | `FONT-EVAL-002-HumanCalibratedLegibilityBaseline.md` |
| `consolidate_decision001.py` | `FONT-DECISION-001-VisionStandardLongformCorpusAndRaterTool.md` |
| `consolidate_partB.py` | `FONT-DECISION-001-VisionStandardLongformCorpusAndRaterTool.md` |
| `build_partA_vision_transcriptions.py` | `FONT-DECISION-001-VisionStandardLongformCorpusAndRaterTool.md` |
| `build_review_html.py` | `FONT-GEN-002/003/004/005-*.md` |

For each, confirmed: not imported by `generate.py`, `pipeline.py`, `analyze.py`, `measure.mjs`,
`register_studio_fonts.mjs`, `validate_font.py`, `lib/`, or `tests/`; not referenced in
`package.json`, CI, or `tools/run-tests.mjs`/`test-groups.mjs`. `render_font_policy_001.py` and
`render_font_policy_001_rater_batch.py` do import from `render_portfolio001` (kept, see below) —
that's a dependency in the safe direction (deleted script depends on kept script), not a blocker.

### Kept — "kept, needs a human decision" (milestone-named, but findings NOT captured in a
dedicated spec doc)

- `build_rater_tool_portfolio001.py`
- `build_rater_tool_baloo2_untested_sizes.py` (imports `HTML_TEMPLATE` from the above)
- `render_portfolio001.py`
- `render_portfolio001_baloo2_untested_sizes.py` (imports from the above)

**Why not deleted**: `ARCH-REVIEW-001` listed these as candidates and `FONT-POLICY-001`'s two docs
reference "FONT-PORTFOLIO-001" by name several times (e.g. "FONT-PORTFOLIO-001's human ratings
collapsed at SS30..."), but there is no `docs/specifications/FONT-PORTFOLIO-001-*.md` file —
`git log --all` confirms that milestone (`154775e`, `a721445`, `46ae253`) never produced one. The
task's own rule requires findings to be "captured in a corresponding `docs/specifications/FONT-
*.md` file" before deleting; a same-topic mention inside a *different* milestone's doc doesn't meet
that bar as cleanly as the 11 scripts above, each of which has its own dedicated spec doc. Also:
these four scripts are also the write-target/import-source for the four `review/*.html` +
`review/assets/**` files that `FONT-POLICY-001-ClosedNoAction.md` (line 70) explicitly says
"remain in the repo/history as reusable tooling and evidence" — reinforcing that this cluster
wasn't meant to be treated as disposable the way the 11 above were. Flagged for Sasha rather than
deleted.

### `tools/font-cal-001/` — **NOT deleted, found referenced**

`ARCH-REVIEW-001` characterized this as a closed, archivable single experiment. The reference
check found otherwise: `tools/font-generator/measure.mjs` (explicitly on the "leave untouched"
list, and confirmed live — `pipeline.py` documents the chain
`measure.mjs -> font-cal-001's measureProduction.mjs -> font-certification's
productionAnalysis.mjs`) contains a real, non-comment import:

```js
// tools/font-generator/measure.mjs:19
import { measureFont } from '../font-cal-001/lib/measureProduction.mjs';
```

`FONT-CAL-001-SacramentoCalibrationPilot.md` itself says (line 283): "What appears reusable: the
measurement/validation pipeline. `measureProduction.mjs`'s thin [wrapper]..." — the spec doc
agrees this specific file was meant to survive the experiment. Deleting `tools/font-cal-001/`
would have broken a kept, general-purpose entry point. Left entirely in place, including its
`output/` directory.

### `tools/font-cal-002/` — DELETED

Reference check: only `docs/specifications/ARCH-REVIEW-001-*.md` and
`docs/specifications/FONT-CAL-002-ContiguousSpanCalibrationExperiment.md` reference it outside
itself — no code file does. It does import *from* `font-cal-001` (kept, see above) — that's the
safe direction. Findings confirmed captured in `FONT-CAL-002-ContiguousSpanCalibrationExperiment.md`.
Deleted wholesale (code + tracked `output/` + gitignored `output/fonts/*.ttf`, 117,885 tracked
bytes + untracked candidate `.ttf` files).

### `tools/font-diag-001/` — DELETED

Reference check: only `docs/specifications/ARCH-REVIEW-001-*.md`,
`FONT-DIAG-001-StoneSamplerSensitivityInvestigation.md`, and `tools/font-cal-002/README.md`
(itself deleted above, and only documented `pipeline-trace.mjs` as a manual verification step, not
a code import) reference it. No surviving code file (`generate.py`, `pipeline.py`, `analyze.py`,
`measure.mjs`, `lib/`, `tests/`, or `font-cal-001/`) imports it. Findings confirmed captured in
`FONT-DIAG-001-StoneSamplerSensitivityInvestigation.md`. Deleted (single file, 4,712 bytes).

---

## 3. Closed font-selection program — evaluation-only data

Checked directory-by-directory, per the task's instruction not to batch these.

### `output0/`, `output1/`, `output2/` — DELETED

Reference check: the only reference anywhere in the repository (code or docs) is
`docs/specifications/ARCH-REVIEW-001-*.md` itself, which lists them as candidates. `git log`
confirms the commit that added them (`b121557`, "Archive duplicate output snapshots") describes
them as "byte-identical to subsets of already-tracked output/ content... not part of any
font-generation milestone." Spot-checked: `output0/SS10/SacramentoRhinestone_SS10.ttf` and
`generation-metadata.SS10.json` are byte-for-byte identical (`md5`) to the corresponding files in
`generated-fonts/SS10/`; `output1/`'s and `output2/`'s `.ttf` and `generation-metadata.*.json`
files matched `generated-fonts/` the same way (only `evaluation.*.json`/`summary.*.json` — derived
re-evaluation metadata, not the certified output itself — differed, consistent with later
re-evaluation runs rather than a different generation result). Deleted all three directories
(34,297,445 tracked bytes) plus their untracked `.DS_Store` files.

### `fonts/review/` — **NOT deleted, found referenced**

The task's own example of a blocking case ("a script still reads from output0/") applies directly
here, just with a different script: `tools/font-certification/compare-sources.mjs` (a kept,
general-purpose tool, not milestone-named) genuinely reads from this directory at runtime:

```js
// tools/font-certification/compare-sources.mjs:31
const reportPath = repoPath('fonts', 'review', fontName, 'report.json');
```

`tools/font-certification/evaluate-source.mjs`'s docstring confirms `fonts/review/<FontName>/` is
its *default* output location for the general "evaluate a new font source" workflow — not tied to
one closed milestone; `ARCH-REVIEW-001` itself notes this exact tooling would be reused "a future
new font addition." `docs/specifications/FONT-ARCH-001-RhinestoneFontArchitectureStudy.md` and
`FONT-CAL-001-SacramentoCalibrationPilot.md` both cite specific paths inside it
(`fonts/review/Sacramento/report.json`, `fonts/review/*/report.json`). Left entirely in place.

### `fonts/comparison/` — **NOT deleted, found referenced**

`compare-sources.mjs` writes `fonts/comparison/{comparison.json,comparison.html}` from the
`fonts/review/` data above — same live, general-purpose tool. More directly:
`docs/specifications/FONT-ARCH-001-RhinestoneFontArchitectureStudy.md:119` cites a specific field
inside it by name ("`categoryGroups` in `fonts/comparison/comparison.json`"). Matches the task's
own "a doc links to a specific report.html inside fonts/review/" example precisely. Left in place
(24 KB — negligible size regardless).

### `review/` (repo root) — **NOT deleted, found referenced**

Initially looked like the strongest deletion candidate (96 MB, described in `ARCH-REVIEW-001` as
"Rater tool HTML + before/after specimen PNGs"), but the reference check found this is the most
explicitly-protected of the four:

- Multiple spec docs name exact files inside it: `review/FONT-GEN-00{1,2,3,4}-review.html`,
  `review/assets/<family>/<SIZE>/*.png`, `review/FONT-POLICY-001-rater-{Anton,Sacramento,
  DancingScript,Baloo2Variable}.html`, `review/FONT-DECISION-001-rater.html` and
  `-rater-v2.html`.
- `docs/specifications/FONT-POLICY-001-ClosedNoAction.md:70` makes this an explicit, already-
  recorded decision, not just an incidental mention: "`review/FONT-POLICY-001-rater-*.html`)
  remain in the repo/history as reusable tooling and evidence."
- `tools/font-generator/build_rater_tool.py` (not milestone-suffix-named, not in
  `ARCH-REVIEW-001`'s candidate list, kept regardless of this milestone's scope) still targets
  `review/FONT-DECISION-001-rater.html` as its build output if ever re-run.

The top-level `.html` files and the directory itself were left entirely in place. A follow-up
check inside `review/assets/` (asked directly: "are these files referenced? If not, delete")
found the reference check needed to go one level deeper than the directory as a whole:

- The `FONT-DECISION-001`/`FONT-POLICY-001`/`FONT-PORTFOLIO-001` rater-tool HTML files are
  genuinely self-contained (`base64`/`data:image` embedded, 0 `assets/`-relative references each)
  — they need nothing from `review/assets/`.
- The four `review/FONT-GEN-00{1,2,3,4}-review.html` pages are **not** self-contained: each
  contains real relative `<img src="assets/<family>/<SIZE>/...">` tags (111–130 per file, 442
  total, one-to-one with `review/assets/{Sacramento,Baloo2,Baloo2Variable,SacramentoSkeleton}/`).
  These 442 files are genuinely referenced and were kept.
- The remaining **596 of 1,041 files (~20.7 MB)** in `review/assets/` were referenced by none of
  the 14 HTML files, by any surviving script (`pipeline.py`'s mention of `review/assets/` is a
  doc-comment describing `build_review_html.py`'s behavior, not a read), or by any doc naming a
  specific filename (only the glob `review/assets/<SIZE>/*.png`, which the 442 kept files still
  satisfy). `FONT-GEN-001-ProceduralSacramentoRhinestoneFamily.md:303` independently confirms this
  split was intentional at generation time: "208 PNGs, curated subset only — not every corpus
  item." These 596 files are leftover renders from earlier curation/regeneration passes (e.g.
  `FONT-GEN-005`'s orientation-fix rerun, which regenerated `review/assets/**` under the same
  filenames-that-changed-between-runs pattern). Deleted, plus stray `.DS_Store` files. Verified
  all 442 referenced files still resolve after deletion (`review/assets/` now 442 files / 19 MB,
  down from 1,041 files / 40 MB); no now-empty subdirectories remained.

### 3a. `review/*-rater-*.html` — DELETED on Sasha's explicit direction (overrides the finding above)

After the `review/assets/` pass, Sasha directly instructed: "you can safely delete review/
*-rater- files and all assets associated with them." This is a deliberate override of the
"found referenced, not deleted" call above — `FONT-POLICY-001-ClosedNoAction.md:70` had said these
specific files should "remain in the repo/history as reusable tooling and evidence," and that is
no longer the operative decision. Deleted all 10:

- `FONT-DECISION-001-rater.html`, `FONT-DECISION-001-rater-v2.html`
- `FONT-POLICY-001-rater-{Anton,Baloo2Variable,DancingScript,Sacramento}.html`
- `FONT-PORTFOLIO-001-rater-{Anton,Baloo2Variable-SS10-SS30,DancingScript,Sacramento}.html`

("Assets associated with them": none exist separately — all 10 are self-contained,
base64-embedded single files with zero `assets/`-relative references each, confirmed in §3 above.
`review/assets/` is used only by the 4 `FONT-GEN-*-review.html` pages, which were not part of this
instruction and were not touched.)

**Anomaly found and flagged, not caused by this session's own actions**: before deleting it,
`review/FONT-POLICY-001-rater-Anton.html` was found already renamed on disk to
`review/FONT-POLICY-001cAnton.html` (git showed it as a working-tree deletion with a new untracked
file present). Byte-for-byte diff against the committed blob confirmed identical content — a pure
rename, not corruption or truncation — and no other file in the repository showed the same
anomaly. Nothing in this session's command history explains it. Deleted under its current on-disk
name as part of the same batch; flagged here in case it indicates something worth Sasha's
attention outside this milestone (e.g. an external sync/backup process touching the working tree).

`review/` now contains only the 4 `FONT-GEN-*-review.html` pages and the 442-file `review/assets/`
they link to (20 MB total, down from the original 96 MB).

**Documentation consequence — corrected on explicit instruction.** `docs/specifications/
FONT-POLICY-001-ClosedNoAction.md`'s §5 ("What exists from this milestone's work, unused") had
claimed these files "remain in the repo/history as reusable tooling and evidence." That was
flagged as stale-but-not-corrected in the prior report, deferring to Sasha since this milestone's
own rule bars altering `docs/specifications/*.md` findings/content. Sasha then explicitly directed
a scoped fix: update only that one sentence to note the deletion, leave everything else in the
file untouched, and report the exact before/after.

The sentence also named the three `tools/font-generator/` scripts this same milestone deleted in
§2 (`render_font_policy_001.py`, `render_font_policy_001_rater_batch.py`,
`build_rater_tool_font_policy_001.py`) alongside the `review/FONT-POLICY-001-rater-*.html` glob —
all four were claimed to "remain," and all four are now gone. The fix covers all four (still one
sentence, still the one location Sasha pointed at) rather than leaving the script names newly
stale one clause away from the fix. No other line in the file, and no finding/conclusion anywhere
in the file, was touched — confirmed via `git diff` showing exactly this one paragraph changed.

**Before** (`docs/specifications/FONT-POLICY-001-ClosedNoAction.md:67-72`):

> The sweep data, contact-sheet renders, and the 165mm-candidate rater-tool batch built earlier this
> session (`tools/font-generator/render_font_policy_001.py`,
> `render_font_policy_001_rater_batch.py`, `build_rater_tool_font_policy_001.py`, and
> `review/FONT-POLICY-001-rater-*.html`) remain in the repo/history as reusable tooling and evidence
> for whenever SS30 is revisited -- none of it was acted on for a production change, per the decision
> above.

**After** (`docs/specifications/FONT-POLICY-001-ClosedNoAction.md:67-72`):

> The sweep data, contact-sheet renders, and the 165mm-candidate rater-tool batch built earlier this
> session (`tools/font-generator/render_font_policy_001.py`,
> `render_font_policy_001_rater_batch.py`, `build_rater_tool_font_policy_001.py`, and
> `review/FONT-POLICY-001-rater-*.html`) were removed in RC-009 (file-structure cleanup) to reclaim
> space, once their findings were confirmed captured in this document -- none of it was acted on for
> a production change, per the decision above, and the SS30 analysis/no-action conclusion recorded
> in this document is unaffected.

Re-ran `node tools/run-tests.mjs --group documentation` after the edit — still passes (this file
is a `docs/specifications/*.md` doc, outside the living-doc path-checker's scope, so this was a
sanity check rather than an expected failure point).

---

## 4. Documentation follow-up

Checked `docs/ARCHITECTURE.md`, `docs/BACKLOG.md`, `docs/PRODUCT_ROADMAP.md`, and every
`docs/specifications/FONT-*.md` for references to every path deleted above
(`grep` for `style\.css`, `font-cal-002`, `font-diag-001`, `output0/1/2`, and each of the 11
deleted script filenames).

**Result: no changes needed.** None of the three living docs (`ARCHITECTURE.md`, `BACKLOG.md`,
`PRODUCT_ROADMAP.md`) reference any deleted path. The `docs/specifications/FONT-*.md` files that
name the 11 deleted scripts do so as historical record of what was run to produce their findings —
per this repo's own stated policy (confirmed in `RC-007` and re-confirmed in `ARCH-REVIEW-001`
§1.1 C), those spec docs are "historical by design" and not meant to be kept in sync with current
repository state, so a script name inside one is not a "dead path reference" requiring correction;
it's a true historical fact. No `docs/specifications/*.md` content/findings were altered.

The one real dead reference found was in `.gitignore` (§1, fixed).

---

## 5. Space reclaimed

| Item | Tracked bytes | Notes |
|---|---|---|
| `style.css` | 2,256 | |
| 11 `tools/font-generator/` scripts | 75,174 | |
| `tools/font-cal-002/` | 117,885 | + untracked `output/fonts/*.ttf` (gitignored) |
| `tools/font-diag-001/` | 4,712 | |
| `output0/` + `output1/` + `output2/` | 34,297,445 | + untracked `.DS_Store` |
| `review/assets/` (596 orphaned files) | 20,659,372 | rest of `review/` kept — see §3 |
| `review/*-rater-*.html` (10 files) | 56,987,322 | deleted on Sasha's explicit direction — see §3a |
| **Total (tracked)** | **~112,144,166 bytes (~112.1 MB / ~106.9 MiB)** | |

`fonts/review/` (199 MB) and `fonts/comparison/` (24 KB) were kept after the reference check —
both are actively read/written by `tools/font-certification/compare-sources.mjs`, a kept
general-purpose tool, not milestone-specific scratch data. `review/` now holds only the 4
`FONT-GEN-*-review.html` pages and the 442 PNGs they link to (20 MB, down from the original
96 MB) — the rater-tool HTML files that made up most of its original size were removed per §3a.

---

## 6. Verification

- `node tools/run-tests.mjs --group architecture` — 4/4 passed (module boundaries, module-graph
  exports, project-model consolidation, browser-dependency-loading — none reference any deleted
  path).
- `node tools/run-tests.mjs --group documentation` — one pre-existing failure
  (`TASK.md: docs/specifications/RC-002` — a broken reference already present before this
  milestone's changes, reproduced identically on a clean `git stash`; unrelated to this milestone,
  not introduced by it, and resolved as a side effect of this milestone overwriting `TASK.md` with
  RC-009's own content).
- Did not run `npm test` / `npm run test:full` — this milestone made no `src/**`, `app.js`,
  `index.html`, exporter, or project-schema changes, so per the testing policy only the directly
  related groups (architecture, documentation) were run.

---

## Full accounting — deleted

- `style.css`
- `docs/fonts/Elegant-Cursive/` (untracked empty dir)
- `tools/font-generator/build_rater_tool_v2.py`
- `tools/font-generator/build_rater_tool_font_policy_001.py`
- `tools/font-generator/render_font_policy_001.py`
- `tools/font-generator/render_font_policy_001_rater_batch.py`
- `tools/font-generator/render_decision001_longform.py`
- `tools/font-generator/render_human_panel.py`
- `tools/font-generator/render_vision_sample.py`
- `tools/font-generator/consolidate_decision001.py`
- `tools/font-generator/consolidate_partB.py`
- `tools/font-generator/build_partA_vision_transcriptions.py`
- `tools/font-generator/build_review_html.py`
- `tools/font-cal-002/` (whole directory)
- `tools/font-diag-001/` (whole directory)
- `output0/`, `output1/`, `output2/` (whole directories)
- `review/assets/` — 596 of 1,041 files (~20.7 MB), the subset not linked by any of the 4
  `review/FONT-GEN-00{1,2,3,4}-review.html` pages (see §3); the other 442 were kept
- `review/FONT-DECISION-001-rater.html`, `review/FONT-DECISION-001-rater-v2.html`,
  `review/FONT-POLICY-001-rater-{Anton,Baloo2Variable,DancingScript,Sacramento}.html`,
  `review/FONT-PORTFOLIO-001-rater-{Anton,Baloo2Variable-SS10-SS30,DancingScript,Sacramento}.html`
  (10 files, ~57 MB) — deleted on Sasha's explicit direction, overriding the "kept" call below
  (see §3a)

## Full accounting — kept, found referenced (not deleted)

- `tools/font-cal-001/` — live import from `tools/font-generator/measure.mjs`
- `fonts/review/` — live read from `tools/font-certification/compare-sources.mjs`; cited by path
  in `FONT-ARCH-001`/`FONT-CAL-001` docs
- `fonts/comparison/` — live write target of the same tool; specific field cited in `FONT-ARCH-001`
- `review/` (repo root) — now just the 4 `FONT-GEN-*-review.html` pages + the 442
  `review/assets/` files they link to; the original reasoning ("named file-by-file in five spec
  docs; `FONT-POLICY-001-ClosedNoAction.md` explicitly records 'remain... as reusable tooling and
  evidence'") applied to the 10 `*-rater-*.html` files too, but that call was overridden by direct
  instruction — see §3a. `tools/font-generator/build_rater_tool.py` (kept, out of this milestone's
  scope) still targets a now-deleted path (`review/FONT-DECISION-001-rater.html`) if ever re-run;
  not fixed here since the script itself is untouched, out-of-scope infrastructure.

## Full accounting — kept, needs a human decision

- `tools/font-generator/build_rater_tool_portfolio001.py`
- `tools/font-generator/build_rater_tool_baloo2_untested_sizes.py`
- `tools/font-generator/render_portfolio001.py`
- `tools/font-generator/render_portfolio001_baloo2_untested_sizes.py`

No `docs/specifications/FONT-PORTFOLIO-001-*.md` file exists to confirm findings-captured per the
task's own deletion criteria, even though the closely-related `FONT-POLICY-001` docs summarize
the headline finding. Sasha should decide whether that indirect coverage is sufficient, or whether
these four (and the `review/FONT-PORTFOLIO-001-rater-*.html` outputs they produced) should get a
dedicated `FONT-PORTFOLIO-001-*.md` spec doc before any future deletion pass.
