# Rhinestone Studio

Rhinestone Studio is a manufacturing-first design tool for rhinestone decoration on physical products such as mugs, bottles, tumblers, candles, and phone cases.

## Current status

Version 1.0 is feature-complete and under feature freeze: no new features are being added, only
fixes and documentation/stabilization work (see `docs/PRODUCT_ROADMAP.md`). Gallery and Design
Library exist and remain in the codebase but are temporarily disabled in the UI for this release
(`S-103`, `RC-006`).

For the authoritative, continuously-updated description of what is implemented, see
`docs/ARCHITECTURE.md` (implementation status is recorded per section) and
`docs/specifications/` (one file per milestone). Do not rely on a milestone name or number in prose
elsewhere in this file — it will drift; those two locations are the source of truth.

## Core principle

One source of truth:

```text
Project JSON / Project model
        ↓
Geometry Engine
        ↓
StoneLayout in millimeters
        ├─ 2D production view
        ├─ 3D preview
        └─ exports
```

Renderers and exporters must never generate stones themselves.

## Repository structure

```text
src/                  application code
assets/               fonts, models, textures, HDR assets
examples/             golden project files
docs/                 architecture, ADRs, specifications, QA process
tools/                developer scripts
.github/workflows/    CI automation
```

## Development

This repository is intentionally being built in small, reviewable commits.

Initial local setup:

```bash
git clone https://github.com/alexdruk/Rhinestone-Studio.git
cd Rhinestone-Studio
npm install
```

Run the app locally (a static file server; the app itself is a browser-only ES module app with no
build step):

```bash
npm run dev
# open http://localhost:5173
```

### Supported browsers

Chrome 103+ (see `docs/specifications/MAINT-007-BrowserBaseline.md` for the
minimum-baseline rationale and what it covers).

### Older Macs (e.g. macOS Sierra)

`npm run dev` shells out to `python3`, which isn't available on some older
macOS installs (Sierra lacks it, but ships Python 2 built in).

With Node available on that Mac, run the two commands below, then open
http://localhost:5173.

```bash
npm ci --omit=dev
python -m SimpleHTTPServer 5173
```

Without Node on that Mac, run `npm ci --omit=dev` on another machine and
copy the whole project folder, including `node_modules`, over to the old
Mac. On the old Mac, run only `python -m SimpleHTTPServer 5173`, then open
http://localhost:5173.

Run the automated test suite (plain Node scripts under `tools/test-*.mjs`, no browser required):

```bash
npm test
```

`npm test` runs a fast, curated subset for day-to-day development. A subsystem script such as
`npm run test:geometry` or `npm run test:ui` runs just that area, and `npm run test:full` runs
everything — see `docs/AI_ENGINEER.md` for the full tiered-testing model.

### Git hooks

This repo ships a `pre-merge-commit` hook in `.githooks/` that runs the full suite
(`node tools/run-tests.mjs --all`) and aborts the merge if anything fails. CI only runs on
`develop` and `main`, so without this hook a broken feature branch is only caught *after* its
merge commit has already landed. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

One blind spot: when a merge stops for conflict resolution, git runs `pre-commit` rather than
`pre-merge-commit`, so a conflicted merge still needs a manual `node tools/run-tests.mjs --all`
before you finish it.

See `docs/AI_ENGINEER.md` and `docs/MILESTONE_WORKFLOW.md` for the full development/testing/review
workflow, and `CONTRIBUTING.md` for commit conventions.
