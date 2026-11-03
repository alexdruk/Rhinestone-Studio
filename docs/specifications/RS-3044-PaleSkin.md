# RS-3044 — Pale skin in the layout service

## Why

On a person's lit skin the AI paints one pale cream, about L\* 93–96, that is not in the palette.
The colour step (`snap_colours`) splits it into Silk, Crystal, Metallic Sunshine and Citrine, so lit
skin gets single white and gold stones. `lone_white_skin` (build M) leaves them, because each touches
a non-skin neighbour, often another stone of the same cream. The diagnosis (white-stones, on one real
redraw) found 11 Crystal stones on skin left this way. PatternNifty has the same code and the same
problem and will port this change.

## What changed

- **`BUILD_O`** in `strass_layout/rules.py` freezes the `DEFAULT` that builds O to Q shipped, so older
  tests compare like with like. `test_build_o` now compares `BUILD_O` (not `DEFAULT`) with `BUILD_M`.
- **`Rules.pale_skin`**, on in `DEFAULT`, off in `PROTOTYPE` and every `BUILD_*`. `faces.finish_faces`
  runs `faces.pale_skin` right after `lone_white_skin` when a person's face was found (`face ==
  "human"`):
  - candidate: an SS4 or SS6 stone outside 1.5 eye-zone radii whose read colour is pale warm cream
    (`faces.is_pale_cream`: L\* above 85, chroma 8 to 40, hue 25 to 100 degrees, ends included) and
    whose colour is not in `distinct.SKIN`. The read colour is the one `skin_nearest` reads: the mean
    Lab of the inner 60 % of the stone's radius at its delivered position (with `sample_delivered`
    and `skin_nearest_inner` on, this is the `ordered.delivered_lab` reading). `layout_frame()` reads
    it when `skin_nearest` or `pale_skin` is on;
  - condition: at least four neighbours (the `faces._neighbours` reach), at least half of them in
    skin colours;
  - result: the skin colour (`distinct.SKIN` without Topaz, the ramp `skin_nearest` uses) nearest the
    read colour in ΔE2000;
  - rounds: each round reads the colours the round before left; until no stone changes, at most 5
    (`faces.PALE_ROUNDS`).
  Positions and sizes never change, and `bw.py` ignores the colours, so Black & white is unchanged.
- The report keys are unchanged; the app and the Node server are not touched.
- `strass_layout.__version__` stays 1.2.0.

## Assumptions

- "Only where `lone_white_skin` may act (a person's face found)": `lone_white_skin` itself has no face
  check and still runs on every design. `pale_skin` runs only with `face == "human"`.
- The candidate needs four neighbours when the rule starts. A stone that is already skin is never a
  candidate, and a changed stone is not looked at again.

## Tests

`services/strass-layout/tests/test_rs_3044_pale_skin.py`:

- `BUILD_O` is `DEFAULT` with `pale_skin` off, and only `DEFAULT` has the flag.
- The colour range, with an example just outside each bound.
- Fixtures on a hexagonal grid:
  - a pair and a triple of Crystal stones on skin (which `lone_white_skin` leaves) become Silk;
  - Metallic Sunshine, Citrine, Silver, Light Topaz and SS4 change too;
  - a 7-stone cluster changes ring first, centre second;
  - the rule stops after 5 rounds;
  - stones that must stay do: a read that is not pale, a neutral white, SS10, near an eye, under half
    skin, three neighbours, a skin stone, no person's face, `BUILD_O`;
  - teeth stay, in two cases. Crystal teeth (chroma 0) stay inside a Vintage Rose lip. Cream teeth
    stay inside a ring of lips in a lip colour.
- `pale_skin_portrait.png` (the diagnosis's AI image, new fixture):
  - the 11 skin Crystal stones become skin colours;
  - the changes are exactly Crystal → Silk 11, Metallic Sunshine → Silk 8, Citrine → Silk 3;
  - the eye white and the catch-light stay Crystal;
  - `BUILD_O` is develop's layout (2826 stones, 18 Crystal).
- On the 13 test images, `DEFAULT` against `BUILD_O`:
  - positions, sizes and order are equal;
  - the report is equal except `colours`;
  - a changed stone goes from a non-skin colour to a skin colour;
  - nothing changes without a person's face.

## Known limit

Teeth read as pale cream inside an upper lip in a skin colour (Vintage Rose, Rose Peach) can have half
their neighbours in skin; in such a constructed mouth the upper row of teeth turns Silk. None of the
21 layouts in `docs/results/RS-3044/` shows it. The AI's teeth on portrait-freckles stay Crystal.

## Measured

See `docs/results/RS-3044/README.md`.

Full service suite (`python -m unittest`, 180 tests, this iMac): 5 h 13 min. One failure, in this
milestone's own test: it pinned 50 Crystal stones for `BUILD_O` on the portrait, but develop's layout has
18. The pin was corrected to 18 and the `Portrait` tests re-run (3 tests, OK); every other test passed.
