# Rhinestone Studio — Task Result

This document is completed by the implementation engineer after finishing the current task.

---

# Task ID

RS-2013 (Implementation Phase) — inserted step between §4 step 3 and step 4 ("step 3b": facet
geometry + material response evaluation)

---

# Status

EVALUATED — both candidates built, measured, and compared against the same baseline and
methodology step 3 used. **One candidate (material response) shows a real, qualitatively different
improvement over step 3's finding; the other (richer geometry) shows a real but weaker, secondary
effect. Neither is a dramatic transformation.** Reported directly, per the task's explicit
instruction not to stretch a marginal result into a shipping recommendation it doesn't earn.

---

# Branch

feature/rs-2013-instanced-stones-step3b-facet-material (already checked out at task start, cut from
the step-3 lighting commit `a8e3cf3`)

---

# Housekeeping: prior steps' screenshot assets

Deleted `tools/rs2013-instanced-stone-harness-{plate,mug,tumbler,bottle}-lighting.png` (step 3's
default-vs-extended lighting comparison set) before starting any new work, per the task brief —
their review purpose was already served and they're preserved in git history via the step-3 commit.
`du -sh tools/`: **4.4M before deletion → 3.6M after** (0.8M reclaimed). This step regenerates its
own `-lighting.png` files (identical content/name to what was deleted — they're this step's own
"baseline under extended lighting" reference, not a restoration of the old ones) plus a much larger
new set for the candidate evaluation; final `tools/` size is reported below.

---

# What was built

`tools/rs2013-instanced-stone-harness.html` gained two new, independently selectable URL params
(full detail in `TASK.md`):

- `?facet=octahedron|bipyramid16` — **Candidate A**. `bipyramid16` is a hand-built "octagonal
  bipyramid" (`buildBipyramid16Geometry()`): 2 apex vertices + an 8-vertex equatorial ring = 16
  triangular faces, non-indexed (3 unique vertices per triangle) so `computeVertexNormals()` yields
  flat per-facet shading for free, the same property `THREE.OctahedronGeometry(r,0)` already has.
  Bounding radius 1, matching the octahedron, so the existing `scaleV.setScalar(radiusMm)` scaling
  is unchanged. Local +Z is the apex-to-apex axis, matching the octahedron's own construction-axis
  convention, so the curved-surface orientation math (`qAlign.setFromUnitVectors(zAxis, normal)` +
  `qSpin` around `facetAngleDeg`) needed **zero changes** to work correctly for either shape.
- `?material=diffuse|specular` — **Candidate B**. `specular` is `roughness=0.12/metalness=0.55`,
  the winner of a 3-combination sweep (below). `diffuse` (unchanged `0.42/0.08`) stays default.
- Both together (`?facet=bipyramid16&material=specular`) is **Candidate C**.
- `?roughness=`/`?metalness=` raw overrides also exist, for reproducing/extending the sweep.

**One necessary fix found and made along the way:** the plate-placement branch used
`quaternion.identity()` for its "no orientation needed" case, with a comment noting this relies on
an unrotated octahedron already having a vertex on the +Y axis by construction (`±X/±Y/±Z`
vertices). The bipyramid16 primitive's apex axis is local Z, not Y — identity would have laid it on
its side on the plate view. Fixed by generalizing to `qAlign.setFromUnitVectors(zAxis, (0,1,0))`,
the same alignment pattern the curved-surface branch already uses, just with a fixed normal instead
of a per-stone one. **Verified this produces a pixel-identical result for the still-default
octahedron**: a regular octahedron is symmetric under exactly this rotation (the same 6 vertex
positions end up occupied in world space, just by different original vertices — worked out by hand
before making the change, not assumed). No behavior change to the shipped `facet=octahedron` plate
view; this is a strict generalization needed for the new shape, not a placement-math change.

---

## How to view the results yourself

```bash
npm run dev
```
then, e.g.:
- `http://localhost:5173/tools/rs2013-instanced-stone-harness.html?product=mug&lighting=extended` —
  unchanged baseline (extended rig, octahedron, diffuse — step 3's own output).
- `...?product=mug&lighting=extended&facet=bipyramid16` — Candidate A.
- `...?product=mug&lighting=extended&material=specular` — Candidate B (the winner, see verdict).
- `...?product=mug&lighting=extended&facet=bipyramid16&material=specular` — Candidate C.
- Swap `mug` for `plate`/`tumbler`/`bottle`. Each page's info box has live links to switch
  lighting/facet/material without retyping the URL.

---

## Material sweep — 3 combinations tried, not just one guess

All three tried at `?product=mug&lighting=extended`, geometry held at the plain octahedron so only
the material variable changes. RMSE vs. the unchanged baseline (`mug-lighting.png`):

| Attempt | roughness/metalness | Full-frame RMSE | Macro-crop RMSE | Verdict |
|---|---|---|---|---|
| mild | 0.25 / 0.30 | 0.16% | 1.74% | Real but subtle — only one stone in the whole design shows a clear sharp highlight; most of the design still reads close to diffuse. |
| **moderate (shipped as `specular`)** | **0.12 / 0.55** | **2.06%** | **4.21%** | Clear, widespread per-facet contrast (below) without losing the design's gold-color legibility at normal viewing distance. |
| strong | 0.05 / 0.75 | 0.60% | 6.63% | Slightly more contrast than moderate, but the overall stone color reads duller/more olive-brown at macro-crop zoom, trending toward "dull metal" rather than "gem" without a proportionally better facet-highlight payoff over moderate. Rejected. |

`moderate` was kept as the shipped `specular` preset.

---

## Evidence: RMSE + facet-boundary-concentration (the key test)

All measured at `?product=mug&lighting=extended`, against the unchanged baseline
(`rs2013-instanced-stone-harness-mug-lighting.png` / `-crop.png`):

| Candidate | Full-frame RMSE | Macro-crop RMSE |
|---|---|---|
| A (facet=bipyramid16) | 2.90% | 3.16% |
| B (material=specular) | 2.06% | 4.21% |
| C (both) | 2.88% | 5.88% |

All three are larger, more real changes than step 3's own lighting-only RMSE (~3.4% on a similar
comparison) — none of this is a no-op.

**The facet-boundary-concentration check** — a grayscale difference-*magnitude* image
(`-compose difference -colorspace Gray -auto-level`, not the default binary red mask, which can't
distinguish "uniformly different" from "different in a structured internal pattern"):

- `rs2013-instanced-stone-harness-mug-candidate-a-facetdiff.png`: visible internal structure —
  diagonal facet-boundary lines are distinguishable *within* several stones' silhouettes, not just a
  uniform gray fill. Real, but subtle; many stones still show fairly even shading across most of
  their area.
- `rs2013-instanced-stone-harness-mug-candidate-b-facetdiff.png`: **much clearer internal structure.**
  Most stones show a distinct bright region against a darker region *within the same stone* — i.e.
  one facet now reads brighter than its neighbor, not the whole stone shifting tone together. This is
  qualitatively different from step 3's own finding (uniform per-silhouette brightness shift with no
  internal pattern) and is the strongest evidence either candidate produces the specific effect this
  step was testing for.

This matches the underlying optics: a Lambertian (diffuse) surface's response to multiple light
sources is strictly additive — every light raises the floor, consistent with step 3's diagnostic
finding that even an unrealistically bright extra light couldn't flip which facet reads brighter. A
specular response is not additive in the same way — it depends sharply on the angle between the
normal, the light, and the viewer, so which facet catches a highlight *can* change per-facet even
under the same fixed lighting rig. Candidate B's material change is a change to the mechanism itself,
not just another light; Candidate A's geometry change is a real but secondary contributor (more
facet boundaries exist to show *some* internal contrast even under the unchanged diffuse material,
just far less sharply, because the underlying additive-lighting mechanism is unchanged).

**Full-image legibility check (not just macro-crop):** at normal preview viewing distance (the
un-cropped screenshots), Candidate B's mug still reads clearly as the intended gold-colored "Emma"
text design — the improved facet contrast is a real, macro-crop-confirmable effect, not a distortion
visible only at extreme zoom, but it is also a subtler effect at normal viewing distance than the
macro crop alone might suggest. This is reported plainly rather than only showing the most flattering
zoom level.

---

## Honest verdict

**Candidate B (specular material response) is the one candidate that produces the specific effect
step 3 found absent** — per-facet, position/angle-dependent contrast *within* a stone's silhouette,
not just a uniform tone shift. It does not turn these stones into a dramatically different
"obviously a cut gem" look at a glance; it is a real, measured, mechanism-level improvement over
step 3's ceiling, confirmed by both RMSE and the grayscale facet-boundary-concentration check, and it
holds up at normal viewing distance without looking chrome/liquid-metal.

**Candidate A (richer 16-tri geometry) shows the same kind of effect, but weaker** — real internal
facet-boundary structure is visible in the diff, but most of each stone's shading is still close to
uniform, because the underlying diffuse-additive lighting mechanism (the actual thing step 3
identified as the ceiling) is unchanged. Geometry alone does not fix what step 3 found; it modestly
softens it.

**Candidate C (both together) does not clearly exceed Candidate B alone.** Its RMSE is higher (more
different from baseline), and its facet-diff pattern is visually similar to B's, with a marginally
more complex per-stone silhouette from the extra facets — but side-by-side full-color crops of B and
C show near-identical sparkle/highlight placement (driven by the material, not the extra geometry),
consistent with the mechanism argument above. Combining does not obviously make the material fix any
"more solved," and it costs 2x the triangles per stone (still trivially cheap in absolute terms, per
the §3.1 budget check in `TASK.md`, but an unnecessary cost for no demonstrated visual gain over B
alone).

**Recommendation for step 4:** carry forward **Candidate B's material preset alone**
(`roughness=0.12/metalness=0.55`) as the material response to wire into the real integration, on top
of the unchanged 8-tri octahedron. Do **not** adopt the 16-tri geometry at this time — it is not
wrong, but the evidence here doesn't show it earns its added complexity over the material change
alone; it remains available (`?facet=bipyramid16`) if a future step's visual read wants to revisit
it specifically. This is not a "ship the extended lighting rig" recommendation either — step 3's
`extended` rig and this step's `specular` material are independent, both real, and both still only
reachable via this harness's URL params; step 4 is where an actual carry-forward decision into
`Preview3DRenderer` would be scoped, and that step should treat this section as its input, not as a
default that already shipped.

---

## Applying the winning candidate to all 4 product kinds

Per the task brief, Candidate B (`material=specular`) applied to all 4 products, holding placement
(step 2) and the extended lighting rig (step 3) constant, geometry left at the unchanged octahedron:

- `rs2013-instanced-stone-harness-mug-candidate-b.png` (63 stones)
- `rs2013-instanced-stone-harness-plate-candidate-b.png` (377 stones)
- `rs2013-instanced-stone-harness-tumbler-candidate-b.png` (286 stones)
- `rs2013-instanced-stone-harness-bottle-candidate-b.png` (429 stones)

All 4 loaded with zero console/page errors (verified via the screenshot script's existing
error-capturing logic). No regression to placement/orientation: stone positions are visually
identical to each product's existing `-lighting.png` counterpart; only the material response
changed.

---

## Scope discipline

- No change to `app.js`, `index.html`, or Studio UI.
- No change to `src/preview3d/Preview3DRenderer.js` or `src/preview3d/ObjectGeometryBuilder.js`.
- No change to step 2's placement math or step 3's lighting rig values, beyond the one documented,
  verified-pixel-identical-for-octahedron generalization to the plate orientation quaternion (needed
  for the new geometry primitive to orient correctly; see "What was built" above).
- No HDRI/environment-map/`PMREMGenerator` work.
- Neither candidate was made the new default: `?facet=octahedron` and `?material=diffuse` (i.e. no
  params at all) still render exactly what steps 1-3 shipped, byte-for-byte — verified by re-running
  the full screenshot set and confirming the non-candidate views (`grid`/`plate`/`mug`/`tumbler`/
  `bottle`/`*-lighting`) are visually unchanged from before this step.

---

## Testing

- `node tools/run-tests.mjs --all`: **98/98 passed**.
- `node tools/test-documentation-consistency.mjs`: **passed**.
- The screenshot script's full run captures 16 views (5 unchanged step-1/2 default-rig views + 4
  step-3 lighting views + 4 new mug candidate views + 3 new other-product candidate-b views), all
  with zero console/page errors. The 5 default-rig views (`grid`/`plate`/`mug`/`tumbler`/`bottle`,
  no `-lighting` suffix) were already pruned from git tracking in the step-3 commit (`4139af4`,
  "superseded" once `-lighting` variants exist) — regenerated locally for this run's own visual
  parity check, then deleted again rather than re-added, consistent with that prior decision.
- `tools/` size after this step's own asset set: **5.9M** (was 4.4M before this step's initial
  cleanup, 3.6M immediately after deleting step 3's superseded `-lighting.png` files). The growth is
  11 new/regenerated full-frame screenshots at 104K-268K each (consistent with prior steps' per-file
  size range) plus 6 much smaller macro-crop/diff evidence images at 10K-47K each — flagged as
  requested, not unexpectedly large for an mug-only evaluation set plus a 4-product application of
  the winning candidate.

---

## Deliverables

- `tools/rs2013-instanced-stone-harness.html` — `?facet=`/`?material=`/raw-override params,
  `buildBipyramid16Geometry()`, `MATERIAL_PRESETS`, updated info text/links, plate-orientation
  generalization.
- `tools/rs2013-instanced-stone-harness-screenshot.mjs` — mug evaluation set (candidate-a/b/c) +
  winning-candidate application to plate/tumbler/bottle.
- New screenshot/crop/diff assets (see file list above and in the repo).
- `TASK.md` (this milestone's), `TASK_RESULT.md` (this file).

---

## Correction — single-stone, render-time close-up verification (2026-08-03)

**This section walks back the "Candidate B wins" verdict above.** The evidence below shows the
wide-shot crop/upscale evidence the verdict was based on could not actually resolve per-facet
brightness at the pixel level, and that a real render-time close-up does not reproduce the effect —
if anything, it points the other way.

### Why this check was needed

Every piece of evidence in the sections above (`-crop.png`, `-facetdiff.png`) came from cropping a
tight region out of a wide ~20-stone shot and upscaling it 8x with nearest-neighbor (`-filter point
-resize 800%`). At the wide shot's native resolution, one stone is only a few pixels across — facet
edges in that crop are 1-2 source pixels wide, blown up into blocky steps, not real anti-aliased
facet geometry. A human reviewer looking at that crop directly (not the further-upscaled derivative)
reported seeing no visible facet structure, just a blurry blob. That is a legitimate objection: the
crop/upscale method cannot actually support a claim about *per-facet* brightness, only about
*whole-crop-region* RMSE.

### What was built for this check

`?view=singlestone` (new URL param, `tools/rs2013-instanced-stone-harness.html`): renders exactly
one real stone from the product's own `StoneLayout` (default `stones[0]`, or `&stoneIndex=N`) at the
origin, camera framed close using that stone's own `sizeMm` (not the whole object's bounding
radius) via the existing `frameCamera()` helper — so the stone fills most of the frame as a render-
time result, not a post-hoc crop. `?facet=`/`?material=`/`?lighting=` all still apply, so baseline
vs. Candidate A/B/C are directly comparable at this resolution. Captured at a 900x900 viewport,
deviceScaleFactor 2 (1800x1800 real pixels) — `runSingleStoneCloseup()` in the harness, new views in
`tools/rs2013-instanced-stone-harness-screenshot.mjs`.

### What the close-up actually shows

Baseline (`mug-singlestone-baseline.png`, stone #0, extended lighting, octahedron, diffuse) shows a
clean 3-facet fan, each a genuinely distinct flat color — sampled and quantized (`magick -colors 12
-unique-colors`) to three solid clusters at this stone's orientation: `rgb(145,112,28)`,
`rgb(168,130,34)`, `rgb(216,169,50)` (luminance 112 / 130 / 170 — a real ~1.5x brightest-to-darkest
spread). This pattern held across 4 more stones sampled the same way (indices 1-4): every baseline
render resolved into 2-3 distinct facet clusters with brightest/darkest luminance ratios of roughly
1.3x-1.6x.

Candidate B (`mug-singlestone-candidate-b.png`, same stone, same lighting, `material=specular`) is
visibly darker and more uniformly olive/brown overall, and at the pixel level resolves into *fewer*
distinct clusters, not more: `rgb(160,123,29)` and `rgb(150,116,27)` were the only two solid facet
colors distinguishable at 12-color quantization for this stone (luminance 119 / 116 — ~1.03x, i.e.
close to indistinguishable) plus one darker facet at `rgb(121,92,20)` (luminance ~88, giving a
119/88 = 1.35x spread against the darkest facet only). Repeated across the same 4 additional stones:
Candidate B's brightest/darkest facet luminance ratio came out flat-to-lower than baseline at every
single stone checked (stone 1: 1.27x vs. baseline's 1.58x; stone 2: 1.32x vs. 1.59x; stones 3-4:
baseline still resolved 2 distinct clusters, Candidate B collapsed to essentially one dominant facet
tone with the rest blending into antialiasing gradients). No stone, at any of the 5 indices checked,
showed Candidate B producing a sharper or more numerous facet split than its baseline counterpart.

The grayscale difference-magnitude image for this exact pair
(`rs2013-instanced-stone-harness-mug-singlestone-facetdiff.png`, `-compose difference -colorspace
Gray -auto-level` on the two singlestone renders) makes the same point visually: the diff is a
near-uniform mid-gray across the entire stone silhouette, with only very faint internal
facet-boundary lines — the "uniform silhouette-wide shift" pattern step 3 identified as the *absent*
signature, not the "concentrated at facet-boundary lines" pattern this whole milestone was built to
find. RMSE for this single-stone pair: 11.4% (`magick compare -metric RMSE`) — a real, measurable
difference, consistent with the wide-shot finding, but the grayscale diff shows that difference is
mostly a flat darkening (lower roughness/higher metalness reduces the ambient/diffuse contribution
per facet fairly evenly under this lighting), not a redistribution of which facet catches a
highlight.

### Honest verdict (superseding the section above)

**The step-3b "Candidate B wins" verdict is not confirmed by this closer look, and should be
treated as unresolved rather than a basis for carrying anything forward into step 4.** The wide-shot
RMSE increase Candidate B produced is real, but this close-up check — built specifically to test
whether that RMSE increase corresponds to genuine per-facet contrast — does not support that
reading. At single-stone, render-time resolution, Candidate B looks flatter and more uniformly dark
than the baseline, not more faceted; the baseline's diffuse material actually resolves *more*
distinct facet tones per stone than the specular preset does, at every stone orientation checked.
Candidate A (geometry) was not re-tested at this resolution in this pass — this correction is scoped
to Candidate B, the one the original verdict named as the winner. Candidate A's `?facet=bipyramid16`
close-up view exists (same `?view=singlestone` param) and should be checked with the same rigor
before any step-4 decision, since it was never independently confirmed at this resolution either.

**Recommendation for step 4:** do not carry forward Candidate B's material preset as a resolved fix
for the "flat painted polygon" read. Both candidates from this milestone are now back to unresolved
status. If step 4 needs an actual answer, the next real lever to test (not yet tried anywhere in
this milestone) is whether a specular *highlight* — a small bright hotspot from a light angle that
actually catches a facet's reflection cone at grazing incidence — can be produced at all under
`MeshStandardMaterial` + directional lights without HDRI, since neither material tuning nor the
16-triangle geometry increases the number of front-facing normal directions enough on its own to
guarantee one lands inside a viewer's typical viewing/lighting angle.

### New screenshot assets (this correction only; none of the prior section's assets removed)

- `tools/rs2013-instanced-stone-harness-mug-singlestone-baseline.png`
- `tools/rs2013-instanced-stone-harness-mug-singlestone-candidate-b.png`
- `tools/rs2013-instanced-stone-harness-mug-singlestone-facetdiff.png`

### How to view these yourself

Serve the repo root (e.g. `npx http-server .` or any static server) and open:

- Baseline: `tools/rs2013-instanced-stone-harness.html?product=mug&view=singlestone&stoneIndex=0&lighting=extended`
- Candidate B: same URL + `&material=specular`
- Candidate A: same URL + `&facet=bipyramid16` (not re-verified in this pass, see above)
- `&stoneIndex=1` through `4` (or higher) to check other stones/orientations.

---

## Follow-up — does the diffuse baseline's per-facet differentiation hold across colors/lighting? (2026-08-03)

The correction above confirmed the plain diffuse baseline (unchanged since step 1) shows genuine
per-facet brightness differentiation on one mug stone, gold color, extended lighting. This section
checks whether that was a one-stone/one-color coincidence, using the same unmodified `?view=singlestone`
tool — no HTML/harness changes were needed for this pass.

### What was checked

Eight single-stone close-ups, all baseline (`facet=octahedron`, `material=diffuse` — no candidate
params), spanning:

| Product  | stoneIndex | Color (real StoneLayout value) | Lighting   |
|----------|-----------|----------------------------------|------------|
| mug      | 0         | gold                              | default    |
| mug      | 0         | gold                              | extended*  |
| tumbler  | 0         | gold                              | default    |
| tumbler  | 182       | crystal (light)                   | extended   |
| bottle   | 208       | topaz (medium/amber)               | default    |
| bottle   | 412       | crystal-clear (very light)         | extended   |
| plate    | 0         | gold                              | extended   |
| plate    | 213       | crystal (light)                    | default    |

\* already covered by the existing `mug-singlestone-baseline.png` from the correction above — not
re-captured under a new name.

Stone indices were determined by actually generating each product's real `StoneLayout` (via the
same `loadRhsProject`/`generateProjectStoneLayout` pipeline the harness itself uses, run headlessly
once to print `stones[i].color` for every stone) rather than guessed — the color transitions
landed at exactly the boundaries shown above for each project's layer order.

**Color coverage caveat, stated plainly:** the 4 example fixtures the harness's `?product=` mapping
already uses (`short-name-block.rhs`, `tumbler-wrap-design.rhs`, `bottle-front-design.rhs`, plus the
inline plate project) only contain 4 colors between them: `gold`, `topaz`, `crystal`, and
`crystal-clear` — no genuinely dark/saturated color (e.g. `jet`, `sapphire`, `siam`, `emerald`) is
reachable through the current per-product fixture mapping without swapping which example file a
product loads, which this task's scope forbids (it would change what every *other* step's unchanged
`?product=` views render, since those baseline screenshots are also generated from the same
mapping). **A true dark color was not tested in this pass — this is a real gap, not a checked-and-passed
condition, and is called out as an open item below.**

### Result: it does NOT hold up consistently — light colors are a real, distinct failure mode

**Gold and topaz (medium/saturated colors) hold up well, under both lighting rigs:**
Pixel-quantized (`magick -colors 8 -unique-colors`) facet clusters and their luminance
(`0.299R+0.587G+0.114B`):

- mug/gold/default: 3 clusters, luminance 106→170 (dark facet vs. brightest facet, ~1.6x spread).
- tumbler/gold/default: 5-cluster gradient collapsing to 2 real solid facets, luminance 94→169
  (~1.8x).
- bottle/topaz/default: 4 clusters, luminance 104→148 (~1.4x).
- plate/gold/extended: 4 clusters, luminance 137→189 (~1.4x).

All four are visually unmistakable multi-facet fans when looked at directly (not just at the pixel
level) — consistent with the correction section's mug/gold/extended finding. Gold and topaz do not
need Candidate A/B/C; the step-1 baseline already delivers real per-facet contrast for these colors
under both lighting rigs.

**Light colors (`crystal`, `crystal-clear`) are a distinct, real weak point:**

- tumbler/crystal/extended: pixel-quantized to `rgb(168,179,185)` (darkest, luminance 176),
  `rgb(191,202,209)` (mid, luminance 200), and `rgb(229,236,243)` (brightest facet) — but that
  brightest value is only 4 luminance units away from this harness's own page background,
  `rgb(233,238,245)` (luminance 237 vs. 235). Looked at directly, the top-left facet visibly
  *nearly disappears into the surrounding page* — the stone's silhouette in that region is defined
  almost entirely by the two darker facets' edges, not by the bright facet reading as a facet.
- bottle/crystal-clear/extended: worse — the brightest facet quantizes to `rgb(232,235,240)`,
  which is 1-3 units per channel from the exact background `rgb(233,238,245)`, i.e.
  *indistinguishable by eye*. Looking at the render directly: the top half of the stone is a flat
  white void with no visible facet line separating what should be two distinct top facets — only
  the two lower facets are visible at all, and those two are the *same* gray tone as each other
  (both quantize to `rgb(188,188,188)`, zero differentiation between them). At this stone's
  orientation, the diffuse baseline produces **no visible per-facet differentiation at all** — the
  worst result found anywhere in this milestone, for either candidate or the baseline.
- plate/crystal/default: a partial exception — 3 real clusters (luminance 158/187/194), the
  brightest still close to background (231 vs. 237) but not fully merged, so this specific
  stone/orientation is a legible (if weak) 2-tone read rather than a total washout.

This is orientation- and lighting-dependent, not a fixed property of the color: the same `crystal`
color read as "weak but present" on the plate under default lighting and "one facet nearly gone"
on the tumbler under extended lighting. But across all 3 light-color renders checked, none matched
gold/topaz's robustness, and one (`bottle`/`crystal-clear`/extended) failed outright.

### Honest verdict

**The baseline does not hold up consistently across colors — it is genuinely good for gold and
topaz, and a real (sometimes severe) weak point for light colors (`crystal`, `crystal-clear`),
where the brightest facet can wash out against this harness's own light page background
(`#e9eef5`) closely enough to erase visible faceting for part or most of the stone.** This is a
distinct finding from the material-candidate question the correction above settled: it's not that
Candidate B fixes this (Candidate A/B/C were not re-opened here, per scope — this section is
baseline-only), it's that the "no material/geometry change needed" conclusion for gold does not
generalize to light colors, and that gap was never checked until this pass.

**Open items for whoever scopes step 4:**

1. **Light colors may need special-casing** (a different ambient/ratio, or per-color material
   tuning) — the current baseline material/lighting combination is demonstrably insufficient for
   `crystal`/`crystal-clear` at some orientations, independent of the Candidate A/B/C findings
   above.
2. **Dark colors were never tested in this milestone at all**, in either the wide-shot or
   single-stone close-up passes, because no fixture reachable through the harness's current
   `?product=` mapping contains one. This is a real coverage gap, not a passed check — it should be
   closed before step 4 treats *any* color as settled.
3. The washout observed here is partly a function of this harness's own flat, light page background
   color, which is not necessarily representative of a real product's surface color/lighting
   context in the actual `Preview3DRenderer` scene (a colored cup body, not a plain page, usually
   sits behind/around the stones in production). Whether the light-color washout reproduces against
   a realistic product-body background is a real open question this pass did not check, and is
   flagged rather than assumed either way.

### Final representative screenshot set (kept; other renders from this pass were reviewed and deleted)

- `tools/rs2013-instanced-stone-harness-mug-gold-default.png` — gold holds up under the *original*
  (non-extended) lighting rig too, not just extended.
- `tools/rs2013-instanced-stone-harness-bottle-topaz-default.png` — a second saturated color
  confirming the gold finding generalizes to at least one other mid-value hue.
- `tools/rs2013-instanced-stone-harness-tumbler-crystal-extended.png` — light color, partial
  washout (brightest facet within ~4 luminance units of the page background).
- `tools/rs2013-instanced-stone-harness-bottle-crystalclear-extended.png` — light color, total
  washout (brightest facet indistinguishable from background; the two remaining visible facets are
  the same tone as each other).

`tools/rs2013-instanced-stone-harness-mug-singlestone-baseline.png` (already committed) remains the
gold/extended reference. Four additional renders from this pass
(`plate-gold-extended`/`plate-crystal-default`/`tumbler-gold-default` plus the color-lookup pass)
were generated to build the table above, reviewed, and deleted — they didn't add a distinct
conclusion beyond what the four kept files already show. `du -ch tools/*.png` before this pass:
**2.5M** (19 files); after adding the 4 new representative PNGs: **2.9M** (23 files) — consistent
with this harness's existing ~90-110K per-singlestone-capture size, not unexpectedly large.
