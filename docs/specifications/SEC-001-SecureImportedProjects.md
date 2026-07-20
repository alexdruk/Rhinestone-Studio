# SEC-001 — Secure Imported Project Rendering

## Goal

Prevent HTML and attribute injection through imported `.rhs` / Project JSON files while preserving
backward compatibility for all well-formed projects. `layer.id` is the one imported field that
reaches `innerHTML` unescaped; every other field that reaches `innerHTML` is either already passed
through the repository's `escapeHtml()` helper or is not user-controlled.

## Audit findings

### Files read

- `app.js` (2267 lines, the sole live-editor entry point — no other file renders application UI)
- `src/gallery/RhsFixtureBridge.js` (`validateRhsProject()`/`toAppProjectShape()`, the second,
  parallel `.rhs` fixture schema used by the Gallery)
- `tools/test-project-model-consolidation.mjs`, `tools/test-object-template-integration.mjs`,
  `tools/test-variable-stone-sizes.mjs` (existing precedent for extracting/testing app.js's pure
  functions under plain Node — app.js cannot be `import()`-ed directly, see "Focused test plan")
- `docs/ARCHITECTURE.md` (project/validation architecture, "Current Architectural Limitations")
- `examples/*.rhs` (every bundled fixture, checked against the new id pattern — see "Backward
  compatibility")

### Import paths into `project`

There are exactly two ways a JSON payload becomes the live `project` object, and both terminate in
`app.js`'s own `validateProject()`:

1. **Direct Project JSON import** (`#importProjectFile` change handler, `app.js:1583`):
   `project = validateProject(JSON.parse(await file.text()))`. This is the fully untrusted path —
   the file can be anything a user drags in.
2. **Gallery fixture open** (`app.js:2115-2117`): a bundled `examples/*.rhs` fixture is parsed,
   validated by the separate `validateRhsProject()` (the `.rhs` fixture schema,
   `src/gallery/RhsFixtureBridge.js`), translated to the live schema by `toAppProjectShape()`, and
   then **also** passed through `validateProject()` before becoming `project`. Gallery fixtures ship
   in the repo (`examples/manifest.json`), so this path is lower-risk than (1), but it reaches the
   same rendering code and the same `validateProject()` gate, so the fix in Phase 3 covers it too.

Because both paths converge on `validateProject()`, adding the id-format check there is the single
enforcement point needed; `validateRhsProject()` itself does not need a duplicate check.

### `innerHTML` audit table

| Location (`app.js`) | Interpolated value | Constant or user-controlled | Escaped? | Action required |
|---|---|---|---|---|
| `:208` `populateStoneColorOptions` | `c.id` (attr), `c.name`/`group` (text) | Compile-time (`STONE_COLORS` catalog) | id unescaped, name/group escaped | None — catalog is a static in-repo constant |
| `:217` `populateStoneSizeOptions` | `s.name`, `s.diameterMm` | Compile-time (Stone Size Library) | Escaped / numeric | None |
| `:261` `populateFontOptions` | `f.id` (attr), `f.family` (style attr + text) | Compile-time (`assets/fonts/manifest.json`, bundled) | id/style unescaped, text escaped | None — not imported-project data |
| `:270` `fontLibraryRowHtml` | `f.id` (attr), `f.family` (style attr) | Compile-time (font manifest) | Unescaped | None — not imported-project data |
| **`:690` `renderLayerUI`** | **`l.id`** (`<option value="…">` and `data-layer="…"`) | **User-controlled — imported `layer.id`** | **Unescaped** | **Fix — this is the injection point** |
| `:690` `renderLayerUI` | `layerLabel(l)` (text/title) | User-controlled (`l.text`/`l.svgName`/etc.) | Already escaped via `escapeHtml()` | None |
| `:1142` `updateStats` | layout numbers, `layerLabel(selectedLayer())` | Numeric / already escaped | Escaped or numeric | None |
| `:1954` `renderLibraryGrid` (category filter) | `c` (category string) | Escaped | Escaped | None |
| `:1957` `renderLibraryGrid` (cards) | `item.id` (attr), `item.name`/`item.category` (text) | Design Library entry id — generated internally (`` `${type}${Date.now().toString(36)}${random}` ``, see `src/library/LibraryItem.js:38-39`), never sourced from an imported `layer.id` | id unescaped, name/category escaped | None — not an imported-project value; out of scope per milestone (see "Out of scope") |
| `:2129-2182` Gallery grid/preview | `entry.file`/`category`/`difficulty`/`objectType`/`title` (text/attrs), `thumbnail` (`<img src>`) | `entry.*` from `examples/manifest.json` (escaped); `thumbnail` is a `canvas.toDataURL()` base64 data URL generated internally (base64 alphabet excludes `"`/`<`/`>`) | `entry.*` escaped; `thumbnail` safe by construction | None |

**Conclusion:** `layer.id` is the only user-controlled value reaching `innerHTML` unescaped, and it
reaches it in an HTML attribute context twice in one function (`app.js:690`), exactly matching the
audit conclusion that motivated this milestone.

### Validation findings

`validateProject()` (`app.js:453-509`) already requires `layer.id` to be a non-empty string and
rejects duplicates, but places no constraint on its character set. A crafted import such as
`{"id": "x\" onmouseover=\"alert(1)", ...}` passes validation today and is written verbatim into
two HTML attributes at `app.js:690`.

Every internally generated layer id (`defaultProject()`'s `'text'`; `duplicateLayer()`,
`onCanvasPointerUp` drag-duplicate, and the four "add layer" handlers' `` `${type}Date.now()}` ``
forms) is composed only of a lowercase type name from `SUPPORTED_LAYER_TYPES`/`SHAPE_LIBRARY_KINDS`
and `Date.now()` digits — already a subset of `[A-Za-z0-9_-]`.

### Escaping findings

`escapeHtml()` (`app.js:694`) escapes `&`, `<`, `>`, `"` but not `'`. Every current call site happens
to sit inside a double-quoted HTML attribute or as text content, so an unescaped `'` is not
exploitable today — but the two new `layer.id` call sites this milestone adds escaping to, and any
future single-quoted attribute, would be. Phase 4 closes this gap.

## Threat model

- **Attacker:** a party who can hand the victim a `.rhs` / Project JSON file (e.g. shared as a
  "design"), which the victim opens via **Import Project**.
- **Vector:** a `layers[].id` value containing HTML/attribute metacharacters (`"`, `'`, `<`, `>`),
  designed to break out of the `value="…"` or `data-layer="…"` attribute `renderLayerUI()` writes
  via `innerHTML` and inject a new attribute (e.g. `onmouseover`/`onerror`) or element.
- **Impact:** script execution in the victim's browser session at import time, in the same origin
  as the live editor (no server/backend exists — this is a purely client-side, same-origin app, so
  impact is limited to the victim's own local session/localStorage, not multi-user data).
- **Out of scope for this threat model:** the Design Library's own internally-generated
  `item.id` (never derived from an imported `layer.id`); tampering with `localStorage` directly via
  devtools (self-XSS, no trust boundary crossed); the font manifest and Stone/Color catalogs
  (bundled, compile-time, not part of an imported project file).

## Validation rules

- Every imported `layers[i].id` must match `^[A-Za-z0-9_-]{1,64}$`. Enforced in `validateProject()`
  immediately after the existing non-empty-string check, before the duplicate-id check.
- Invalid ids are rejected with a clear `Error` (repository's existing style — one `throw new
  Error(...)` per rule, naming the layer index, matching every other check in the function), not
  silently rewritten or dropped.
- Every internally generated layer id already satisfies this pattern (see "Validation findings"); no
  id-generation code needed to change.

## Escaping strategy

- Extend `escapeHtml()` to also escape `'` → `&#39;`, so it is safe in single- or double-quoted
  attribute contexts and as text content.
- Wrap both `l.id` interpolations in `renderLayerUI()` (`app.js:690`, the `<option value>` and
  `data-layer` attribute) in `escapeHtml()`. This is defense in depth: Phase 3's validation already
  prevents a hostile id from reaching `project.layers` at all, but every value written into an HTML
  attribute should be escaped regardless of what upstream validation currently guarantees.
- No other call site changes — the audit table above found no other unescaped user-controlled value.
- Rendering approach is unchanged: still `innerHTML` with template-literal interpolation, per the
  milestone's constraint not to introduce a different rendering framework.

## Backward compatibility

- Every `examples/*.rhs` fixture's layer ids were checked against `^[A-Za-z0-9_-]{1,64}$`; all pass
  (they are short lowercase-word ids like `"text"`, `"circle"` — no fixture update was needed).
- Every internally generated id (`defaultProject()`, `duplicateLayer()`, drag-duplicate, the four
  "add layer" handlers) already satisfies the pattern, so no existing user workflow (add, duplicate,
  undo/redo, save/load) can produce a project that a subsequent import would reject.
- A Project JSON exported by this version of the app (via `#exportProjectFile`) always has
  compliant ids, so export → import round-trips are unaffected.
- The only projects newly rejected are ones whose `layer.id` contains characters outside
  `[A-Za-z0-9_-]` — by construction, such a project could never have been produced by this app, so
  no legitimate/previously-working project regresses.

## Out of scope

- Design Library (`item.id`) and Gallery manifest rendering — audited, already safe (see table).
- Any change to geometry, `StoneLayout` generation, exporters, rendering, or product definitions.
- `src/gallery/RhsFixtureBridge.js`'s `validateRhsProject()` — not modified; its output always
  re-validates through `app.js`'s `validateProject()` before becoming `project` (see "Import paths
  into `project`"), so the one enforcement point in Phase 3 already covers this path.
- Broader repository security audit beyond imported-project rendering.
- Rewriting/normalizing invalid ids instead of rejecting them (explicitly disallowed by this
  milestone).

## Focused test plan

New file: `tools/test-project-validation-security.mjs`. `app.js` cannot be `import()`-ed directly
under plain Node (module-level code dereferences `document` at load time), so — matching the
established precedent in `tools/test-object-template-integration.mjs`/
`tools/test-variable-stone-sizes.mjs` — the suite extracts the real `validateProject()`/
`defaultProject()`/`escapeHtml()`/`renderLayerUI()` source via regex from `app.js` and executes it
via `new Function(...)` with its few real dependencies (`getObjectTemplate`, `SHAPE_LIBRARY_KINDS`,
`getPlateDefaults`, `normalizePlateParams`, imported from their real modules) injected as
parameters. Covers:

1. A hostile layer id (`"x\" onmouseover=\"alert(1)"`, plus `<`, `>`, `'`, and an over-length id) is
   rejected by `validateProject()` with a clear `Error`.
2. Every legacy/valid id shape already used by `defaultProject()`/`examples/*.rhs` is accepted.
3. `escapeHtml()` escapes `&`, `<`, `>`, `"`, and `'` (both individually and combined).
4. `renderLayerUI()`'s real, extracted HTML output never contains an unescaped hostile id — both in
   the `<option value>` attribute and the `data-layer` attribute — for a validated project (proving
   the escaping fix at `app.js:690` is real, not just present in source text).
5. `duplicateLayer()`'s and every "add layer" path's generated ids still satisfy
   `^[A-Za-z0-9_-]{1,64}$` (regression guard against a future id-generation change breaking its own
   validation rule).

## Final verification

```bash
node tools/test-project-validation-security.mjs
node tools/run-tests.mjs test-project-model-consolidation
node tools/run-tests.mjs test-object-template-integration
node tools/run-tests.mjs test-examples-regression
git diff --check
npm test
```

Expected: all tests pass, no new warnings, no validation regressions (`test-examples-regression.mjs`
and `test-project-model-consolidation.mjs` in particular exercise `validateProject()`/
`validateRhsProject()` against every bundled fixture).
