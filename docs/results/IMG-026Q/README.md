# IMG-026Q: tinted view

2 Nov 2026, branch `feature/img-026q-tinted-view`. No provider calls, no service change.

The 2D canvas's Background setting has a third choice, **Tinted**. It shows image layers as the
finished piece, as PatternNifty (IS, commit `e9e7014`, spec section 8) shows its designs:

- the gaps between stones take a darker shade of their stone's colour, up to 0.6 mm from the edge;
- small specks enclosed between stones are filled the same way;
- each stone is held to its catalogue lightness;
- large Jet pupils get a thin rim.

Black & white layers use IS's "crystal" gap rule: where a Jet stone sits next to a Crystal stone,
the gap is Crystal's light grey, so dark gaps show only between Jet stones.

The stones themselves never change. Exports, Design view, saved projects and history do not change.

Each picture below shows three panels side by side: the AI image, today's canvas (Background:
White), and the tinted view. The four layouts are:
- `portrait`: the test-set portrait, laid out today with the service's `DEFAULT` rules;
- `curls-colour`: portrait-curls in Colour, from IMG-026N;
- `freckles-bold`: portrait-freckles in Bold, from IMG-026P;
- `curls-shaded`: portrait-curls in Shaded, from IMG-026P.

Each has a whole-design picture and a `-face` close-up. All were rendered in Chrome at
device-pixel ratio 3 on the Flat Sheet.

## Looks wrong or worse

1. **Light highlight areas turn into solid white patches** (`portrait.jpg`, `portrait-face.jpg`).
   - The service gives the portrait's forehead, cheeks, nose and neck large groups of Crystal and
     Silver stones.
   - In the AI image these highlights are mixed in among skin stones. In the tinted view they
     merge into flat white shapes that stand out much more than in the AI image or on White.
   - The view shows the layout faithfully, so the cause is the layout's colour step, not the view.
     The tinted view makes the problem much easier to see.
2. **Jagged edges where colours meet** (every close-up).
   - Each gap pixel takes its nearest stone's colour, so a colour boundary follows the stones'
     outlines as small straight-edged steps.
   - This shows most where dark areas meet light ones: Jet hair against skin, and the lips
     against skin on curls-colour.
   - IS has the same steps; it is how the rule works.
3. **Jet stones keep a thin light ring.** RS's crystal renderer strokes every Jet stone's edge in
   light grey.
   - The tinted view only narrows that ring on stones above SS6, as IS does.
   - Large Jet areas (Bold and Shaded hair and clothes) therefore read as black with a fine grey
     circle pattern, not as solid black.
4. **The service's large pupils show more.** Each SS20 pupil now sits in a solid dark area instead
   of on white, and reads larger than the AI's pupil (curls-colour and curls-shaded faces). This is
   the IMG-026O/P pupil issue; the view does not cause it.
5. **Crystal areas read light grey, not white** (Bold and Shaded). Crystal's gap is 8 L\* darker by
   the rule (`#dedede`), so the face reads as pale grey against the white canvas.

## Does it read as a solid picture close to the AI image?

**Mostly yes, as in IS.**

- Today's canvas shows separate stones on a white, gridded background. The background's white and
  grid lines show between every stone, so faces look washed out and hair looks thin. Dark curls
  read as grey on the portrait and as speckled on curls-colour.
- The tinted view fills those gaps. Hair, clothes and skin become continuous areas, so it reads as
  a painted picture:
  - curls-colour's dark brown hair, burgundy top and brown skin come out close to the AI image;
  - freckles-bold looks like the AI stencil, with solid black hair and straps and clean outlines;
  - curls-shaded keeps its Shaded mix in the hair and reads as a Bold-like portrait on the face.
- Where the tinted view differs from the AI image, the layout differs. The portrait's white
  highlight patches, the big pupils and the eye lines the service dropped all show more clearly in
  the tinted view than on White.

## Done criteria

- **New tests:** `tools/test-img-026-tinted-view.mjs`, 12 tests, all pass. They cover:
  - a pixel 0.5 mm beyond the edge gets the gap colour, 0.7 mm is background;
  - the gap rule for a mid colour (Sapphire, 4.0–6 L\*), Silver and Crystal (8–10 L\*), and every
    catalogue colour, with the hue kept;
  - the crystal rule (Jet among Crystal gets Crystal's gap);
  - an enclosed speck is filled, while a true hole and the outside are not;
  - stone lightness after the hold: whole stone within 3 L\*, inner 60 % within 5;
  - the SS6 rim;
  - the cache;
  - the stones are unchanged before and after a render;
  - exports never show the view.

  Mutation checks: turning off the hold, the crystal rule or the speck fill makes tests 5, 3 and 4
  fail, respectively.
- **Browser check** (Chrome, every product: mug, tumbler, bottle, plate, Flat Sheet):
  - The option shows as "Background: Tinted" on every product.
  - Each product was checked with a Colour image layer plus a text layer (curls-colour, 3473
    stones), a Black & white image layer (freckles-bold, 2998) and a text layer alone.
  - Every case left the StoneLayout, the project JSON and the undo state unchanged, and logged no
    errors.
  - Export PNG and Export SVG give byte-identical files with Tinted and White.
  - With text only, the canvas is pixel-identical to White, and nothing is rendered.
- **Real drawn stones:** `renderTintedBitmap()` with Chrome's canvas, run on every catalogue colour
  at 6 and 16 px/mm. The worst stone is 2.06 L\* from its fill over the whole stone (limit 3) and
  4.26 L\* over its inner 60 % (limit 5).
- **RS fast tests:** 25/25 pass.

## Timing

The test machine was an iMac with an Intel i5-7600 and macOS 13.7.8. The browser was Chrome 156,
headless; Chrome 103 was not available here.

The layout is curls-shaded, 4156 stones, the largest from IMG-026N to IMG-026P, on the 2D Canvas
tab. The 2D canvas has no zoom control: it always fits the design. So "normal zoom" is a
1500 × 950 window and "largest zoom" is a full-screen window on a 5K screen, 2560 × 1440. Both are
at device-pixel ratio 2.

| | Normal (canvas 1892 × 1452 px) | Largest (canvas 4012 × 2532 px) |
| --- | --- | --- |
| First tinted render, until it shows | 729 ms | 1772 ms (1738–2398 over 6 runs) |
| … of which work | 523 ms | 1368 ms |
| Longest task meanwhile | 66 ms | 95 ms (one earlier run: 514 ms, probably garbage collection) |
| Cached redraw | 2.4 ms | 2.8 ms |
| Back to Tinted from White, nothing changed | 2.1 ms | 2.0 ms |
| For comparison, a redraw on White | 56 ms | 50 ms |

The Colour layout (curls-colour, 3450 stones) took 784 ms and 1743 ms, with a cached redraw of
2.5 and 2.3 ms.

**How it stays usable.** The render runs in slices of about 12 ms between frames. Until it is
ready, the stones show as on White; then the canvas redraws once. A redraw from the cache is
faster than White, because the image stones come from one bitmap. The cache keeps the bitmap
until the tinted stones, the gap rule or the canvas transform change.

So dragging or resizing an image layer shows the plain stones while you drag. The tinted view
returns about 0.7 s after you let go.

## Other layer types

- Text, shapes, paths and monograms are drawn exactly as on White, on top of the tinted image
  layers. Their gaps show the white, gridded canvas.
- A project without image layers looks pixel-identical on White and Tinted.
- Next to a tinted image, a text layer looks like stones on paper beside a painted picture.
- Where a text layer overlaps an image layer, the text is drawn on top. Today it is drawn in layer
  order.

## Files

- `<name>.jpg`: AI image | today's canvas (White) | tinted view, the whole design.
- `<name>-face.jpg`: the same three panels, as a close-up centred below the pupils.
