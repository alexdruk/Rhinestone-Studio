# Specification Review Result

## Specification

RS-0003.5B2 — Browser Dependency Loading
(`docs/specifications/RS-0003.5B2-BrowserDependencyLoading.md`)

## Reviewer

Claude

## Status

CHANGES REQUESTED

---

## Summary

The specification's intent, scope boundary, and runtime-isolation guarantees are sound and consistent with `docs/ARCHITECTURE.md` (single source of truth via `GeometryEngine`, millimeters internally, renderer/exporter never generate geometry) and with `docs/AI_ENGINEER.md` / `docs/CLAUDE_GUIDE.md` (narrow scope, one commit, no architecture change, explicit allowed/forbidden files). No scope creep or architecture violation was found. However, two sections contain a concrete ambiguity or an infeasible ordering that a compliant implementer would either have to guess at or would waste effort attempting before falling back to the only strategy that actually works. Both are fixable with small wording changes and do not require rethinking the approach.

---

## Required Changes

### 1. "Browser module probe" (Required Implementation, item 2) — clarify "make OpenTypeProvider load successfully"

The probe requirements list two adjacent, seemingly overlapping bullets:

- "import the required permanent text exports"
- "make `OpenTypeProvider` load successfully"

If the second bullet means only "the ES import completes without throwing," it is redundant with the first and should be merged or reworded.

If it means "construct an `OpenTypeProvider` instance" (e.g. to prove the class is usable, not just importable), that has a real consequence the spec does not account for: `OpenTypeProvider`'s constructor (`src/text/OpenTypeProvider.js:104-119`) throws a `TypeError` unless it is given a `fontManager` argument exposing `getFont()`. Constructing one requires importing and instantiating `FontManager` from `src/fonts/FontManager.js`. `src/fonts/**` is not mentioned anywhere in "Required Outcome," "Dependency Strategy," or "Allowed Files" — it is an implicit fifth dependency in the chain the probe would need to touch.

This is easy to resolve safely (`new FontManager()` with no arguments is a zero-cost, side-effect-free construction — confirmed by reading the class), so this is not a blocking architectural problem. But the spec should say explicitly which of the two readings is intended, and if instantiation is intended, name `FontManager` alongside `OpenTypeProvider` in "Required Outcome" so the implementer isn't left inferring an undocumented dependency mid-task. Left as-is, an implementer following `AI_ENGINEER.md`'s "If You Are Uncertain: Stop" rule would have grounds to halt here.

### 2. "Dependency Strategy" — the "preferred order" is not actually viable in order

The strategy lists, in preference order:

1. Native ES modules with browser-resolvable relative paths.
2. An import map for bare package imports such as `opentype.js`.
3. A narrowly scoped browser adapter module.

`src/text/OpenTypeProvider.js:11` already contains a hard bare specifier: `import opentype from 'opentype.js'`. Option 1 cannot satisfy this without editing that import statement in a permanent, already-tested module — a larger and riskier touch than adding an import-map entry, and one this same document only conditionally permits ("`src/text/**` only when a minimal browser-compatibility correction is required"). Given the current code, option 2 (import map) is the only strategy that resolves the existing bare specifier without touching `src/text/**` at all, which is also the smallest change per "Implementation Constraints."

Please state directly that an import map is the expected mechanism for the existing `opentype.js` bare import, rather than presenting three co-equal options — this avoids the implementer trying and discarding option 1 first.

---

## Non-Blocking Recommendations

1. **`.mjs` MIME type risk.** `npm run dev` runs `python3 -m http.server`, a static file server with no server-side logic. On this machine's Python 3.11, `mimetypes.guess_type('foo.mjs')` correctly returns `application/javascript`, so an import map pointing at `node_modules/opentype.js/dist/opentype.mjs` should serve with a script-compatible `Content-Type`. This mapping is not guaranteed across all Python builds/OSes (older or platform-specific `mimetypes` registries have shipped without a `.mjs` entry), and a wrong `Content-Type` causes browsers to reject module scripts outright. Recommend the "Required Browser Verification" section explicitly ask the implementer to confirm the served `Content-Type` for the chosen dependency file (e.g. via browser dev tools or `curl -I`) and record it in `TASK_RESULT.md`, rather than relying on "no console error" alone to catch this class of failure.
2. **Minor:** once change #1 above is resolved, consider adding `src/fonts/**` to "Allowed Files" as read-only-import scope (no modification expected) purely for documentation completeness, so the full dependency chain touched by the probe is enumerated in one place.

---

## Consistency Check

- `docs/ARCHITECTURE.md`: No violation. The spec correctly keeps `GeometryEngine` as sole geometry source, forbids the probe from generating stones or mutating project state, and keeps units in millimeters.
- `docs/AI_ENGINEER.md`: No violation. Scope, allowed/forbidden files, one-commit rule, and "never silently fall back" error handling are all honored.
- `docs/CLAUDE_GUIDE.md`: No violation. Required output format (`TASK_RESULT.md`) and git rules are consistent with what the spec asks for.
- Verified against actual repository state: `src/geometry/**` and `src/text/**` currently have no `window`/`document`/Canvas/WebGL dependency (confirmed by inspection), `opentype.js` ships a self-contained ESM build at `node_modules/opentype.js/dist/opentype.mjs` with no further bare imports, and `index.html` currently has exactly one `<script type="module" src="./app.js">` entry point — all preconditions the spec assumes are actually true today.

---

## Final Decision

CHANGES REQUESTED. Resolve items 1 and 2 above (both are wording/clarification fixes, not redesigns) and this specification is ready for implementation.
