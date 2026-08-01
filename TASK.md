# Task

**Task ID:** RC-010
**Task Type:** Audit (Gated, two-phase) — Review Assets Regeneratability
**Status:** IMPLEMENTED (Phase 1 only — gate not satisfied)
**Branch:** chore/review-assets-regeneration-audit

## Goal

`review/` (repo root, ~20 MB) contains 4 HTML report pages
(`FONT-GEN-001-review.html` through `FONT-GEN-004-review.html`) and `review/assets/` (442 PNGs)
they link to via relative `<img src>`. These survived `RC-009`'s file-structure cleanup because
they were confirmed genuinely referenced. This milestone determines whether that surviving content
is actually regeneratable from current repository tooling — and if, and only if, it genuinely is,
replaces it with a regeneration doc and deletes it. Given `RC-009` already deleted
tools/font-generator/build_review_html.py (the script that built these HTML pages) as an
unimported, milestone-named script, the honest answer may well be "not regeneratable" — that is a
fine, complete outcome for this milestone.

## Required Outcome — Phase 1 (Audit)

1. Confirm `build_review_html.py`'s absence and determine, from its last committed version, exactly
   what it did: pure templating from data produced elsewhere, or something requiring judgment
   calls (e.g. curation).
2. Identify what data still exists that the script would have templated
   (`generated-fonts/*/evaluation.*.json`, `summary.*.json`, etc.), and whether that data is itself
   independently regeneratable from `fonts/sources/` + `generated-fonts/` + current tooling.
3. For the PNG curation question: determine whether the selection of the curated PNG subset is
   recorded somewhere deterministic (making it reproducible) or was a one-time choice with no
   record.
4. Only if steps 1–3 suggest genuine reproducibility is plausible: attempt an actual regeneration
   of the full set into scratch space and diff against committed. Do NOT write a replacement for
   `build_review_html.py` to make this possible — that is new tooling work, out of scope for an
   audit. If reconstruction would be required, report reproducibility as blocked on missing
   tooling instead.
5. Check every `docs/specifications/*.md` reference to `review/` or `review/assets/` for a
   point-in-time evidentiary claim.

## GATE

Proceed to Phase 2 only if ALL of the following hold:

- The full pipeline (data + HTML + the specific curated PNG subset) can be regenerated using ONLY
  tooling that exists in the repository right now, with no new script needing to be written.
- Every regenerated file is byte-identical or functionally identical to committed.
- No hand-editing found beyond the already-known, already-recorded curation step (if reproducible).
- No spec doc cites `review/` content as point-in-time decision evidence in a way undermined by
  relying on future regeneration.

If not fully satisfied: stop, delete nothing, write `TASK_RESULT.md` with Phase 1 findings and an
explicit "gate not satisfied" statement naming which condition failed. Skip Phase 2.

## Required Outcome — Phase 2 (only if gate passed)

1. Write docs/specifications/FONT-GEN-REVIEW-REGENERATION.md with exact, copy-pasteable
   regeneration command(s), plus a dated verification note.
2. Delete `review/` (HTML pages + `review/assets/`) in full.
3. Grep the whole repo for references to the `review/` path and update each to point at the new
   regeneration doc, without altering the substance/findings of any spec doc.

## Rules

- Do not touch `fonts/review/`, `fonts/sources/`, or `generated-fonts/` — out of scope, decided
  separately.
- No `src/**`, `app.js`, `index.html` changes.
- Writing a new script to reconstruct `build_review_html.py`'s functionality is explicitly out of
  scope, even if it would make the gate pass.
- Any scratch/temp regeneration output must go outside the repo/gitignored, never committed.
- When in doubt at the gate, fail closed.

## Deliverables

- `TASK.md` (this file).
- `TASK_RESULT.md` — Phase 1 findings, explicit gate pass/fail verdict, and (if Phase 2 ran) what
  was deleted and what doc references were fixed.
