# RS-3001 — CSS Isolation Addendum

Addendum to [RS-3001-drawing-board-integration.md](./RS-3001-drawing-board-integration.md)
§3, "Embedding Design (Open Questions, Not Decisions)". Records the findings
of a throwaway spike comparing the two candidate CSS isolation approaches
flagged there: Shadow DOM isolation, and a systematic `--variable` rename
pass. No drawleather or Rhinestone Studio source was modified to produce
this — the spike ran against a copied slice in a scratch folder that has
since been deleted; this document is the only surviving artifact.

## What was built

Both prototypes wired the same real slice of drawleather (`Viewport`,
`Scene`, `PointerInput`, `FreePathTool`, `ShapeTool`, `EditorContext`,
`Project`/`projectOps`, `dragSnap`/`drawSnap`, plus every file those
transitively require to load — 57 files total, matching the extraction
manifest's traced dependency closure) into a minimal harness that draws a
shape and a freehand line on a real `<canvas>` via Paper.js, styled by
drawleather's actual `src/styles.css`. Each prototype loaded this alongside
a stub of Rhinestone Studio's real host-page CSS (the `:root` token block +
reset + shared-control rules copied verbatim from `index.html`), to create
a genuine collision scenario rather than a synthetic one. Both were
exercised in a real Chrome instance (Playwright) — drawing a shape, drawing
a line on top of it, and inspecting computed styles on both sides of the
boundary.

The harness intentionally skips `app.ts`'s commit-time derivation pipeline
(rounded corners, offsets, connections, construction-line kind inference) —
none of that is exercised by a bare shape or freehand line, and pulling it
in would have meant vendoring several thousand more lines for no
isolation-relevant benefit. This is a simplification of the *harness*, not
of drawleather itself.

## Prototype A — Shadow DOM

**Host-page isolation: confirmed, for free.** drawleather's real
`styles.css` was injected unmodified into a `<style>` inside a Shadow DOM
root — including its page-global `* { box-sizing: border-box }` and
`html, body, #app { overflow: hidden; user-select: none; ... }` rules,
copied verbatim, zero edits. Outside the shadow boundary, Rhinestone
Studio's stub-styled buttons kept their correct blue, its `document.body`
kept `overflow: visible` and normal text selection — none of drawleather's
global reset leaked out. This is the Shadow DOM boundary doing its job with
no CSS changes at all.

**Canvas theming: broken, and not by a CSS problem.** Every stone/shape
color in the copied slice comes from `src/colors.ts`'s `cssVar()` helper,
which — per its own doc comment — is "the single source of truth for every
display color," read via
`getComputedStyle(document.documentElement).getPropertyValue(name)`. Inside
a Shadow DOM, that call still targets the *real* `<html>` element, not the
shadow root — so every one of the ~49 `cssVar()` call sites in the copied
`Scene.ts` alone (and every one in `ShapeTool.ts`/`FreePathTool.ts`) reads
an empty string. The console confirmed it: 48 warnings of the form
`cssVar("--leather-fill") returned empty`. The rendered shape came out
solid black instead of drawleather's tan leather fill; the freehand line
was invisible against it.

This is fixable, but it is a real code change, not a CSS-only one:
`colors.ts` would need to read from an injected root reference (e.g. a
module-level `setCssVarRoot(el)` called once at mount time) instead of
hardcoding `document.documentElement`. It's a single well-localized fix —
one file, one function — but it is a change to the exact mechanism
AGENTS.md documents as drawleather's "single source of truth" for color,
and it did not work out of the box in this spike.

**No other friction found.** Paper.js's canvas rendering, pointer-event
handling (`PointerInput`'s `pointerdown`/`pointermove`/`pointerup`
listeners), and `ResizeObserver`-driven view sizing all worked normally
inside the shadow root with zero modification. Hit-testing (freehand line
onto the drawn shape) worked correctly, confirming interaction isn't
shadow-root-sensitive here. No other `document.querySelector`-style
document-reaching code was found in the copied slice.

**Lines of drawleather source touched: 0.** (The harness/mount code is new,
not drawleather's.) The `colors.ts` fix, if made, would be on the order of
a few lines in one file plus one call at mount time.

## Prototype B — Variable rename

**Mechanical pass:** wrote a small script (boundary-aware regex — no match
inside a longer name, no match against BEM-style `.foo--modifier` class
selectors that also use the literal `--` token) and ran it once over the
copied `styles.css` and every copied `.ts` file. Result: 40 unique custom
properties declared in the file, 387 token replacements across 10 files —
332 lines in `styles.css` itself, plus 6 TypeScript files (35
`cssVar("--x")` call sites, 21 unique names) in just this 57-file slice.
(Full drawleather source, not just this slice, has 54 `cssVar()` call sites
across 43 unique names — the real-world sync surface if this were applied
to the whole codebase rather than a vendored subset.)

Also scoped the page-wide `* { box-sizing: border-box }` and
`html, body, #app { ... }` rules to a `.dl-spike-root` container class, per
the task — both the reset and the grid layout rule worked identically once
scoped; the drawing board's own grid layout (toolbar/canvas areas) rendered
correctly.

**Host-page isolation: confirmed.** Same test as Prototype A, no shadow
boundary this time — drawleather's (renamed, scoped) stylesheet loaded
directly into the same document as the Rhinestone Studio stub. RS's button
stayed correctly blue; `document.body`'s `overflow`/`user-select` were
unaffected once the reset was scoped to `.dl-spike-root`.

**Canvas theming: fully correct, zero warnings.** Because `colors.ts` was
left completely unmodified and still reads
`getComputedStyle(document.documentElement)` — which is the *actual*
document here, no shadow root involved — every `cssVar("--dl-leather-fill")`
call resolved correctly. The rendered shape came out in drawleather's real
tan fill with a brown edge stroke; the freehand line rendered in the
correct dark-brown stroke color on top of it. Zero console warnings.

**Two real "did anything get missed" findings, both caught and fixed
during the pass, worth flagging as required checklist items for whoever
does this for real:**

1. **A rename sourced from `styles.css`'s static `:root` declarations
   alone misses variables set dynamically from JavaScript.** Four names
   used via `var(--x, fallback)` in `styles.css` — `--row-hover`,
   `--prop-sticky-tool-h`, `--input-bg`, `--strip-indent` — have no `:root`
   declaration anywhere in the file; they're set at runtime via
   `element.style.setProperty(...)`. Confirmed one directly:
   `src/ui/LayersPanel.ts` calls
   `strip.style.setProperty("--strip-indent", ...)` (outside this spike's
   copied scope, but real code in the full repo). A rename pass that only
   greps the stylesheet will silently leave these unprefixed — harmless on
   their own (CSS and JS stay mutually consistent, since both still say
   `--strip-indent`), but it means the rename isn't actually complete, and
   any of these four could still collide with a same-named RS variable set
   from JS. The fix is mechanical (grep the whole source tree for
   `setProperty` too, not just the stylesheet) but it is an easy step to
   forget, and forgetting it produces no error — it just quietly under-covers
   the rename.
2. **Naive (non-boundary-aware) global replace is unsafe in principle,
   even though it happened not to break anything in this specific file.**
   `styles.css` contains 6 BEM-style double-dash class-modifier selectors
   (`.prop-sticky-header--tool`, `.layers-row--match-target`, etc.) that
   share the literal `--` token with custom properties. None of the 40
   variable names collide with those 6 modifier suffixes today, but a
   regex without a word-boundary/negative-lookbehind guard has no way of
   telling a custom-property token from a class-selector token, and would
   silently corrupt a BEM selector the day a variable name and a modifier
   name happen to coincide. Worth a guard rail, not a currently-tripped
   bug.

**Lines touched: 332 in `styles.css` + 35 call sites across 6 TS files, in
this 57-file slice** (single scripted pass, seconds to run; the two
findings above were caught by manual audit after the pass, not by the
script itself).

## Compare

| | Shadow DOM | Variable rename |
|---|---|---|
| drawleather source lines touched | 0 | 332 (CSS) + 35 (TS call sites), this slice |
| Host-page isolation | Confirmed, zero CSS edits | Confirmed, after scoping 2 rules |
| Canvas theming out of the box | **Broken** (black shapes, 48 warnings) | Correct, zero warnings |
| Fix required | 1 file (`colors.ts`), 1 new mount-time call | N/A — worked once the rename pass was audited |
| Failure mode if something's missed | Loud: visible black rendering + console warnings, same everywhere | Silent: an unprefixed var falls back to nothing special *unless* it collides with an RS var of the same name — no error either way |
| Re-applying if drawleather source changes upstream | Nothing to redo — new CSS just works inside the boundary; only the one `colors.ts` fix has to survive | Must be redone (or diffed and reapplied) — any new custom property or new `setProperty()` call needs its own rename + call-site sync, or it silently reintroduces the exact collision risk this approach exists to prevent |

(Sasha's vendoring decision is a one-time snapshot, not an ongoing re-sync,
so the last row matters less than it otherwise would — but it isn't zero,
since the vendored copy can still be hand-edited later by whoever
maintains it inside Rhinestone Studio.)

## Recommendation

This is a genuine tradeoff, not a "which is less code" question, and it's
Sasha's call:

- **Shadow DOM** gives host-page isolation as a browser-enforced guarantee
  with zero drawleather CSS edits, immune to any future variable
  drawleather's stylesheet adds. Its cost is a real, if small and
  well-localized, change to `colors.ts`'s "single source of truth" color
  lookup — and that change is *required*, not optional, since canvas
  theming is confirmed broken without it in this spike.
- **Variable rename** requires zero changes to drawleather's own
  JavaScript — `colors.ts` stays exactly as designed, and once the rename
  pass is audited (as it was here) it renders with full color fidelity out
  of the box. Its cost is that correctness depends on a mechanical process
  a reviewer has to trust was done completely — this spike found two real
  ways to under-cover it (JS-set variables, BEM-collision risk) on a
  careful first pass over a single 3,256-line file, both catchable but
  both easy to miss without knowing to look.

§3 is left **open** — both approaches are demonstrated workable with real
evidence above, and the choice is a risk-tolerance call (a guaranteed
platform boundary plus one code change, vs. no code change plus
review-dependent mechanical correctness) that should be Sasha's, not
inferred from which prototype happened to render cleaner first.
