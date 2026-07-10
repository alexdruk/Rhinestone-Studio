# Specification Review Result

## Specification

RS-0003.5B2 — Browser Dependency Loading
(`docs/specifications/RS-0003.5B2-BrowserDependencyLoading.md`)

## Review Round

4

## Reviewer

Claude

## Status

SPECIFICATION APPROVED

---

## Summary

Round 3's blocking finding is resolved. "Required Implementation" item 1 now correctly:

- keeps `src/text/OpenTypeProvider.js` fully unchanged (Allowed Files: "`src/text/**` must remain unchanged"),
- states explicitly *why* — Node resolves the bare specifier `opentype.js` through the package's CJS/UMD `main` (default export), while the browser's import map must resolve the same specifier to the package's real ES-module `module` build (named exports only, no default) — and that these are structurally incompatible, so no single import statement in `OpenTypeProvider.js` can serve both,
- mandates a browser-only adapter under `src/browser/**` that imports the real ESM build and re-exports its `parse` binding as a default export, with the import map pointing `opentype.js` at the adapter rather than at the package file directly,
- adds five new required tests (21–25) covering the adapter's existence, target, shape, and the fact that Node's resolution path is untouched.

I prototyped this exact pattern to confirm it actually works before approving, rather than taking the wording at face value:

```
$ node --input-type=module -e "import adapterDefault from '<adapter>.mjs'; console.log(typeof adapterDefault.parse)"
function   # adapter re-exporting the real ESM build's named `parse` as default — works

$ node --input-type=module -e "import opentype from 'opentype.js'; console.log(typeof opentype.parse)"
function   # OpenTypeProvider.js's existing, unmodified default import — still works, untouched
```

Both paths resolve correctly and independently, confirming the mandated fix is sound: `npm test` keeps passing through Node's unmodified resolution, and the browser gets a genuine default export through the adapter, with no change to the permanent text module. This closes out all three rounds of prior findings (FontManager/instantiation ambiguity, import-map-vs-default-export mismatch, and the Node-vs-browser resolution conflict).

No architecture, scope, or testability issues remain. Consistent with `docs/ARCHITECTURE.md` (single source of truth via `GeometryEngine`, millimeters internally, no renderer/exporter logic), `docs/AI_ENGINEER.md` (narrow scope, allowed/forbidden files, one commit), and `docs/CLAUDE_GUIDE.md`.

---

## Optional Recommendations

1. **Markdown formatting nit** (Required Automated Tests): list item 25 is immediately followed by the paragraph "Tests must validate meaningful structure..." with no blank line between them, which may render as part of item 25 rather than as a separate paragraph in some Markdown renderers. Cosmetic only.
2. **Minor wording leftover** (Allowed Files): the sentence "Any change inside `src/text/**`, `src/geometry/**`, or `src/fonts/**` must be explicitly justified..." still lists `src/text/**` even though the line above it now says `src/text/**` must remain unchanged (i.e., zero changes are allowed there, not just changes-requiring-justification). Not ambiguous in effect — the stronger "must remain unchanged" clearly controls — but tightening the sentence to only `src/geometry/**` and `src/fonts/**` would remove the redundancy.

Neither item affects implementation readiness.

---

## Final Decision

SPECIFICATION APPROVED. Ready for implementation.
