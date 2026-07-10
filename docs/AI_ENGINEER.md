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

Always run:

```bash
npm test
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