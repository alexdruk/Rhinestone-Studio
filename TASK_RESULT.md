# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RC-007 — Documentation Cleanup

---

# Status

IMPLEMENTED

---

# Branch

feature/rc-007-documentation-cleanup (cut from `develop`, per this milestone's "do not merge"
instruction — not pushed to be merged, review only).

---

# Commit

Do not write the current commit hash into this file — this file is part of the same commit it
describes. Obtain it from Git history with:

```bash
git log -1 --oneline
```

---

# Audit Summary

Version 1.0 is under feature freeze (`RC-006`). Audited every file under `docs/**`, `README.md`,
`CONTRIBUTING.md`, and the root task-tracking files (`TASK.md`, `TASK_RESULT.md`,
`SPEC_REVIEW_RESULT.md`) against the live repository (source tree, `package.json`, `git log`,
`docs/specifications/**`).

The most useful lead was `docs/specifications/RS-2000A-PostMVPAudit.md` — an internal audit from
several milestones ago that already flagged `docs/BACKLOG.md`/`docs/PRODUCT_ROADMAP.md` as stale
("Curved Text/SVG Import/Undo-Redo are marked 'Planned' despite being done since RS-1002/1003") and
recommended a cheap follow-up pass. That follow-up was never done — `git log --follow` shows
neither file was touched since the initial commit that added them. This is very likely the "release
audit" this milestone refers to.

Findings, in order of severity:

1. **`README.md`** was still describing the repository-foundation/M2.2 era ("first production
   milestone is M2.2 — Vector Text Engine", "No npm dependency is required") despite ~170 commits
   and a feature-complete, feature-frozen Version 1.0 since.
2. **`docs/BACKLOG.md`/`docs/PRODUCT_ROADMAP.md`** marked Curved Text, SVG Import, and Multi-Object
   Support as "Planned"/undated, though all three shipped (RS-1003/RS-1001/RS-1004) — the exact
   staleness `RS-2000A-PostMVPAudit.md` identified and was never fixed.
3. **`docs/release-process/progress-dashboard.md`** still showed the M2.2-era snapshot (current
   milestone `M2.2`, branch `feature/m2-vector-text`, most modules at 0%) as if it were current,
   though every listed 0% item (OpenType provider, product plugin system, professional renderer,
   manufacturing exports) is long since implemented per `docs/ARCHITECTURE.md`.
4. **`docs/ARCHITECTURE.md`** (the actively-maintained, otherwise well-kept authoritative doc)
   contained two internal self-contradictions: its own "Future Direction" and "Current
   Architectural Limitations" sections still listed the product-plugin system and the 3D/WebGL
   renderer as "not started"/"does not exist yet", directly contradicted by that same document's
   "Product Plugins" and "Renderer" sections a few hundred lines earlier (implemented by RS-1004
   and RS-1006). It also cited `tools/test-undo-redo-integration.mjs` as a live structural test
   guard; that file was deleted by S-111 (confirmed against `docs/specifications/
  S-111-TestSuiteRationalization.md` and the live `tools/` directory).
5. **`SPEC_REVIEW_RESULT.md`** (repo root) was an orphaned, unreferenced one-off spec-review
   artifact for `RS-0003.5B2`, a milestone merged long ago. Unlike `TASK.md`/`TASK_RESULT.md`, it
   has no defined ongoing role in `docs/MILESTONE_WORKFLOW.md`'s "Repository Documents" list, and
   nothing in the repository references it.
6. **`TASK.md`** (repo root) still described `S-112` (Round Dinner Plate), a milestone merged four
   milestones ago (`S-112` → `S-112A` → `CI-001`/`CI-001A` → `SEC-001` → `ARC-001` → `RC-002`
   through `RC-006`), as if it were "the current milestone implementation task" — the exact role
   `docs/MILESTONE_WORKFLOW.md`'s "Repository Documents" section defines for this file.
7. **`CONTRIBUTING.md`**'s commit-style section only documented the Conventional Commits form
   (`feat(scope): ...`); actual history for the last ~20 milestones predominantly uses a
   milestone-id-prefixed form instead (`RC-005: add autosave & crash recovery`,
   `S-112: Round Dinner Plate ...`) that the doc never mentioned.

Not changed (checked and found accurate, or already correctly self-documented as historical):
`docs/MILESTONE_WORKFLOW.md`, `docs/AI_ENGINEER.md`, `docs/CLAUDE_GUIDE.md`,
`docs/REVIEW_CHECKLIST.md`, `docs/PRODUCT_VISION.md`, `docs/PRODUCT_PRINCIPLES.md`,
`docs/WONT_BUILD.md`, `docs/development/ClaudeUsage.md`, `docs/release-process/release-gate.md`,
`docs/release-process/commit-package-standard.md`, `docs/testing/**`, `docs/templates/**`,
`docs/architecture/architecture.md` and `docs/adr/ADR-0001-*.md` (both already explicitly marked
non-authoritative/superseded inside `docs/ARCHITECTURE.md`'s own "Repository Documentation Note"),
and every file under `docs/specifications/**` (dated, point-in-time milestone records — historical
by design, not living status docs; RC-006's own freeze of Gallery/Design Library is already
recorded where it happened, in the RC-006 commit and `index.html`'s disabled-button markup, so nothing
retroactive was needed in `docs/specifications/RS-1015-DesignLibrary.md`/`RS-2001-*.md`).

No application code, `app.js`, `index.html`, or `style.css` was touched. No application-code
comment was found to be demonstrably incorrect, so none was changed.

---

# Documentation Updated

* `README.md` — replaced the stale "Repository foundation / M2.2" status paragraph with an
  accurate Version-1.0-feature-freeze summary that points to `docs/ARCHITECTURE.md`/
  `docs/specifications/` as the source of truth instead of restating a status that will drift
  again; replaced "No npm dependency is required" with real `npm install`/`npm run dev`/`npm test`
  setup instructions matching `package.json`.
* `CONTRIBUTING.md` — added a short paragraph documenting the milestone-id-prefixed commit form
  actually used by most recent history, alongside the existing Conventional Commits form.
* `docs/BACKLOG.md` — marked Curved Text/SVG Import/Multi-Object Support "Done" with their spec
  ids, and added a one-line note pointing to `docs/ARCHITECTURE.md` as the actively-maintained
  status source (this file is not touched per-commit).
* `docs/PRODUCT_ROADMAP.md` — marked every Version 1.0 item "done", added the feature-freeze
  context (`RC-006`, `S-103`) and clarified that Gallery/Design Library exist and are only
  UI-disabled, not removed; added the same "not actively maintained" note as `BACKLOG.md`, and
  corrected Version 1.1's status (batch export/print layout genuinely not started; template
  library already exists as the frozen Design Library rather than being new work).
* `docs/release-process/progress-dashboard.md` — added a clear historical-snapshot notice at the
  top (this file was last hand-updated during M2.2 and was never kept current afterward), removed
  the "Current Milestone"/"Current Branch" fields (redundant with `TASK.md`/`git log` and the exact
  kind of field that goes stale the moment it's written), and pointed readers to
  `docs/ARCHITECTURE.md`/`git log` for current status. The historical ASCII progress bars were kept,
  labeled explicitly as a snapshot rather than deleted, per this milestone's "preserve historical
  information... clearly distinguish it from current behavior" requirement.
* `docs/ARCHITECTURE.md` — fixed the "Future Direction" and "Current Architectural Limitations"
  self-contradictions (both now correctly reflect that the product-plugin system and the 3D/WebGL
  renderer are implemented); corrected the stale `tools/test-undo-redo-integration.mjs` citation to
  explain it was deleted by S-111 rather than silently removing the historical reference.
* `SPEC_REVIEW_RESULT.md` — removed (see Audit Summary #5).
* `TASK.md` — rewritten to describe this milestone (RC-007) instead of the long-merged S-112, per
  `docs/MILESTONE_WORKFLOW.md`'s definition of this file's role.
* `TASK_RESULT.md` — this file.

---

# Files Changed

```text
CONTRIBUTING.md                            |   5 +
README.md                                  |  28 +++-
SPEC_REVIEW_RESULT.md                      |  58 -------  (deleted)
TASK.md                                    | 110 +++++--------
docs/ARCHITECTURE.md                       |  22 ++-
docs/BACKLOG.md                            |  10 +-
docs/PRODUCT_ROADMAP.md                    |  26 +++-
docs/release-process/progress-dashboard.md |  26 ++--
tools/test-documentation-consistency.mjs   | 242 +++++++++++++++++++++++++++++  (new)
TASK_RESULT.md                             | (this file, new content)
```

---

# Validation Performed

A new automated check, `tools/test-documentation-consistency.mjs`, was added (plain Node,
`node:assert/strict`, matches every other `tools/test-*.mjs` in this repository — see
`docs/AI_ENGINEER.md`'s testing section). It will join the default `npm test` suite for future
runs (nothing added it to `tools/test-groups.mjs`'s `EXCLUDED_FROM_DEFAULT`), but per this
milestone's explicit instruction, only the new script itself was run this session — `npm test` and
`npm run test:full` were **not** run:

```bash
node tools/test-documentation-consistency.mjs
```

Result: **26/26 checks passed.**

It verifies, over a curated set of "living" process/setup docs (deliberately excluding the dated
`docs/specifications/**` milestone records and `docs/templates/**` placeholders, which legitimately
reference historical/hypothetical paths):

* every listed living doc exists and is readable;
* every repository-path reference inside those docs' code spans resolves to a real file/directory
  (with a separate, narrower regression guard for the one specific dead-file citation found in
  `docs/ARCHITECTURE.md`, since that file's narrative style intentionally cites some deleted paths
  as history and needs a different check than a blind existence scan);
* every `npm run <script>` / `npm <script>` referenced in code spans is a real `package.json`
  script (with an explicit allowance for `docs/AI_ENGINEER.md`'s already-hedged, hypothetical `npm
  run build` mention);
* the README's documented dev-server port matches `package.json`'s `dev`/`start` scripts;
* README and `docs/AI_ENGINEER.md` agree on the primary test command;
* `docs/MILESTONE_WORKFLOW.md`'s "Repository Documents" list only names files that exist;
* `TASK.md` exists (and `TASK_RESULT.md`, when present, is non-empty);
* regression guards for the two specific staleness bugs this milestone fixed: `BACKLOG.md`/
  `PRODUCT_ROADMAP.md` no longer marking shipped features "Planned"/"not started", and
  `ARCHITECTURE.md` no longer contradicting itself on the product-plugin system / 3D renderer.

`git diff --check` was run and reported no whitespace errors.

`git status` was clean after staging (only the files listed above changed).

Browser verification was not performed — nothing in this milestone changes or claims anything
about UI behavior; the one existing UI-behavior claim touched (`RC-006`'s Design Library freeze
description in `docs/PRODUCT_ROADMAP.md`) was cross-checked directly against the live
`index.html` markup (`disabled aria-disabled="true"` + "Coming Soon" badge on `#menuLibrary`) and
matches.

---

# Visible Change

None. This is a documentation-only milestone; the application (`app.js`, `index.html`, `style.css`,
`src/**`) is untouched.

---

# Remaining Documentation Limitations

* `S-110`/`S-110A` (Expanded Shape Library, Smart Shape-to-Text Creation) shipped without a
  `docs/specifications/S-110*.md` file, unlike every other `S-xxx` milestone in this repository.
  Writing a retroactive spec was judged out of scope for a cleanup pass (it would be new
  documentation authored after the fact from reverse-engineered behavior, not a correction of
  existing incorrect text) — flagging it here as a known gap instead.
* `docs/ARCHITECTURE.md`'s "Testing Philosophy" section still says `npm test` runs "twenty-seven
  suites"; the real count is much higher (71 `tools/test-*.mjs` files today). This was left
  unchanged deliberately: the document already states, in the very next paragraph, that "this
  section's suite-count prose predates [CI-001] and is not otherwise updated here, per that
  milestone's own documentation-scope limits" — i.e. it is already explicitly, correctly disclosed
  as a stale snapshot rather than a silent error, so touching it would contradict that document's
  own stated policy rather than a genuine bug.
* No milestone since roughly RS-1013/UI-001/CI-001 (i.e. `SEC-001`, `ARC-001`, the `S-101`–`S-112`
  series, and `RC-001`–`RC-006`) has a corresponding "As of `<id>`, ..." implementation-status
  paragraph added to `docs/ARCHITECTURE.md`, unlike every earlier milestone. Writing accurate,
  narrative-quality entries for roughly fifteen milestones in that document's established style
  would be substantial new technical writing requiring deep verification of each change, not a
  cleanup-scale fix — out of scope here. `docs/specifications/**` remains the accurate,
  per-milestone record for all of them in the meantime; only the two direct self-contradictions
  `docs/ARCHITECTURE.md` already had were fixed.
* The documentation-consistency check is a heuristic (regex-based extraction of backtick/fenced
  code spans), not a markdown-semantic parser. It is deliberately scoped to the "living" docs list
  inside the script; it does not check `docs/specifications/**` prose for the same reason
  `docs/ARCHITECTURE.md` needed a narrower, separate check — that directory legitimately cites
  historical/removed paths throughout by design.

---

# Next Recommended Step

Human/reviewer merge decision for `feature/rc-007-documentation-cleanup` — this milestone was
explicitly instructed not to merge. No functional next milestone is implied by this cleanup pass.
