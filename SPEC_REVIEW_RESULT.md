# Specification Review Result

## Specification

RS-0003.5B2 — Browser Dependency Loading
(`docs/specifications/RS-0003.5B2-BrowserDependencyLoading.md`)

## Review Round

2

## Reviewer

Claude

## Status

CHANGES REQUESTED

---

## Summary

Both required changes from round 1 are fully resolved:

- The `OpenTypeProvider`/`FontManager` instantiation ambiguity is gone. "Required Outcome" and "Required Implementation" item 2 now state plainly that `OpenTypeProvider` must be **imported but not instantiated**, and `FontManager` is now named explicitly throughout (Required Outcome, Architecture Requirements, probe imports, Allowed Files, Out of Scope, tests, acceptance criteria). No remaining ambiguity.
- "Dependency Strategy" now states directly that an import map (or documented equivalent) is required, rather than presenting three co-equal options — the round-1 concern about a misleading "preferred order" is resolved.
- The MIME-type risk flagged as a non-blocking recommendation in round 1 is now a required, first-class part of the spec: "Every imported `.js` or `.mjs` module is served with a browser-acceptable JavaScript MIME type" is a browser-verification checklist item, and observed `Content-Type` values are now a required `TASK_RESULT.md` field.

One new, concrete correctness problem was found while re-verifying the spec's central technical claim against the actual installed package.

---

## Required Changes

### 1. "Dependency Strategy" / "Required Implementation" item 1 — the expected import map target has no default export

The spec's expected fix is: add an import map that resolves the bare specifier `opentype.js` to "a local browser-loadable module from the installed npm package," implying `node_modules/opentype.js/dist/opentype.mjs` (the package's declared `"module"` entry point, per its `package.json`).

`OpenTypeProvider.js:11` imports it as a **default** import:

```js
import opentype from 'opentype.js';
```

`dist/opentype.mjs` (and `dist/opentype.min.mjs`) do not have a default export — they only export named bindings (`Font`, `Glyph`, `Path`, `parse`, `load`, `loadSync`, `BoundingBox`). This was verified directly:

```
$ node --input-type=module -e "import opentype from './node_modules/opentype.js/dist/opentype.mjs'; console.log(opentype);"
SyntaxError: The requested module './node_modules/opentype.js/dist/opentype.mjs' does not provide an export named 'default'
```

This is a hard ES-module linking error, not a silent `undefined`. If the import map is wired straight to the package's `.mjs` build as the spec currently implies, importing `OpenTypeProvider.js` fails immediately in the browser — breaking the probe, and directly contradicting "Importing `OpenTypeProvider` must cause its `opentype.js` dependency to resolve successfully," the "`OpenTypeProvider` resolves without a module error" verification checkbox, and the "`OpenTypeProvider` imports successfully" acceptance criterion. This would surface only during browser verification, after the automated (Node-based) tests already pass, since Node's `npm test` suite presumably exercises `OpenTypeProvider` through Node's own `node_modules` resolution (CJS/UMD `main`, not the `.mjs` `module` build), masking the failure until the browser-verification step.

The fix is small and stays within already-allowed files — but the spec should pick and state one explicitly, since both are legitimate:

- **Option A** (touches `src/text/**`, justified as a minimal browser-compatibility correction, already permitted by "Allowed Files"): change the import to a namespace import, `import * as opentype from 'opentype.js'`, and keep the existing `opentype.parse(buffer)` call — `parse` is a named export, so this works unmodified otherwise.
- **Option B** (stays entirely inside `src/browser/**`, no `src/text/**` touch at all): point the import map's `opentype.js` key at a small adapter module (the "narrowly scoped browser adapter" already anticipated as option 3 in "Dependency Strategy") that re-exports the package's named `parse` binding as a default export, e.g. `export { parse as default } from '<local opentype.js module path>';`. This is a re-export, not a copy of the package source, so it does not conflict with "Do not copy the `opentype.js` source into project-owned source files."

Please state which option is expected (or explicitly leave the choice to the implementer with both pre-approved), so this doesn't surface as a mid-implementation stop.

---

## Non-Blocking Recommendations

1. Whichever option is chosen for change #1, the implementation report should note that the package's declared `"module"` entry (`dist/opentype.mjs`) exports no default — this is package-shape information worth preserving in `TASK_RESULT.md` for future milestones (RS-0003.5B3 will instantiate `OpenTypeProvider` for real and will hit the same import shape).
2. Consider consolidating Required Automated Tests items 5 and 16 ("no public CDN" checked twice, once at the mapping level and once repo-wide) — harmless duplication, not worth blocking on.

---

## Consistency Check

Re-verified against `docs/ARCHITECTURE.md`, `docs/AI_ENGINEER.md`, and `docs/CLAUDE_GUIDE.md`: no violations. Scope remains limited to the dependency-loading boundary, `GeometryEngine` remains the single source of truth, units remain millimeters, and file allow/forbid lists are internally consistent (`src/fonts/**` is now correctly included alongside `src/text/**` and `src/geometry/**` as conditionally editable, `node_modules/**` is now correctly listed under "Forbidden Files" rather than only mentioned in prose).

---

## Final Decision

CHANGES REQUESTED. Resolve item 1 above — a factual correction to the dependency-loading mechanism, not a scope or architecture change — and this specification is ready for implementation.
