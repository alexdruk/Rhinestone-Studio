# Rhinestone Studio — AI Engineer Rules

## Source of Truth

The live repository is the source of truth.

Before changing code, inspect the relevant files, current tests, current task, and recent implementation report.

Do not rely on an older chat description when it conflicts with the repository.

---

## Engineering Objective

Build Rhinestone Studio as a maintainable product, not as a sequence of visual demos.

The geometry model remains the source of truth:

```text
Project data in millimeters
→ GeometryEngine
→ StoneLayout in millimeters
→ 2D production view
→ 3D preview
→ exporters
```

Rendering must not become the source of geometry.

---

## Scope Discipline

Follow `TASK.md` and its referenced specification.

Make the smallest coherent change that completes the milestone.

Do not:

- refactor unrelated code,
- rename unrelated APIs,
- reformat large untouched files,
- add dependencies without need,
- start the next milestone,
- replace working architecture with a parallel implementation.

When a conflict exists between `TASK.md`, the specification, and the repository, stop only for a blocking architectural contradiction. Otherwise document the discrepancy in `TASK_RESULT.md` and use the most recent explicit milestone direction.

---

## Implementation Workflow

For each milestone:

1. inspect the repository,
2. draft or update the specification,
3. write `TASK.md`,
4. implement,
5. add or update tests,
6. run required checks,
7. perform browser/manual verification where applicable,
8. complete `TASK_RESULT.md`,
9. create a logical commit,
10. push the branch.

A separate specification-review-only phase is not required unless `docs/MILESTONE_WORKFLOW.md` classifies the work as requiring one.

---

## Testing

Automated tests must verify behavior and architecture, not only exact source text.

Tests run via `tools/run-tests.mjs`, a maintainable runner that discovers `tools/test-*.mjs` files
automatically, continues past individual failures, and prints a pass/fail summary — see
`docs/specifications/CI-001-RealTestExecution.md` for its original design and
`docs/specifications/MAINT-002-TestExecutionTiers.md` for the three-tier execution model layered on
top of it:

- **Tier 1 — `npm test` (fast development).** A curated ~24-file subset (`tools/test-groups.mjs`'s
  `fast` group), one high-value representative per subsystem plus every architecture guard. This is
  the loop to run while iterating on a change.
- **Tier 2 — one subsystem at a time**, via `npm run test:geometry`, `test:exporters`, `test:ui`,
  `test:products`, `test:security`, `test:documentation`, `test:autosave`, or any other subsystem
  script (equivalent to `node tools/run-tests.mjs --group <name>`) — every subsystem
  `tools/test-groups.mjs` defines is independently runnable this way; see that file for the full
  list. Use the group(s) covering the area you're touching.
- **Tier 3 — `npm run test:full`** (`--all`, every `tools/test-*.mjs` file, including the two
  `EXCLUDED_FROM_DEFAULT` legacy `CupRenderer.js` suites). CI (`.github/workflows/ci.yml`) runs this
  on every push and pull request. Also required before merge approval, any shared-architecture
  change, and release validation.

During implementation, run Tier 1/Tier 2 as you go rather than the full suite after every edit. Run
`npm run test:full` once, when the milestone's implementation is finished and ready for review; a
normal small milestone does not need repeated full-suite runs after every commit. A milestone that
changes the test runner, `tools/test-groups.mjs`, or CI workflow itself is the case where a
`test:full` run is most load-bearing — do not skip it even if every touched file passed standalone.

Before committing, always run:

```bash
git diff --check
git status
```

Run these when available or applicable:

```bash
npm run build
npm run dev
```

For browser work, verify:

- page loads,
- modules resolve,
- no relevant console errors,
- expected output appears,
- important controls still work,
- MIME types are valid for modules when relevant.

Do not claim a manual test that was not performed.

A passing automated suite does not replace user-visible verification.

---

## Dependencies

Prefer existing dependencies and browser-native capabilities.

Do not add a dependency unless it materially reduces risk or complexity.

Do not repeatedly ask the user to reinstall dependencies when no dependency changed.

Do not use a public CDN for production runtime dependencies unless the architecture explicitly approves it.

Never modify files inside `node_modules/**`.

---

## Architecture Boundaries

Keep these concerns separate:

- project model,
- font loading,
- vector path extraction,
- stone generation,
- rendering,
- UI state,
- exporting.

Permanent geometry, text, renderer, and exporter modules must not depend on DOM controls unless the architecture explicitly assigns them that responsibility.

Use millimeters for production geometry.

Preserve deterministic output where deterministic output is expected.

---

## Documentation

Update only documentation needed for the milestone.

`TASK_RESULT.md` must honestly report:

- what changed,
- commands run,
- tests passed or failed,
- browser/manual verification,
- visible changes,
- warnings,
- known limitations,
- recommended next milestone.

Do not present unverified behavior as passing.

---

## Git

Prefer one logical commit per milestone.

Use the task's required commit message when specified.

Before committing:

```bash
git diff --check
git status
```

After committing:

```bash
git log -1 --oneline
git push
```

Do not merge unless the human owner or ChatGPT explicitly directs it.