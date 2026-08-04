# Contributing to Rhinestone Studio

## Development rules

1. The Geometry Engine is the only system allowed to generate stone positions.
2. All geometry and production data is stored in millimeters, not pixels.
3. Renderers display StoneLayout data; they do not create or modify it.
4. Exporters consume StoneLayout data; they do not create or modify it.
5. Products are plugins that map neutral layout coordinates to product surfaces.
6. Every milestone must include a release note, test report, and QA checklist.

## Commit style

Use Conventional Commits:

```text
feat(fonts): add font manager
feat(geometry): add centerline sampler
fix(renderer): attach mug handle to body
docs(adr): define geometry engine ownership
test(geometry): add stone spacing tests
chore(repo): initialize repository structure
```

For a milestone tracked under `docs/specifications/` (an `RS-xxxx`, `S-xxx`, `SEC-xxx`, `ARC-xxx`,
or `CI-xxx` id) or a release-candidate fix (`RC-xxx`), prefix the subject with that id instead,
e.g. `RC-005: add autosave & crash recovery` or `S-112: Round Dinner Plate real product template`.
Both styles appear in this repository's history; use whichever id form applies to the change.

## Quality gate

Do not merge a milestone if there are open critical or major regressions.
