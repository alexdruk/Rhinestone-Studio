# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RC-010 — Review Assets Regeneratability Audit (gated, two-phase)

---

# Status

IMPLEMENTED — Phase 1 only. **Gate not satisfied. No deletion performed.**

---

# Branch

chore/review-assets-regeneration-audit (cut from `develop` at RC-009's tip, `24e5d43`)

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

Audited whether `review/` (4 HTML report pages + 442 curated PNGs, ~20 MB) is regeneratable from
current repository tooling. **It is not.** The script that built the HTML pages and selected the
curated PNG subset, `tools/font-generator/build_review_html.py`, was deleted by `RC-009` and no
other script in the repository performs its templating/curation function. Reconstructing it is
explicitly out of scope for this milestone even though the gate would otherwise plausibly pass on
every other axis (the underlying data survives, the curation logic was fully algorithmic and
recoverable from git history, and the current `review/` content is confirmed unchanged since it
was last regenerated). Per the task's own instructions, this is reported as "blocked on missing
tooling" rather than worked around by writing new tooling. **Gate condition 1 fails. Nothing was
deleted; `review/` is untouched.**

---

## 1. `build_review_html.py` — confirmed absent, and what it did

Deleted in `RC-009` (commit `24e5d43`), along with 10 other milestone-named scripts, per that
milestone's own accounting (`git log --follow --diff-filter=D -- tools/font-generator/
build_review_html.py` shows exactly one deleting commit, `24e5d43`). No script of that name, or
performing an equivalent function, exists anywhere in the current tree
(`grep -rln "REVIEW_ASSETS\|REVIEW_ROOT" tools/` matches only `paths.py` — which just defines the
constants — and the two `build_rater_tool_*` variants kept by RC-009, which build the
self-contained *rater* HTML files, a different artifact from the `FONT-GEN-*-review.html` pages).

Read the script's last committed version in full (`git show 24e5d43^:tools/font-generator/
build_review_html.py`, 411 lines). It did two distinct things:

1. **HTML templating** (`build_size_panel`, `main`): pure, mechanical string formatting from
   already-computed JSON — metric cards, verdict badges, tables — into one static file per
   milestone (`review/FONT-GEN-00{1,2,3,4}-review.html`). No judgment calls; this part really is
   "just templating."
2. **PNG curation** (`build_assets_for_size`): for each size, selects `wanted = worst_ids |
   required_ids | representative_ids` —
   - `worst_ids`: the precomputed `summary["generated"]["worst"]` list (already stored in the
     committed `summary.*.json` files — the *selection*, not just the raw scores, is persisted).
   - `required_ids`: every case flagged `isRequiredPhrase` in `evaluation.*.json` (also persisted).
   - `representative_ids`: the first 4 cases in `evaluation.*.json`'s `generated` list with
     `heightLabel == "mid"`, no error, and `charAccuracy >= 0.95` — deterministic given the JSON's
     row order, but that order is not independently re-verified as stable under a fresh pipeline
     run (see §2).

   For each selected case, it re-measures stone positions on demand via `measure.mjs` (evaluation
   JSON intentionally excludes stone positions to keep `generated-fonts/` metadata-only — see the
   script's own `fetch_stones` docstring) and renders a PNG via `lib/render_stones.py`.

**Conclusion**: contrary to the docs' "curated subset" phrasing suggesting a manual/human choice
(see §3), the actual selection was 100% algorithmic — driven by data already present in committed
JSON files, not a one-time hand-pick. This matters for §3's gate condition, but does not change the
outcome: the *algorithm* only exists as dead git history now; nothing currently in the tree runs
it.

---

## 2. Underlying data — still exists, itself plausibly regeneratable

`generated-fonts/<SIZE>/` still contains, for all 4 relevant families (`Sacramento`, `Baloo2`,
`Baloo2Variable`, `SacramentoSkeleton`) and all 5 sizes: `evaluation.*.json`, `summary.*.json`,
`generation-metadata.*.json`, and the `.ttf` variant files themselves (confirmed via `ls
generated-fonts/SS10/`). These are exactly the three inputs `build_review_html.py` reads
(`load_size_data`).

`tools/font-generator/pipeline.py` (produces `evaluation.*.json`) and `analyze.py` (produces
`summary.*.json` from it) both still exist and are the live, general-purpose, non-milestone-named
core of the font-generation tooling (confirmed kept by `RC-009`, still imported/referenced by
`generate.py`, `measure.mjs`, `tests/`). `render_stones.py` (used for the actual PNG rasterization)
also still exists and — confirmed by reading it — already carries the `FONT-GEN-005` orientation
fix (`yMm` is Y-down, no flip; matches `CanvasRenderer2D.js`'s convention per its own comment at
`tools/font-generator/lib/render_stones.py:51-55`).

So: **the raw measurement/evaluation data pipeline is independently regeneratable** using tooling
that still exists — this part of the gate would plausibly pass on its own. (Not actually re-run:
`generated-fonts/` is explicitly off-limits for this milestone, and re-running would write into
it. This is a code-inspection conclusion, not a verified execution.)

This confirms the gap is narrow and specific: it is the HTML-templating-plus-curation step alone
that has no surviving tool, not the underlying evaluation data.

---

## 3. PNG curation — algorithmic and recorded, but not currently executable

`docs/specifications/FONT-GEN-001-ProceduralSacramentoRhinestoneFamily.md:303` states: "Review
images: `review/assets/<SIZE>/*.png` (208 PNGs, curated subset only — not every corpus item, per
the brief's exception-focused requirement)." Read in isolation this sounds like a one-time human
curation choice with no record — the premise this milestone was told to treat with skepticism.

Having read the deleted script (§1), the actual mechanism was fully deterministic code
(`worst_ids | required_ids | representative_ids`, per size), and its two data-driven inputs
(`worst`, `isRequiredPhrase`) are themselves already persisted in the still-existing
`summary.*.json`/`evaluation.*.json` files. So the *selection* is, in principle, reproducible —
but only by running that exact algorithm again, and that algorithm now exists solely as recoverable
git history (`git show 24e5d43^:tools/font-generator/build_review_html.py`), not as a file in the
working tree. Reconstructing it — even faithfully, even copy-pasted from git history — is writing
a new script back into the tree, which `TASK.md` explicitly rules out for this milestone regardless
of whether doing so would make the gate pass.

**No further, independent, human-authored curation record exists beyond the algorithm itself** —
checked `generated-fonts/*/summary.*.json` (holds `worst` id lists, no PNG filenames),
`docs/specifications/FONT-GEN-00{1,2,3,4}-*.md` (name the *effect*, "curated subset," never a file
list), and there is no `docs/specifications/FONT-GEN-REVIEW-*.md` or similar recording exact PNG
filenames chosen. There is nothing to lose by not reconstructing the script — the record of *how*
the choice was made is in git history regardless of whether `review/` itself survives.

---

## 4. Actual regeneration attempt — not performed (correctly blocked per task instructions)

Per `TASK.md` step 4: "If reconstructing `build_review_html.py` would be required first, do NOT
write that script as part of this milestone... Report that reproducibility is blocked on missing
tooling instead." Steps 1–3 above show reconstruction of that script is exactly what would be
required — no scratch-space regeneration attempt was made, since doing so would require writing
the disallowed script. This is not a shortfall in the audit; it is the audit correctly stopping at
the boundary the task itself drew.

---

## 5. Spec-doc references to `review/` — point-in-time evidentiary claims found

`grep -n "review/" docs/specifications/*.md` was checked file by file. Two categories of claim:

- **Path citations** (not evidentiary claims about content, just references to where output
  lives): `FONT-GEN-002/003/004-*.md` (`review/assets/<family>/<SIZE>/*.png` file locations),
  `FONT-DECISION-001-*.md` (rater HTML file paths — those files were already deleted by `RC-009`),
  `FONT-POLICY-001-ClosedNoAction.md:70` (already corrected by `RC-009` to describe the rater
  files/scripts as removed).
- **A genuine point-in-time evidentiary claim**,
  `docs/specifications/FONT-GEN-005-OCRRenderOrientationBugFix.md` §6/§7: after fixing the render
  orientation bug, this milestone states "Review HTML pages and PNGs were regenerated for all 4
  milestones (`review/FONT-GEN-00{1,2,3,4}-review.html`, `review/assets/**`) and are now correctly
  oriented" — and explicitly scopes what was *not* re-verified beyond that regeneration. This is a
  claim about the *specific committed files*, verified once (at `FONT-GEN-005`, commit `7673e83`),
  not something safely re-derivable later by an independent regeneration — a future regeneration
  attempt (even a hypothetically successful one) would produce *a* correctly-oriented HTML/PNG set,
  but would not, on its own, re-establish that it is *the same* set this spec doc's before/after
  analysis was performed against.

  Confirmed via `git log --oneline -- review/` that no commit has touched
  `review/FONT-GEN-00{1,2,3,4}-review.html` or the 442 PNGs they reference since `7673e83`
  (`FONT-GEN-005`) other than `RC-009` removing the *unreferenced* 596-file remainder of
  `review/assets/` — i.e. the currently-committed 4 pages + 442 PNGs are still exactly
  `FONT-GEN-005`'s corrected output. Spot-checked: each page's embedded `<img src="assets/...">`
  count (103/111/121/107 = 442) matches `review/assets/`'s file count exactly, with zero orphans
  and zero missing images.

- `docs/specifications/ARCH-REVIEW-001-FullArchitectureAndCodebaseReview.md:204-268,404` describes
  `review/` (at 96 MB, pre-`RC-009`) as "real historical record, not scratch output" and defers a
  keep-vs-archive call to a human — consistent with treating it as evidence, not disposable cache.

---

# GATE VERDICT: **NOT SATISFIED — no deletion performed**

| Condition | Result |
|---|---|
| Regeneratable using only tooling that exists right now, no new script | **FAILS** — `build_review_html.py` (HTML templating + PNG curation/selection) does not exist and no other script performs its function (§1). Underlying evaluation data alone is plausibly regeneratable (§2), but that is not the full deliverable. |
| Every regenerated file byte-identical / functionally identical to committed | Not evaluated — blocked by the above; no regeneration was attempted (§4). |
| No hand-editing beyond the known, recorded curation step | The curation step is confirmed algorithmic and recorded only in git history (§3), not hand-editing — but this doesn't rescue the first condition. |
| No spec doc cites `review/` as point-in-time evidence undermined by future regeneration | **FAILS** — `FONT-GEN-005-OCRRenderOrientationBugFix.md` §6/§7 makes exactly this kind of claim about the current committed files (§5). |

**Two of four conditions fail.** Per `TASK.md`'s gate rule ("Proceed to Phase 2 only if ALL of the
following hold" / "when in doubt, fail closed"), Phase 2 is skipped entirely. `review/` and
`review/assets/` are untouched. No file was deleted, no doc reference was changed, no new spec doc
was written.

---

# Verification

- `find review/assets -type f -name "*.png" | wc -l` → 442; `find review/assets -type f -not -name
  "*.png"` → one untracked `.DS_Store` (`git ls-files` confirms not tracked), no other stray files.
- Each `review/FONT-GEN-00{1,2,3,4}-review.html`'s unique `assets/*.png` reference count
  (103+111+121+107 = 442) exactly matches the PNG count on disk — no orphaned or missing images.
- `git log --oneline -- review/` — last content-changing commit is `7673e83` (`FONT-GEN-005`);
  `24e5d43` (`RC-009`) only removed already-unreferenced files, confirmed by the count match above.
- `git status` / `git diff --stat` confirm no repository files outside `TASK.md`/`TASK_RESULT.md`
  were modified by this audit.
- Did not run `npm test` / `npm run test:full` — no `src/**`, `app.js`, `index.html`, exporter, or
  project-schema changes were made; this milestone made zero code changes.

---

# Recommended next step

Not a next step this milestone should take (out of scope by its own rules), but worth recording
for whoever picks up `review/`'s eventual fate: if `review/` is ever meant to go away, the two
realistic paths are (a) accept losing exact regeneratability and rewrite
`build_review_html.py` from scratch as a deliberate, scoped tooling milestone — its templating
half is genuinely mechanical, and its curation half's exact algorithm is fully recoverable from
`git show 24e5d43^:tools/font-generator/build_review_html.py` — or (b) keep `review/` as
permanent historical record, matching how `ARCH-REVIEW-001` already treats `fonts/review/`/
`fonts/comparison/`. Either is a real product decision for Sasha, not something this audit should
default into.
