# MAINT-007 — Chrome 103 Browser Baseline

**Status:** IMPLEMENTED
**Branch:** `feature/maint-007-chrome-103-baseline` (cut from `develop`)
**Scope:** Product-definition module format, a new architecture guard test, and documentation. No
geometry/rendering/export logic changed.

---

## 1. Context

Rhinestone Studio must run on an old Mac: macOS Sierra 10.12.6, whose last available Chrome is
103.0.5060.134.

Measured against `develop` at `ef190d0` in a real Chromium 103.0.5058 build:

- The app did not start at all: `SyntaxError: Unexpected token 'with'`. The cause was four JSON
  imports using import attributes (`with { type: 'json' }`), a syntax Chrome only gained in 123.
- With only those four imports converted to plain `.js` modules, the app loaded with zero page
  errors, every panel (Text, Shapes, Monogram, Image, Export, Production Sheet, Settings, Design)
  opened with zero errors, and all 107 tracked `src/*.js` modules loaded via dynamic `import()`
  with zero failures.

No other Chrome-103-incompatible construct was found in the app's own source.

## 2. Decision

Chrome 103 is the project's minimum supported browser. See CLAUDE.md's "Browser baseline
(MAINT-007)" section for the standing rule.

## 3. What changed

- `src/products/definitions/{plate-round-dinner,vessel-standard-mug,vessel-standard-tumbler,
  vessel-standard-bottle}.json` were replaced by sibling `.js` files, each `export default` of the
  same data, unchanged in meaning (verified with `tools/scratch/maint-007-equality.mjs`, a
  deep-equality diff against the JSON as it existed at `ef190d0`; not committed).
- `PlateProductDefinition.js` and `VesselProductDefinition.js` import the `.js` modules directly
  (no `with`/`assert` clause).
- Prose referencing the old `.json` filenames was updated in both of those files' headers, in
  `index.html`, and in `docs/ARCHITECTURE.md`. `docs/specifications/**` historical records were
  left untouched.

## 4. The guard: `tools/test-browser-baseline.mjs`

Scans every `.js` file under `src/`, plus `app.js` and `index.html`, for a fixed set of regex
patterns matching JS/CSS syntax newer than Chrome 103 (import attributes, `Array`/`Object`/`Map`/
`Promise`/`URL`/`AbortSignal`/`String` methods added after Chrome 103, and CSS `:has()`,
`@container`, `container-type`, `color-mix()`, `oklch()`/`oklab()`, `light-dark()`, dynamic
viewport units, `text-wrap`, `subgrid`, `@scope`, `@starting-style`). It fails with `file:line` on
any match. To avoid passing vacuously, it also asserts each pattern matches a synthetic positive
sample of itself, and that the scan covered at least 100 files.

It is registered in `tools/test-groups.mjs`'s `architecture` and `fast` groups.

### Deliberately not covered

- **Set methods** (`.union()`, `.intersection()`, `.difference()`, etc.) — not scanned, because
  Paper.js's own `Rectangle.union()` is used legitimately in this codebase and a naive `.union(`
  pattern would false-positive on it. A future pass could special-case `Set.prototype` receivers,
  but no such usage exists today, so it wasn't built.
- **CSS nesting** (`&` selectors) — not scanned; not present in this codebase's CSS today, and a
  reliable pattern would need real CSS parsing rather than a regex.
- Any Chrome-103+ feature not in the pattern list above (this is a targeted guard: the pre-merge
  scan found only the import-attribute syntax; the other patterns are preventive, not an
  exhaustive compatibility linter).
