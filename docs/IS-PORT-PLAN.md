# IS port plan: what PatternNifty improved, and how to bring it back to RS

Status: read-only audit, 31 Oct 2026. No code changes, no provider calls, no service started.

## 0. What was read

- **RS:** branch `is-port-audit`, made from `develop` at `060e50c`. `develop`'s tree is identical to
  `38cd831` (the 2.0.0 merge into `main`): `git diff 38cd831 develop` is empty.
- **IS (PatternNifty):** `main` at **`e9e7014ec5da5e545d694e927ec51634f5176fc1`** ("Merge PN-04h lone
  white stones on skin", 31 Oct 2026).
  - The local IS checkout's `main` is stale at `5721965` (26 Oct). It has no colour prompt v4, no
    lone-white-skin rule and no enclosed-speck fill.
  - So `origin/main` was cloned into a scratch folder and read there. The IS repository itself was
    not changed or fetched.
  - The archived tags (`archive/exp-faces`, `archive/exp-engine`) and the reverted PN-08
    ("buy first") work were ignored.
- **IS sources used:**
  - every copied file that starts with `From Rhinestone-Studio @38cd831`, diffed against that RS
    path at `38cd831`;
  - IS `services/strass/ORIGIN.md`;
  - IS `docs/IS-001-Spec.md` (revision notes, sections 6–9, 16, Appendix A);
  - the results docs: IS-03b, IS-04, IS-05b/c/d, exp-holes, is-07a-landmarks, skin-check,
    skin-prompt.

Below, "IS path" means a path in the IS repository. A path with no prefix is in RS.

---

## 1. Every IS change that touches turning an image into stones

### 1.1 Prompt (IS `src/pipeline/prompt.js`, from RS `server/redraw/prompt.mjs`)

| # | Change | IS version |
| --- | --- | --- |
| P1 | Section 6, first rule: "Square image…" becomes "Use the whole image at the highest resolution available, in the same shape (width to height) as the uploaded image." | colour 3 |
| P2 | Rule 1: the sentence "Make the stones large: about 60 stones across the full width of the image." is removed. IS-03b measured that the model ignores it: it draws at a nearly fixed pixel pitch, and the counts across moved −1, +5 and −7 with and without it. | colour 3 |
| P3 | Skin ramp line: "skin (every skin tone, from the lightest to the deepest; deep skin uses the dark end of this ramp): …" (`SKIN_RAMP_LINE`). | colour 4 (PN-10) |
| P4 | New rule after the Topaz rule: "Keep each person's skin tone, lightness and undertone as the photo shows them. Never lighten or whiten skin: each face stays as light or as dark as it is in the photo." (`SKIN_TONE_RULE`). | colour 4 (PN-10) |
| P5 | Black & white **Shaded** (halftone, IS spec Appendix A). Section 4 is Jet + Crystal only; mid-tones are mixed "in clear patterns (rows or patches)"; strong Jet outlines. A matching final-check sentence. | shares colour's number (4) |
| P6 | Black & white **Bold** (stencil). Every area is solid Jet or Crystal, never mixed or speckled. Faces have light skin in Crystal and shadows and hair in solid Jet. **Eye rule:** the eyes are never part of a dark area: white in Crystal, iris and pupil in Jet, one Crystal catch-light, and at least one Crystal row between the eye and any shadow or eyebrow. Its own final check. | stencil 5 |
| P7 | No flat style; no size line. | — |

**PN-10 result** (IS `docs/skin-prompt.md`): "the goal is not met".
- 8 of the 16 runs came within ±8 L\* of the photo.
- It helped medium-dark and tanned skin.
- The cool-light photo and the painting stayed far too light, and one tight close-up got darker.
- No light-skin subject came out darker than its photo.
- IS kept v4 anyway.

### 1.2 Provider call and model input (IS `src/pipeline/provider.js`, `src/pipeline/design.js`)

| # | Change |
| --- | --- |
| C1 | `size: 'auto'` instead of RS's fixed `1024x1024`, so the output follows the input's shape. IS-03b: about 1.5–1.6 MP at roughly the input's aspect. |
| C2 | The model input is cropped to the cut-out (pixels with alpha ≥ 128) plus a 3 % margin, then fitted to 1024 px on the long side with no padding to a square. IS-03b: the small dog in a wide photo went from 934 to about 2,050 stones. |
| C3 | The whole-image prompt line (P1) goes with C1. |

The cut-out itself comes from IS's own background removal (rembg/BiRefNet, `POST /remove-background`).
RS has no background removal; RS's input is the upload fitted inside 1536 px
(`src/redraw/index.js`).

### 1.3 Strass layout service (IS `services/strass/`, from RS `services/strass-layout/`)

All rule changes are `Rules` fields that default to `False`. `PROTOTYPE` and `BUILD_E` … `BUILD_I`
are unchanged, so the equivalence and golden tests still hold. Only `DEFAULT` changes.

| # | Rule / change | What it does | IS `DEFAULT` |
| --- | --- | --- | --- |
| S1 | `plausible_eyes` + `report.pupilsAtMm` | 0 or 1 pupil is fine. Two must be a plausible pair: sizes within ×1.6, slope ≤ 0.5, apart ≤ 0.45 of the subject width. Of more than two, exactly one passing pair is kept and the rest become ordinary stones. Otherwise there is no face: no eye stage and `face: null`. Fixes the car (19 "pupils" on wheel spokes) and the giraffe. | on |
| S2 | `soft_outlines` off | RS turned black outline stones on skin into Smoked Topaz. Off lowers the colour error where it acted (woman 7.73 → 7.02 ΔE). | off (RS: on) |
| S3 | `sample_delivered` | Each stone's colour is read at its delivered position from the inner 60 % of its radius, not at the detection it came from. Fill stones read their own pixels too. No stone moves. | on |
| S4 | `human_iris` off | No SS4 iris rings around a person's pupils (they sampled the eye white and snapped to Grey/Silver: "goggles"). Animals keep their rings. | off (RS: on) |
| S5 | `skin_nearest_inner` | `skin_nearest` reads the inner 60 % of each stone, not the whole disc, which took in the dark gaps (90 warm shadow stones → Smoked Topaz on the woman). | on |
| S6 | `warm_shadow`, `warm_shadow_de = 3` | A skin stone whose nearest skin colour is Smoked Topaz takes Colorado Topaz when that is at most 3 ΔE further. 11 of 21 designs changed, almost all Smoked → Colorado. | on |
| S7 | `mixed_shadow` | Alternates Smoked/Colorado along rows. | off (experiment) |
| S8 | `lone_white_skin` (PN-04h) | An SS4/SS6 Crystal Clear, Crystal or Silver stone with at least 4 neighbours, all skin colours, outside 1.5 eye-zone radii, takes its neighbours' most common colour (on a tie, the lighter). Catch-lights, teeth and white-among-white are kept. | on |
| S9 | `fill_exact`, `fill_cover_mask` | The service's own hole fills: an exact 0.1 mm gap and cover measured on the strict mask. | off (experiment) |
| S10 | Edge crash, `colour.py` | `stone_colours` reads the nearest pixel when a stone has no pixel within its radius. This path is reachable only with S3 on. | always |
| S11 | Edge crash, `eyes.py` (**an RS bug**) | `_find_inscribed`'s window is clamped to the image size. Today a dark disc cut by the image border crashes RS with `IndexError`. | always |
| S12 | `report.fillAtMm` | Centres of the stones the service's fills placed. Used only by IS's optional `IS_SERVICE_FILL_NEIGHBOURS` (off). | report key |
| S13 | `report.discsAtMm` | The AI's detected discs. Was for an IS experiment that has since been removed; kept "for experiments". | report key |
| S14 | Face model (IS-07a) | See 1.4. | — |
| S15 | `POST /remove-background` (rembg, BiRefNet) | Background removal for IS's upload step. | IS-only |

### 1.4 Face model (IS-07a)

- `strass_layout/models.py` loads **MediaPipe Face Landmarker** (`models/mediapipe/face_landmarker.task`,
  3.8 MB, committed, SHA-256 checked) instead of dlib.
- `landmarks()` (68 points) becomes `eye_contours()`: the same six points per eye, in dlib's order.
- RS's three-blur search and the 0.12 face-width floor are kept. dlib's 2× upsampling is dropped.
- Two additions:
  - detection and presence confidence of 0.6 (at 0.5 MediaPipe fitted a face to the RS dog);
  - a mesh whose iris centres are closer than 0.25 of the ear-to-ear width is not a face.
- **dlib is test-only:**
  - IS `tests/dlib_faces.py` gives the equivalence test RS's dlib landmarks;
  - that test is skipped without dlib;
  - `setup_mac.sh --with-dlib-tests` installs dlib and its model;
  - `requirements.txt` no longer lists `dlib-bin`, and the Dockerfile no longer fetches the model.
- IS `tests/test_is07a.py` checks that no service file imports dlib.
- **Measured** (IS `docs/is-07a-landmarks.md`) on the 12 RS images and 9 CC0 AI images:
  - every face and pupil is the same, except `rs-lake`, where dlib had found a "face" on a cloud and
    MediaPipe finds none (no pupils either way, so the layout is identical);
  - one service stone differs on `rs-woman`;
  - 0 violations; all accepted.

### 1.5 Node steps after the layout (IS `src/pipeline/`)

| # | Step | IS file | What it does |
| --- | --- | --- | --- |
| N1 | SS16 cap, SS20 pupils | `tiers.js` `capStoneSizes`, `pupilCentres` | Every stone above SS16 snaps to SS16 at the same centre. The two stones at `pupilsAtMm` (only when `face` is set and there are exactly 2) are capped at SS20 instead. This is IS product decision D2. |
| N2 | Overlap cleanup | `cleanup.js` `removeCloseStones` | For each pair below a 0.1 mm rim gap, worst first, remove the smaller stone. On a size tie, the one with fewer neighbours (rim gap < 0.5 mm); then the later one. |
| N3 | Hole fill | `holes.js` `findHoles`, `fillHoles` | The subject is the AI alpha ≥ 128, closed with a 1 mm disc, with enclosed transparent areas ≤ 2π mm² filled. Greedy farthest-spot-first: SS6 while one fits, then SS4. Exact 0.1 mm gap; the stone lies wholly inside the subject (20 px/mm grid). On 21 designs: 235 holes → 0, all still accepted. |
| N4 | Neighbour colour vote | `holes.js` `neighbourVote` | A filled stone takes its neighbours' colour: stones within 1 mm of its edge each weigh 1 − gap/1 mm, highest total wins, ties go to the nearest. Rounds decide filled-next-to-filled. Fixes "lone dark stones" from reading the AI's dark gap paint. |
| N5 | Black & white mapping | `bw.js` `mapBlackAndWhiteFromImage` | Each delivered stone's mean L\* of the AI image composited on white, inner 60 % of its radius: L\* < 55 → `jet`, else `crystal-clear`. Voted stones (N4) take Jet or Crystal by the same vote. The service's colour snapping is bypassed. |
| N6 | Acceptance and re-run | `design.js` `acceptLayout` | Accepted when the cleanup removed < 3 %, coverage ≥ 0.5, 0 gap violations on IS's own check, and ≥ 300 stones. Otherwise one automatic re-run (another provider call). |
| N7 | Coverage after cleanup | `cleanup.js` | The service's coverage × (area under delivered stones / area under service stones), at 10 px/mm. |

IS's `holes.js` re-implements service logic in JS: sRGB→Lab, ΔE2000, the snap rules (`WARM_BLOCK`,
`NO_LOW_HUE`) and the subject mask. The pipeline itself only uses them in the "pixels" tool mode.

### 1.6 Tinted render (IS `src/render/tinted.js`, `bw-gaps.js`)

The buyer's only view. It reads the final StoneLayout and never changes it.

| # | Rule |
| --- | --- |
| T1 | Canvas = the stones' box + 2 main-stone diameters. |
| T2 | A pixel outside every stone takes the colour of its nearest stone, measured to the stone's edge. |
| T3 | **Gap colour rule:** the fill darkened by 4 L\* + 0.05 L\* per L\* above 80, and at least 8 L\* when the fill is above L\* 85. Hue is kept; linear RGB is scaled (`GAP_RULE`). |
| T4 | **Reach 0.6 mm** beyond the stone's edge for every size (`FILL_MARGIN_MM`). Beyond it the background shows. |
| T4b | **Enclosed specks** (PN-04d): an area still open, enclosed by the design (4-connected, not touching the canvas edge) and ≤ 2π mm², is filled by its nearest stone however far. Larger holes and the outside keep the background. |
| T5 | **B&W gap rule** `BW_GAP = crystal` (the default): where the second-nearest stone is also within reach and differs, use the lighter stone's gap colour, so dark gaps show only between Jet stones. Options: `nearest`, `white`, `black`. |
| T6 | **Jet rim:** a stone above SS6 whose stroke is lighter than its fill (only Jet) gets an SS6-width rim. RS's 0.09-radius stroke made a pupil's light ring 2.35× wider. |
| T7 | **Stone lightness hold:** the inner 60 % of each drawn stone is brought within 4 L\* of its catalogue fill, then the whole stone within 2. Too light is scaled down; too dark is screened towards white. The change fades over 0.2 radii. |
| T8 | The stones are drawn with the RS `drawCrystalStone`, unchanged. |

IS measured the tinted view against the AI image: mean cell ΔE 10.8 → 8.7 over 21 designs.

### 1.7 Exporters (IS `src/export/`)

| # | Change |
| --- | --- |
| E1 | **EPS** (`epsExport.js`, new): EPSF-3.0 straight from the StoneLayout. Bounding box at true size in points, one filled circle per stone grouped by colour, y flipped. |
| E2 | **AI** (`aiExport.js`, new): a one-page true-size vector PDF (design + 5 mm margin) built with `PdfDocument` and saved as `.ai`. |
| E3 | **Production sheet:** the Gap line is always in mm. In inches 0.1 mm prints as "0 in" (**this bug is in RS today**: `formatLengthDisplay(0.1, 'in')` rounds to 0). The other IS changes (no Object/plate lines, branded footer) are IS-only. |
| E4 | **PDF metadata** (`pdfInfo.js`): Producer/Creator/Title added as an incremental update, so the copied `PdfDocument.js` stays byte-identical to RS's. |
| E5 | **PNG** at 300 dpi with a `pHYs` chunk (`pngExport.js`, resvg in Node). |
| E6 | SVG, DXF: unchanged copies; DXF only sets `$LASTSAVEDBY`. |

---

## 2. RS changes since `38cd831` that could conflict

**None.** `develop` (`060e50c`) and `38cd831` have identical trees. The only local branches with
commits not in `38cd831` (`docs/log-drawing-tool-coverage-gap`, `feature/read-011-rating-page`)
predate it and do not touch the image pipeline.

A port can still conflict with work IS deleted or never took. Where RS has more than IS:

- **Saved ai-layout layers.** RS stores `aiLayout.stones` in the project (D4, C1), so a project
  reopens without the AI or the service. Every service change only affects new redraws. That keeps
  backward compatibility, but old and new layers will look different.
- **Design editing.** `src/redraw/AiLayoutEdit.js` edits stones by their index in
  `aiLayout.stones`. Anything that adds or removes stones (N2, N3) must run before the layout is
  saved, never on a saved layer.
- **S14 enlarge-only scaling.** IS has no products. In RS the natural size is the smallest an
  ai-layout layer can be. C1 (`size auto`) makes tall or wide subjects much bigger (IS-03b: up to
  80 × 309 mm), which matters on vessels (BACKLOG row 77).
- **The fallback.** When the layout fails, RS uses the IMG-023 AI-stones path; IS re-runs.
- **Test harnesses that grep source.** `tools/test-img-022-redraw-provider.mjs` T1 compares the
  prompt text with the spec appendix; `tools/test-img-026-redraw-jobs.mjs` checks the exact
  multipart request (it will see `size`); the service's `tests/test_contract.py` has a fixed
  `REPORT_KEYS` list.

---

## 3. Change by change: where it goes in RS and how to port it

Architecture check (CLAUDE.md):
- one GeometryEngine;
- one StoneLayout pipeline;
- no stones made in renderers or exporters;
- no rewrites of working subsystems;
- Python only in `services/strass-layout/`.

For ai-layout layers the **service is the stone producer**, and `GeometryEngine.generateImageLayout()`
→ `_generateAiLayoutStones()` turns `aiLayout.stones` into `Stone`s. So anything that adds, removes,
resizes or recolours stones belongs **in the service**, before the list reaches the app. It must not
go in `server/redraw/` (Node), which would be a second producer. Renderers and exporters only read the
StoneLayout.

Size: S = under a day, M = 1–3 days, L = 3–5 days.

### 3.1 Licence: face model (S14)

| | |
| --- | --- |
| Plain words | Find faces with a model we may use commercially. |
| IS | `services/strass/strass_layout/models.py`, `post.py` (`_eye_boxes`), `tests/dlib_faces.py`, `tests/support.py`, `tests/test_equivalence.py`, `tests/test_is07a.py`, `requirements*.txt`, `scripts/setup_mac.sh`, `Dockerfile`, `models/mediapipe/face_landmarker.task` |
| RS place | `services/strass-layout/strass_layout/models.py` (`import dlib`, `landmarks()`), `post.py` (`_eye_boxes`), `requirements.txt` (`dlib-bin==19.24.6`), `scripts/setup_mac.sh` and `Dockerfile` (download the dlib model) |
| Fits rules | Yes. It stays inside the service, which still produces stones only over HTTP. |
| Goes in | strass-layout service |
| How | **Copy.** The IS files are RS files plus marked changes. Rename the `IS (IS-07a)` notes to the RS milestone. Commit the 3.8 MB `.task` model (well under GitHub's 50 MB warning). |
| Risk | Low for layouts (measured identical apart from rs-lake/rs-woman). Medium for install: the Intel iMac's first MediaPipe install was never run (IS-07a says so). |
| Size | S–M |
| Tests | Existing: `test_golden`, `test_equivalence` (must switch to dlib-in-tests), `test_contract`, `test_build_*`. Missing: a `test_is07a`-style "no dlib import" test, and a check that the model's SHA matches. |

### 3.2 Service rules S1–S8, S10–S13

| | |
| --- | --- |
| Plain words | Better eyes (no false pupils, no goggle rings); colours read where the stone really sits; warmer, cleaner skin; no white specks in skin; two crash fixes. |
| IS | `strass_layout/rules.py`, `post.py`, `ordered.py`, `pipeline.py`, `faces.py`, `colour.py`, `eyes.py`, `geometry.py`; tests `test_is05b.py`, `test_is05c.py`, `test_is05d.py`, `test_exp_holes.py`, `test_pn04h.py`, `test_build_j.py`, `test_contract.py` |
| RS place | The same files under `services/strass-layout/` |
| Fits rules | Yes. Every rule is a `Rules` flag and `PROTOTYPE`/`BUILD_*` stay as they are. Stones still come only from the service and the one engine. Saved layers do not change. |
| Goes in | strass-layout service |
| How | **Copy** S1, S3–S6, S8, S10, S11 and `pupilsAtMm`. **Adapt** S2 (`soft_outlines` off is a judgement call: ask, see Q3). Copy S9 and S7 as off-everywhere flags, or skip them; they are experiments. Copy S12/S13 only if a later RS step uses them (S12 is needed only for an optional service-fill vote; S13 for nothing). Add an RS `BUILD_J` constant that freezes today's `DEFAULT`, matching how builds E–J were frozen, so `test_build_j` keeps comparing like with like. |
| Risk | Low to medium. Colours change on new redraws; positions change only through S1 (no eye stage on non-faces). The IS tests read only the 12 RS images and `sunburst_flower.png`, which RS already has. |
| Size | M |
| Tests | Existing: `test_rules`, `test_build_f`…`_j`, `test_golden`, `test_contract` (`REPORT_KEYS` += `pupilsAtMm`), `test_report`. To add: the IS tests ported, plus a regression test for S11 (`DarkDiscAtTheEdge`). On the Node side, `tools/test-img-026-ai-layout-app.mjs` should accept the new `report` key and `face: null` (check `validateProject()`). |

### 3.3 Prompt and provider call (P1–P4, C1–C3)

| | |
| --- | --- |
| Plain words | Keep each person's skin depth; stop the AI drawing a square when the photo is not square; send the AI only the subject. |
| IS | `src/pipeline/prompt.js`, `provider.js`, `design.js` (`modelInput`, `subjectBox`) |
| RS place | `server/redraw/prompt.mjs` (`V6_HEAD`, `V6_TAIL`, `PROMPT_VERSION`); `server/redraw/handler.mjs:114` (`size`); `src/redraw/index.js:67` (input fitted to 1536 px) |
| Fits rules | Yes. These are text and request changes; no geometry. |
| Goes in | redraw (server prompt and handler; the browser for the crop) |
| How | **Copy** P3 and P4 as prompt v7. **Decide** P1, P2, C1 and C2 together (Q1). If RS keeps square output, keep "Square image" and probably the 60-across sentence. The smallest RS crop: when the upload has real transparency, crop to its alpha box + 3 % before the fit to 1536 px. RS has no background removal, and adding rembg/BiRefNet would be a separate, larger decision. |
| Risk | Medium. A prompt change moves every new design. `size auto` changes natural sizes, and S14 cannot shrink them. Provider calls are needed to measure it. |
| Size | S (P3/P4 only) to M (with C1/C2 and a measured run) |
| Tests | Existing: `tools/test-img-022-redraw-provider.mjs` T1 (reads the spec appendix, so a new Appendix E is needed), `tools/test-img-026-redraw-jobs.mjs` (multipart request). Missing: a test for the alpha-box crop. |

### 3.4 Post-layout clean-up: overlap cleanup, hole fill, neighbour vote, cap (N1–N4, N7)

| | |
| --- | --- |
| Plain words | Never two stones closer than 0.1 mm; fill every gap where an SS6 or SS4 fits; give filled stones their neighbours' colour; optionally cap large stones. |
| IS | Node: `src/pipeline/cleanup.js`, `holes.js`, `tiers.js` |
| RS place | **None** (RS's engine only flags violations). The matching service stage is after `post_process()`/`finish_faces()`, before the S1 crop and S2 report in `strass_layout/pipeline.py`. |
| Fits rules | Not as IS built it. In RS these would be a second stone producer if they ran in `server/redraw/`, and the renderer or engine must not add stones either. **They fit in the service**, which already has the AI image, the alpha mask, `GAP`, `geometry.fill`, `stone_colours` and the palettes, so nothing needs re-implementing. |
| Goes in | strass-layout service, as `Rules` flags (`overlap_cleanup`, `hole_fill`, `fill_vote`; the cap as a request option, see Q2) |
| How | **Redesign** in Python. Port the algorithms (worst-pair-first removal with the neighbour tie-break; farthest-spot greedy SS6-then-SS4 fill on a 20 px/mm grid; weighted vote in rounds). Reuse the service's own subject mask and colour code instead of IS's JS copies. Report `removed`, `filled` and coverage after the clean-up. Compare with the service's existing `fill_exact`/`fill_cover_mask` (S9), which attack the same holes inside the service's own fill. |
| Risk | Medium. It adds and removes stones, so it must run before `aiLayout` is saved (Design edits by index). Runtime is small next to StarDist. |
| Size | L |
| Tests | Missing: unit tests for each step (port IS `tools/test-cleanup.mjs` and `tools/test-holes.mjs` cases to Python); figures on the 12 images (0 removed, holes → 0, no gap below 0.1 mm); `test_report` (the report is recomputed after the new stage). Existing: `test_golden` stays on `PROTOTYPE`-equivalent rules. |

### 3.5 Acceptance and re-run (N6)

| | |
| --- | --- |
| Plain words | Reject a bad layout automatically and try once more. |
| IS | `src/pipeline/design.js` `acceptLayout`, `rerunOrFail` |
| RS place | `server/redraw/jobs.mjs` (today a layout failure keeps the AI image and falls back to IMG-023) |
| Fits rules | Yes. It is job control, not geometry. |
| Goes in | redraw (job) for the decision; the service reports the numbers |
| How | **Adapt.** With 3.4 in the service, the 0-violation and coverage checks come from the service report. A re-run costs a second provider call (Q4). |
| Risk | Low, but it costs money. |
| Size | S |
| Tests | `tools/test-img-026-redraw-jobs.mjs` (new stage, re-run count). |

### 3.6 Black & white (P5, P6, N5)

**RS has no Black & white mode** (no `bw` style, setting or code path).

| | |
| --- | --- |
| Plain words | A Jet + Crystal design, either Bold (solid areas) or Shaded (mixed patterns). |
| IS | `src/pipeline/prompt.js` (Appendix A, stencil), `src/pipeline/bw.js`, `holes.js` (`lightnessOnWhite`, vote) |
| RS place | Prompt: `server/redraw/prompt.mjs` (`REDRAW_STYLES`, `PROMPT_VERSIONS`). Mapping: none. Layer data: `layer.redraw.style` via `RedrawLayerTransform.js`. Lightbox: `src/ui/ImageStudioState.js`, `index.html`. |
| Fits rules | Yes, if the Jet/Crystal mapping is done **in the service**, which has the image, the frame and an inner-60 % reader (`ordered.delivered_lab`). Doing it in Node (as IS) would need image decoding in `server/` and would be a second colour producer. |
| Goes in | redraw (prompt styles + UI) and the strass-layout service (mapping) |
| How | **Smallest fitting version:** add redraw styles `bold` and `shaded` beside `stones` (IMG-024's per-style version precedent; additive, so old layers still validate). Pass `"mode": "bw"` in the `/layout` options. Behind a `bw_from_image` rule the service sets every stone to `jet` or `crystal-clear` by the mean L\* on white of its inner 60 % (threshold 55), with filled stones taking the vote of 3.4. Lightbox: one Colour / Bold / Shaded choice. **Adapt** the IS logic; **copy** the prompt texts. |
| Risk | Medium. It touches the project schema (a new style value), the lightbox and the service contract. Needs a spec review per MILESTONE_WORKFLOW ("persistent data-format change"). |
| Size | M–L |
| Tests | Missing: prompt text tests (as T1), a service test for the mapping, `validateProject()` with the new style, and lightbox state. Existing to update: `tools/test-img-026-lightbox.mjs`, `tools/test-img-026-ai-layout-app.mjs`. |

### 3.7 Tinted view (T1–T8)

**RS has no tinted view.** It has "Background: White / Product" on the 2D canvas (build I): gaps show
the product colour, and stones are drawn by `drawCrystalStone` as they are.

| | |
| --- | --- |
| Plain words | A preview that looks like the finished piece: gaps tinted by their stone, true stone lightness, no white specks, thin pupil rims. |
| IS | `src/render/tinted.js` (`gapRgb`, `nearestStones`, `tintPixels`, `enclosedGaps`, `keepStoneLightness`, `drawStone`) |
| RS place | `src/renderer/CanvasRenderer2D.js` `renderProductionLayout(…, { backgroundColor })`; `app.js` `canvasBackgroundColor()` and `#canvasBackground` |
| Fits rules | Yes. It reads the StoneLayout only and never adds or moves a stone. B&W gap mode can be chosen from the colours present (only `jet` + `crystal-clear`), which is StoneLayout data, not a layer type. |
| Goes in | renderer |
| How | **Adapt.** Add a third option, "Background: Tinted". The renderer paints the gap layer (T2–T5) into `ImageData`, draws the stones as today, then applies the rim fix (T6) and the lightness hold (T7). It is a view setting like build I's: not saved, not in history, never in exports. Do not touch Design (`DrawingCanvasTool`) at first. |
| Risk | Medium: per-pixel work in the browser on 3–4k stones at device-pixel ratio 2. Profile on Chrome 103. No `@napi-rs/canvas` needed in the browser. |
| Size | M |
| Tests | Missing: unit tests ported from the tinted cases in IS `tools/test-exports.mjs` (a pixel at 0.5 mm is filled, 0.7 mm is not; the gap L\* step; a 4b speck filled; a hole of more than 2π mm² not filled; lightness within 3/5 L\*). Existing to extend: `tools/test-img-026-product-background.mjs`, `tools/test-crystal-stone-renderer.mjs` (must stay unchanged). |

### 3.8 Exporters (E1–E5)

| | |
| --- | --- |
| Plain words | EPS and AI files for cutters and designers; the inch sheet's gap line fixed; PDF metadata. |
| IS | `src/export/epsExport.js`, `aiExport.js`, `pdfInfo.js`, `pngExport.js`, `ProductionSheetExporter.js` |
| RS place | `src/export/` (`SvgExporter.js`, `DxfExporter.js`, `PdfDocument.js`, `ProductionSheetExporter.js`); export buttons in `app.js`/`index.html` |
| Fits rules | Yes. Every exporter reads the StoneLayout only. |
| Goes in | exporter |
| How | **E3: copy** the one-line fix (Gap in mm whatever the unit). It is a real RS bug: 0.1 mm prints "0 in". **E1: copy** `designEps` into `src/export/EpsExporter.js`, with no Node `Buffer` in `src/` (return a string). **E2: adapt** (`PdfDocument` true-size page; RS already has it). **E4: redesign** for RS: RS owns `PdfDocument.js`, so add an optional Info dictionary there instead of patching bytes afterwards. **E5:** RS PNG export is a canvas capture, so a `pHYs` chunk needs a small browser CRC-32; optional. |
| Risk | Low (E3, E1, E2). Medium for E4, because single-page sheet bytes are hash-pinned in tests (RS-3041). |
| Size | S (E3) + M (E1, E2, E4) |
| Tests | Existing: `tools/test-production-sheet-exporter.mjs`, `tools/test-pdf-document.mjs`, `tools/test-rs3036-dxf-exporter.mjs`, `tools/test-img-026-ai-colours-sheet.mjs`. Missing: an EPS structure test (bounding box = design size, one circle per stone) and an AI test (one page, page size). |

### 3.9 Not proposed

- Background removal (S15, rembg/BiRefNet). It is an IS upload step and would be a new model and
  dependency in RS. Only revisit if C2 needs it.
- IS's tier code (`applyTier`), which IS keeps unused.
- The disc-reading B&W experiment (removed in IS).
- `mixed_shadow`.

---

## 4. Prompt numbering

RS is at stones `PROMPT_VERSION = 6` and `FLAT_PROMPT_VERSION = 1`. BACKLOG row 77 reserves
"PROMPT_VERSION 7" for the product-aware stone count. Every earlier build that took the next number
renamed that row (S10, build E, build F, build H). IS numbers its own prompts from 3 and is not a
basis for RS numbers.

| IS prompt | RS today | Proposed RS |
| --- | --- | --- |
| Colour v4 (= RS v6 + P1 + P2 + P3 + P4) | stones v6 | **stones v7** = v6 + P3 + P4. P1 and P2 are added only if Q1 says RS moves to `size auto`; otherwise v7 keeps "Square image" and the 60-across sentence. Appendix E in IMG-026. |
| Bold (stencil) v5, with the eye rule | none | **new style `bold`, `BOLD_PROMPT_VERSION = 1`** |
| Shaded (halftone, IS Appendix A), shares IS v4 | none | **new style `shaded`, `SHADED_PROMPT_VERSION = 1`** |
| — | flat v1 | unchanged |

- BACKLOG row 77 becomes "PROMPT_VERSION 8".
- Per-style numbering follows IMG-024 (each style versions itself). `layer.redraw.promptVersion`
  already records `PROMPT_VERSIONS[style]`, so no data change is needed beyond the new style values.
- If Alex prefers one shared counter, the alternative is stones v7, bold v8, shaded v9, with the
  BACKLOG row at v10.

---

## 5. Out of scope

Etsy (listing, OAuth, poller, matcher), codes and attempt limits, rate and daily limits, Turnstile,
legal pages, 30-day data deletion and withdrawal consent, hosting (Cloudflare/laptop, launchd,
nightly job, logs), the PatternNifty web app, control panel, watermark and brand (BRAND, footers,
names in file headers).

---

## 6. Licences of what the RS service ships today

Read from the installed package metadata in `services/strass-layout/.venv` (Python 3.12) and the
model sources.

| Item | Licence | Commercial use |
| --- | --- | --- |
| **dlib 68-point model** `shape_predictor_68_face_landmarks.dat` (downloaded by `setup_mac.sh` and baked into the Docker image, from `face_recognition_models==0.3.0`) | Trained on iBUG 300-W, whose licence excludes commercial use. dlib's author notes the trained model "can't be used in a commercial product". | **Blocked.** Used at runtime by `strass_layout/models.py` on every layout. |
| `dlib-bin` 19.24.6 (the library) | Boost Software License | OK, but only needed for the model above. |
| StarDist model `2D_versatile_fluo` (committed) | Distributed with StarDist (BSD-3). Trained on a subset of DSB 2018 / BBBC038, published as CC0. | OK. Confirm the training-data note once before launch (Q6). |
| stardist 0.9.2, csbdeep 0.8.2, scikit-learn, scikit-image, scipy, numpy, httpx, uvicorn | BSD-3 / BSD | OK |
| tensorflow 2.16.2, opencv-python-headless 4.11, python-multipart | Apache 2.0 | OK |
| fastapi | MIT | OK |
| pillow | MIT-CMU (HPND) | OK |
| FFmpeg inside opencv-python-headless | LGPL-2.1 (dynamic libraries in `cv2/.dylibs`) | OK unmodified (keep the licence file) |
| certifi, tqdm (transitive) | MPL-2.0 (tqdm MPL-2.0 AND MIT) | OK unmodified |
| *After the fix:* mediapipe 0.10.15 + `face_landmarker.task` | Apache 2.0 (library; Google's model card for the model, as IS recorded) | OK |

No other dependency in the venv declares a GPL or non-commercial licence. **Only the dlib model
blocks commercial use.** The `prototype/` code also imports dlib, but only the equivalence test runs
it.

**MediaPipe pin.** RS's service runs on the same Mac IS targets: Intel x86_64, macOS 13.7.8 (checked
with `uname`/`sw_vers`). RS pins the same `tensorflow==2.16.2` and `numpy==1.26.4`. So RS needs the
same setup:
- `mediapipe==0.10.15`: later Intel wheels are built for macOS 14.5 and will not load;
- installed with `pip install --no-deps`: MediaPipe's declared `jax`/`jaxlib` need ml-dtypes ≥ 0.4,
  which tensorflow 2.16.2 refuses, and `opencv-contrib-python` would sit on top of the headless
  OpenCV;
- in a separate `requirements-nodeps.txt`.

The Docker image (Linux) could take a newer MediaPipe. Keep the same pin there so Mac and server
give the same faces.

**How RS installs its service today:** `services/strass-layout/scripts/setup_mac.sh`:
1. requires `python3.12`;
2. creates `.venv`;
3. runs `pip install -r requirements.txt`;
4. falls back to building dlib from source if `dlib-bin` has no wheel;
5. downloads and SHA-checks the dlib model.

`scripts/start_layout.sh` runs uvicorn on 127.0.0.1:8000. The `Dockerfile` (python:3.12-slim) does
the same and fetches the dlib model into the image. The fix changes all three as IS did:
- MediaPipe from `requirements-nodeps.txt`;
- the `.task` model committed and SHA-checked;
- dlib and its model only with `--with-dlib-tests`, never in the Docker image.

---

## 7. Proposed milestones

IMG-026K (round 3D stones) is already merged, so the next build letter is **L**.

| # | Milestone | Scope (one line) | Done when |
| --- | --- | --- | --- |
| 1 | **IMG-026L — Face landmarks without dlib** | 3.1: MediaPipe Face Landmarker in the service, dlib test-only, nodeps pin, setup/Docker/README updated. | The service imports no dlib and starts and lays out with dlib uninstalled. `test_golden` passes. The 12 images give the IS-07a faces and pupils (only rs-lake differs). The equivalence test runs with `--with-dlib-tests` and skips cleanly without it. The Docker image contains no dlib model. `setup_mac.sh` has been run once on the iMac. |
| 2 | **IMG-026M — Eyes, colour reading and skin rules** | 3.2: S1, S3–S6, S8, S10, S11 and `pupilsAtMm` in `DEFAULT`; S2 per Q3; `BUILD_J` frozen. | The ported IS tests and all existing service tests pass. On the 12 images, stones and sizes match `BUILD_J` except where S1 removes an eye stage, and only colours change otherwise. 0 violations. `validateProject()` accepts `face: null` and the new report key. |
| 3 | **RS-3042 — Exporter fixes and EPS/AI** | 3.8: Gap in mm on inch sheets; EPS and AI exports; optional PDF Info in `PdfDocument`. Independent of the others; can go any time. | The inch sheet prints "Gap: 0.1 mm". EPS bounding box = design size with one circle per stone. AI opens as a one-page true-size PDF. Existing sheet hashes are unchanged, or re-pinned with a reason. |
| 4 | **IMG-026N — Prompt v7 and model input** | 3.3: P3+P4 as stones v7 (Appendix E); P1/P2/C1/C2 per Q1; BACKLOG row 77 → v8. | T1 reads Appendix E. The jobs test sees the agreed `size`. A measured run on the portrait set (a few provider calls, agreed beforehand) shows face ΔL\* no worse than v6. |
| 5 | **IMG-026O — Service clean-up and hole fill** | 3.4 + 3.5: overlap cleanup, hole fill with neighbour vote, optional cap, report figures; the job uses them for acceptance. | On the 12 images: 0 stones removed, 0 holes left where an SS4 fits, min gap ≥ 0.100 mm, no lone dark fill stones. `test_report` holds. The jobs test covers the accept/re-run rule. |
| 6 | **IMG-026P — Black & white (Bold, Shaded)** | 3.6: two redraw styles, the service's `bw` mode reading the AI image, the lightbox choice. Separate spec review first (schema). | The prompts equal their appendices. The service returns only `jet` and `crystal-clear` for `mode: bw`. Old layers validate unchanged. The lightbox shows Colour / Bold / Shaded. |
| 7 | **IMG-026Q — Tinted view** | 3.7: "Background: Tinted" on the 2D canvas with T1–T8; B&W gap rule chosen from the colours present. | The pixel-rule unit tests pass. `drawCrystalStone` is unchanged. A 4,000-stone layout redraws in an agreed time on Chrome 103. Not saved, not in history, never in exports. |

Order: the licence first, because RS is commercial today. Then the cheap, flag-gated service rules,
which give the largest measured quality gain for the least risk. Exporter fixes whenever there is a
gap. Then the prompt (needs provider calls and Q1), the clean-up (needs Q2), B&W (a schema change)
and the view.

---

## 8. Open questions for Alex

1. **Square or `size auto`?** IS moved to `size auto`, the whole-image line, no "60 across" and the
   cut-out crop. In RS a tall or wide subject would then come back much larger, and S14 cannot
   shrink an ai-layout layer. Keep square output in RS, or move to `size auto` and revisit S14 or
   the product-aware stone count (BACKLOG row 77)?
2. **Cap large stones?** IS caps everything above SS16 and keeps SS20 only for a face's two pupils
   (its product decision D2). Should RS cap too (and at what size), or keep SS30 pupils?
3. **`soft_outlines` off and `human_iris` off for people?** IS measured both as better on its 21
   designs. Both change how faces look in RS's own portraits. Adopt IS's defaults?
4. **Automatic re-run.** IS re-runs a rejected layout once, at the cost of a second provider call.
   RS falls back to the older AI-stones path. Which should RS do?
5. **Black & white in RS at all,** and if so both Bold and Shaded? Per-style prompt numbers
   (`bold` 1, `shaded` 1) or one shared counter (section 4)?
6. **Licence confirmation.** Is a manual check of the MediaPipe model card and of the StarDist
   training data (DSB 2018 / BBBC038, CC0) enough, or do you want a written licence note in the
   repository? Also: is RS's current use commercial, so that the dlib fix must land before any
   further production designs are made?
7. **The stale IS checkout.** The local IS `main` is five days behind GitHub (`5721965` vs
   `e9e7014`). Pull it, or keep reading from GitHub for future ports?
8. **Milestone names.** IMG-026L… continues the v2 build letters. Or start a fresh number
   (IMG-027A…) for "ports from IS"?
