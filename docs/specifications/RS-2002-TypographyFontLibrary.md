# RS-2002 — Typography & Font Library

Status: **IMPLEMENTED**
Branch: `feature/rs-2002-typography-font-library`

Note on numbering: `docs/specifications/RS-2000A-PostMVPAudit.md` had provisionally reserved the
"RS-2002" id for a future *Project/Layer Schema Reconciliation* milestone. This task explicitly
assigns RS-2002 to Typography & Font Library instead; schema reconciliation remains open,
unscheduled future work (see "Roadmap" below) and should take the next free id when picked up.

---

## 1. Audit — what already existed

Before any change, the font pipeline was audited end to end:

* **`src/fonts/FontManager.js`** — a small, already-solid registry: normalizes a manifest into
  frozen font records (`id`, `family`, `style`, `weight`, `path`, `role`, `enabled`, `notes`),
  rejects duplicate ids, resolves a default font, and serializes without mutation. `role` was
  already a free-form string field, unused anywhere outside `FontManager` itself — a ready-made,
  zero-risk home for a category taxonomy.
* **`src/text/OpenTypeProvider.js` / `FontProviderRegistry.js`** — the only code in the repository
  allowed to know about the OpenType format. Loads a font by id through `FontManager`, parses it
  with `opentype.js`, and returns neutral `VectorPath`/`GlyphMetrics` data. Fully generic over the
  number of fonts; needed no changes.
* **`assets/fonts/manifest.json`** — only 3 registry entries: Courier Prime and Great Vibes (real,
  parseable `.ttf` files, both already enabled), and Roboto Mono, whose `.ttf` was a 14-byte
  placeholder stub (a captured "404: Not Found" response, not a font) — `enabled: false`, and
  **deliberately not selectable anywhere**, because `tools/test-opentype-provider.mjs` depends on
  it staying unparsable to exercise the "font registered but its file cannot be parsed" error path.
* **The `enabled` flag gated nothing real.** `app.js` had its own hardcoded
  `TEXT_ENGINE_FONT_IDS = new Set(['courier-prime-regular','great-vibes-regular'])` — a second,
  parallel font list. Every previously-bundled font needed a matching `app.js` edit; the manifest's
  own `enabled` flag was cosmetic. This was already flagged as a known inconsistency in
  `docs/specifications/RS-2000A-PostMVPAudit.md`.
* **UI**: `index.html`'s `#font` was a plain two-`<option>` `<select>` inside the Text Lightbox
  (`#lightboxText` → `#textControls`). No categories, no search, no favorites, no previews.
* **Save/load, exports, Design Library, Gallery**: all layer-agnostic about which specific font id a
  text layer uses — they pass `layer.font` straight through unchanged. `src/gallery/
  RhsFixtureBridge.js`'s `resolveFontId()` maps the two legacy `.rhs` fixture font names
  (`"Courier Prime"`, `"Great Vibes"`) to their ids; no existing Gallery fixture uses a third font,
  so this map did not need extending for compatibility.
* **GeometryEngine / StoneLayout / renderers / exporters**: entirely font-count-agnostic already —
  they consume a `fontId` string and neutral vector data, never a hardcoded list of fonts.

**Conclusion**: the font *pipeline* (manifest → FontManager → FontProviderRegistry →
OpenTypeProvider → GeometryEngine) was already correct, generic, and did not need architectural
change. The gap was entirely in (a) how few fonts were bundled, (b) `app.js` duplicating the
manifest's own font list, and (c) the picker being a bare two-option `<select>`.

---

## 2. Font library — what was added

Seven new fonts, one per requested category not already covered, chosen for clean outlines,
reliable OpenType data, and readability at rhinestone-scale sizes — not to maximize count:

| Family | Category | File | Why |
|---|---|---|---|
| PT Serif | Serif | `PTSerif-Regular.ttf` | Classic, highly readable book-style serif; static instance (359 KB) chosen deliberately over the ~13x larger variable-font Merriweather build |
| Montserrat | Sans Serif | `Montserrat-Regular.ttf` | Clean geometric sans with excellent small-size legibility; one of the most requested/recognized Google sans-serifs |
| Playfair Display | Display | `PlayfairDisplay-Regular.ttf` | High-contrast elegant display serif for headline-style text |
| Cinzel | Monogram | `Cinzel-Regular.ttf` | Classic Roman capitals styling; purpose-built for monogram/initial and engraved-look layouts |
| Lobster | Decorative | `Lobster-Regular.ttf` | Bold, friendly retro-signage decorative face |
| Anton | Block | `Anton-Regular.ttf` | Ultra-bold condensed block sans for maximum at-a-distance impact |
| Caveat | Handwritten | `Caveat-Regular.ttf` | Casual handwritten style with clean, simple strokes that survive as rhinestone outlines |

Pre-existing (unchanged, recategorized in place):

| Family | Category | Note |
|---|---|---|
| Courier Prime | Monospace | Unchanged, remains the project default font id |
| Great Vibes | Script | Unchanged |
| Roboto Mono | Monospace *(disabled)* | Unchanged placeholder stub, left untouched — required by `tools/test-opentype-provider.mjs`'s corrupt-font-file coverage |

All 9 enabled fonts (10 manifest entries total) are Google Fonts under the **SIL Open Font
License (OFL)** — free for commercial rhinestone production, no attribution requirement in the
finished product, same license family as the two originally-bundled fonts. Source provenance and
per-family notes are in `assets/fonts/README.md`. Where upstream ships only a variable font
(Montserrat, Playfair Display, Cinzel, Caveat), the default-weight master was used as-is:
`opentype.js` reads a variable font's `glyf` table directly, which already holds the
default-instance outlines — verified by parsing every file and generating a real glyph path before
bundling (see `tools/measure-performance.mjs`'s new per-font section for the resulting timings).

**Every category the task named is now represented by exactly one enabled font**: Script, Serif,
Sans Serif, Display, Monogram, Decorative, Block, Handwritten — plus the pre-existing Monospace.

---

## 3. Font organization

* **Categories** — `FontManager`'s existing `role` field is the category (no new field, no schema
  version bump needed beyond the version marker itself). `app.js`'s `#font` `<select>` is now built
  from `<optgroup>`s, one per category, in alphabetical order by category label, mirroring the
  exact pattern `populateStoneColorOptions()` already established for the Stone Color catalog
  (RS-1007).
* **Alphabetical sorting** — fonts within each category group are sorted alphabetically by family.
* **Search** — a new "Browse Fonts" panel (opened via a button next to `#font`) adds a live text
  search across family name and category label.
* **Favorites** — a star toggle per font in the Browse Fonts panel, persisted to `localStorage`
  (`rhinestoneStudio.favoriteFontIds`) as a pure client-side browsing preference. **Not** part of
  the project schema — never read/written by save/load/export/Design Library/Gallery, so it carries
  zero compatibility risk.
* **Visual previews** — every `<option>` and every Browse Fonts panel row renders in the font's own
  actual typeface via one generated `@font-face` rule per enabled font (`injectFontFaceRules()`),
  sourced straight from the same manifest paths `OpenTypeProvider` already reads.

No second font-management system was created: category, family, id, and enabled/disabled state all
come from the one `FontManager`/manifest; the picker only decides which `fontId` to write into the
one real `#font` control.

---

## 4. UI

* `#font` remains a plain `<select>` (kept, not replaced) — every pre-existing test and code path
  that reads/writes `el('font').value` is untouched.
* A new `🔎` **Browse Fonts** button opens an inline panel (search box + grouped, scrollable,
  favorite-able, live-previewed list) directly below the field — not a second modal, not a
  redesign of the Text Lightbox, consistent with the existing "premium but minimal" dialog system.
* Picking a font in the panel sets `#font`'s value and replays the exact `input`+`change` event
  sequence a native `<select>` interaction would fire, so `HISTORY_TRACKED_CONTROL_IDS`'s existing
  listener (undo/redo session + live regeneration) runs completely unchanged — the panel is a
  second *way to set* `#font`, never a second *place that value is read from*.

---

## 5. Compatibility

* **Font ids**: `courier-prime-regular` and `great-vibes-regular` are untouched (same `id`,
  `family`, `path`). `DEFAULT_FONT_ID` (`src/fonts/FontManager.js`) and `DEFAULT_TEXT_FONT_ID`
  (`app.js`) are both still `courier-prime-regular`.
  `assets/fonts/CourierPrime-Regular.ttf`/`GreatVibes-Regular.ttf` are byte-identical to before.
* **`enabled` now actually matters**: `app.js`'s `TEXT_ENGINE_FONT_IDS` (previously a hardcoded
  2-id `Set`) is now derived once at startup from `fontManager.listFonts().map(f => f.id)` — the
  live manifest is the single source of truth for which font ids the text engine accepts, closing
  the exact inconsistency `RS-2000A-PostMVPAudit.md` flagged. `roboto-mono-regular` stays disabled
  and therefore stays unselectable, exactly as before.
* **Old projects never silently substitute a font**: a saved project referencing
  `courier-prime-regular`/`great-vibes-regular` round-trips through save → export → re-import with
  the exact same font id (browser-verified, see below).
* **Gallery / `.rhs` fixtures**: `src/gallery/RhsFixtureBridge.js`'s `resolveFontId()` is untouched
  — the 24 pre-existing example fixtures only ever reference the two original fonts, so no
  compatibility work was needed there; extending that map is natural follow-up work if/when a new
  Gallery fixture is authored using one of the new fonts.
* **Design Library**: font-agnostic already (stores whatever `layer.font` is); unaffected.

---

## 6. Performance

Measured via `tools/measure-performance.mjs`'s new per-font section (real production code path —
`FontManager` → `OpenTypeProvider` → `GeometryEngine.generateTextLayout()`) and a live isolated
headless-Chromium pass (Playwright, temp profile):

| | |
|---|---|
| Cold parse + geometry, 18mm text, per new font | 6–47 ms (first call per font id; `OpenTypeProvider` caches the parsed font after this) |
| Warm regeneration (font already parsed) | 0.9–9.8 ms |
| Fonts fetched at page load, before any font-picker interaction | **1** (only the default project's own font — confirmed via `performance.getEntriesByType('resource')` in a real browser) |
| Fonts fetched once the Browse Fonts panel is opened | 9 (every previewed font, fetched lazily/on-demand at that moment — not before) |

`@font-face` declarations cost nothing by themselves: a browser only fetches a given font file once
an actually-rendered (not `display:none`) element needs to paint text in that font-family. Since
the Text Lightbox and the Browse Fonts panel both start hidden, none of the 8 new fonts are fetched
until a user actually opens the font picker — confirmed live, not assumed (an earlier draft of this
milestone's own verification script measured this incorrectly by checking *after* already opening
the panel; a fresh, no-interaction page load was used to get the real number above).

Total new font payload: ~2.3 MB across 7 files (168 KB–744 KB each); no single font exceeds the
size of the two originally-bundled fonts by more than ~1.6x.

---

## 7. Testing

New/updated automated coverage (all run via `npm test`):

* `tools/test-font-manager.mjs` — rewritten for the 10-entry manifest: category coverage, the
  `enabled` flag now meaning something, id/family stability for the two pre-existing fonts.
* `tools/test-typography-font-library.mjs` *(new, 20 assertions)* — manifest/category coverage,
  index.html wiring, the now-dynamic `TEXT_ENGINE_FONT_IDS`, category grouping + alphabetical
  sorting (real `populateFontOptions()` extracted from `app.js` and run against the real manifest),
  live-preview font-family styling, search/favorites/grouping in the Browse Fonts panel (real
  `renderFontLibraryList()`), favorites `localStorage` round-trip + corrupt-data safety,
  `pickFont()`'s event-replay/panel-close behavior, and backward compatibility.
* **27 pre-existing test files** had their forbidden-file guards updated to stop forbidding
  `assets/` (a few also `assets/fonts/`) now that this milestone legitimately expands the bundled
  font collection — the same "unforbid a previously-off-limits path once a milestone legitimately
  needs it" precedent RS-2001 already established for `examples/`. No other forbidden prefix in any
  of those 27 files changed; each still guards its own original scope.
* `tools/test-object-template-integration.mjs`'s `app.js` source-extraction anchor was updated
  (`TEXT_ENGINE_FONT_IDS` moved/became `let`) to point at the still-`const` `DEFAULT_TEXT_FONT_ID`
  instead.
* `tools/test-variable-stone-sizes.mjs`'s startup-adjacency regex was widened to allow the new
  conditional font-population call between `populateStoneSizeOptions()` and
  `syncSelectedControlsFromLayer()`.
* `tools/measure-performance.mjs` gained a per-font cold/warm timing section (not part of `npm
  test`; a measurement tool, like its existing sections).

```
npm test
```

**65 test suites, 823 `✓` assertions, exit code 0** (up from 64 suites / 803 assertions before this
milestone — 803 already included the manifest/forbidden-guard updates; +20 for the new dedicated
suite).

---

## 8. Browser verification

Isolated headless Chromium via Playwright (`chromium.launchPersistentContext` with a fresh
`mkdtemp` user-data-dir, `headless: true`) — a browser instance entirely separate from any existing
Chrome window/profile on this machine; no window named "main" or "airbnb" was ever touched, and
only this session's own isolated instance was closed at the end.

Verified against the real running app (`python3 -m http.server 5173`):

* Default project loads; stats render.
* Text Lightbox opens; `#font` has 9 options grouped into 9 `<optgroup>`s, alphabetically ordered
  by category label (`Block, Decorative, Display, Handwritten, Monogram, Monospace, Sans Serif,
  Script, Serif`).
* Browse Fonts panel opens with all 9 fonts listed; searching `"lobster"` narrows to exactly 1 row,
  rendered in the real Lobster typeface (`getComputedStyle(...).fontFamily` confirmed); searching
  `"anton"` finds Anton by category-independent family match.
* Favoriting a font pins a "Favorites" group above the category groups.
* Clicking a Browse Fonts row sets `#font`'s value and closes the panel.
* Switching fonts via the `<select>` regenerates the layout live with no status error.
* **Save Project → re-import round-trip preserves the exact font id** (`playfair-display-regular`
  in, `playfair-display-regular` out) — compatibility confirmed against the real save/load path,
  not simulated.
* SVG export and the Production Sheet dialog both work with a new bundled font selected.
* Gallery opens and lists all 27 fixtures; Design Library opens; the 3D preview canvas renders with
  non-zero dimensions.
* **Zero console errors** (only benign headless-GPU `GL_CLOSE_PATH_NV` performance warnings, which
  are a known headless-Chromium software-GL artifact unrelated to this milestone — no favicon 404
  even occurred this run, and none would have failed this pass either way).
* Lazy font loading confirmed live (see Performance, above): 1 font fetched at startup, 9 only
  after the Browse Fonts panel is opened.

---

## 9. Product Owner Review

**Does the new font library noticeably improve the product?** Yes. Going from 2 usable fonts (one
monospace, one script) to 9 spanning every category a rhinestone customer actually shops
for — a clean sans for names/dates, a serif for formal/wedding pieces, a display serif and a
monogram-styled face for statement pieces, a decorative and a handwritten face for gifts/casual
designs, and a block face for team/sports names — is the single highest-leverage, lowest-risk
change available in the current roadmap: it's additive, touches no geometry/export code, and
directly expands what every existing customer can sell today.

**Are the bundled fonts representative of real customer demand?** For the categories in scope,
yes — Montserrat, Playfair Display, Lobster, Anton, and Caveat are each among the most-used fonts
in their category on Google Fonts, a reasonable proxy for broad public familiarity/demand absent
direct sales data.

**Which categories remain underrepresented?** Two real gaps, both explicitly out of this
milestone's scope: (1) only one font per category — a shop with strong repeat demand in one
category (e.g., Script, the single most common rhinestone-name style) may want a second/third
option; (2) no true blackletter/gothic or bold graffiti-style face, both recognizable rhinestone
apparel styles not covered by any category here.

---

## 10. Business Review

**Which additional fonts would customers most likely purchase or expect?** A second Script option
(Script is disproportionately the most-requested rhinestone style — one flagship font may
under-serve it), a bold graffiti/streetwear face, and a true blackletter/gothic face are the three
highest-confidence next additions.

**Should future versions support user-installed fonts?** Not recommended without a dedicated
milestone: this app's entire manufacturing-determinism guarantee (`assets/fonts/README.md`:
"Rhinestone layouts must be deterministic across machines") depends on every font being a bundled,
version-controlled asset. User-installed fonts would need explicit scoping (validation, embedding
into saved projects for shop-to-shop portability, licensing responsibility shifted to the
uploading user) before it could be offered safely — worth a future roadmap item, not a silent
add-on to this one.

**Should premium font packs be considered in the future?** Worth evaluating once usage data exists
(e.g., which categories/fonts get selected most), but not implemented or scoped here per
instruction — today's entire 9-font library is OFL-licensed and free to bundle; a premium pack
would be the first commercial-license font content in the product and deserves its own
licensing/monetization design pass.

---

## 11. Recommended Future Typography Roadmap

1. A second Script-category font (highest-confidence, lowest-effort next addition given Script's
   outsized share of real rhinestone-name orders).
2. A blackletter/gothic face and a bold graffiti/streetwear face — closes the two category gaps
   named above.
3. User font import (post-determinism-safety design work — see Business Review).
4. Premium font packs (post-usage-data, post-licensing-design).
5. `RS-2002` (as originally reserved) — Project/Layer Schema Reconciliation — remains the largest
   unrelated architectural item on the roadmap; unaffected by, and independent of, this milestone.

---

## Recommendation

**APPROVED FOR REVIEW**

Branch `feature/rs-2002-typography-font-library` pushed for review. Do not merge per task
instructions.
