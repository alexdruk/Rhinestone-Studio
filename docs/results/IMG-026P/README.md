# IMG-026P — Black & white, real check (2 Nov 2026)

Two IMG-026N photos, each laid out as a Flat Sheet layer in Black & white **Bold** and **Shaded**:
4 provider calls (one per run, no retries), with the branch's own client, server and layout service
(`mode: "bw"`, threshold 55). Each picture shows the photo, the AI image and the stones. The stones
are drawn in their catalogue fills on a grey ground, so Crystal (`#f5f5f5`) shows; the grey between
stones is the gap. The `-face` pictures put the AI image and the stones side by side around the eyes,
nose and mouth.

## What looks wrong

1. **The pupils are much bigger than the AI drew them, and the thin eye and lip lines are lost.** In
   all four the service places one large Jet stone per pupil (its eye stage: SS20 in three, SS16 on
   the curls Bold; the size cap allows SS20 for a plausible pair). The AI drew small pupils with a Crystal catch-light, eyelid lines and
   lashes, as the Bold eye rule asks. Those thin lines are not stone-shaped, so the service does not
   keep most of them. The eyes still read, but as a black dot in a light area rather than a drawn eye.
   On the curls Bold the outer eye lines and part of the eye whites are gone, and the lips shrink to
   two short Jet rows. This is the service's eye stage and detection, the same as in Colour, not the
   Black & white mapping.
2. **Bold is not solid everywhere.** On the freckles Bold, the AI drew the hair bun as alternating Jet
   and Crystal rows, and the stones follow it. Everything else in both Bold designs is solid areas.
3. **The style changes the natural size.** The same photo came out 134.0 × 189.8 mm in Bold and
   148.8 × 214.4 mm in Shaded (curls: 133.0 × 137.6 and 160.5 × 165.0 mm). The AI drew Shaded at a
   finer stone pitch, so it has 26 to 37 % more stones. Expected (the size follows the AI's pitch),
   but the operator sees it.
4. The AI's freckles in Shaded are dots smaller than a stone; only some of them survive, as single
   Jet stones on the skin.

Nothing else looked wrong: 0 gap violations in all four, minimum gap ≥ 0.100 mm, only Jet and
Crystal.

## Results

| Run | Stones | Jet | Crystal | Jet share | Filled (Jet) | Size (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| [freckles Bold](portrait-freckles-bold.jpg) ([face](portrait-freckles-bold-face.jpg)) | 2998 | 1182 | 1816 | 39 % | 11 (7) | 134.0 × 189.8 |
| [freckles Shaded](portrait-freckles-shaded.jpg) ([face](portrait-freckles-shaded-face.jpg)) | 3791 | 1400 | 2391 | 37 % | 18 (6) | 148.8 × 214.4 |
| [curls Bold](portrait-curls-bold.jpg) ([face](portrait-curls-bold-face.jpg)) | 3036 | 2290 | 746 | 75 % | 5 (4) | 133.0 × 137.6 |
| [curls Shaded](portrait-curls-shaded.jpg) ([face](portrait-curls-shaded-face.jpg)) | 4156 | 2595 | 1561 | 62 % | 24 (14) | 160.5 × 165.0 |

"Filled" are the hole-fill stones, which take Jet or Crystal by the neighbour vote, not by reading.
[runs.json](runs.json) has every figure per run; [lightness.json](lightness.json) has the read
lightness of the other stones.

**The AI images are almost two-tone.** Of the stones read from the AI image, only 2 to 15 per design
(at most 0.4 %) have a mean L\* between 45 and 65. The median is 97.8 on the freckles and 1.6 / 9.2
on the curls. So the threshold (55) decides almost nothing: the stones are what the AI drew. A fresh
reading of each saved AI image gives the stored colour for every read stone.

## In plain words

- **portrait-freckles, Bold.** The face reads: eyebrows, both eyes, the nose line, the open smile with
  a row of teeth, and the jaw and neck outline. Light skin is solid Crystal and the outlines and
  straps are Jet, as the stencil prompt asks. The hair is drawn as outlined strands, and the bun is
  mixed (item 2).
- **portrait-freckles, Shaded.** Reads as well as Bold, and looks more like a drawing: the hair is
  Jet and Crystal mixed in strands, and freckles show as single Jet stones on cheeks and chest. The
  skin itself stays solid Crystal; the AI used mixing for hair and freckles rather than for skin
  shading.
- **portrait-curls, Bold.** Strong and graphic, as Bold should be: the hair is one solid Jet mass, and
  the face and shoulder are solid Crystal. The outline of the face, the nose and the chin read. The
  eyes are two big pupils, and the mouth is two short lines (item 1). A lock of hair over the
  forehead is a solid Jet patch above the left eye, as in the AI image.
- **portrait-curls, Shaded.** Mixed, as Shaded should be: the curls are Jet with Crystal strands
  running through them, so the hair has texture and light. The face is Crystal with Jet features. Of
  the four this is the most like PatternNifty's Shaded mastiff. The eyes read better than in Bold
  (each sits in a Crystal eye area with a Jet line above).

So Bold gives solid areas and Shaded gives mixed areas, in hair most of all. Faces (eyes, mouth and
outline) read in all four, with the eye detail limits of item 1.

## Compared with PatternNifty

[patternnifty-mastiff.jpg](patternnifty-mastiff.jpg) shows PatternNifty's two mastiff listing designs
(IS `e9e7014`, `docs/listing/designs/mastiff-bw-*`, tinted view): Bold 3701 stones, Jet 45 %; Shaded
4141 stones, Jet 41 %. As here, Shaded came out larger with more stones (IS: +12 %), Bold has solid
areas with Jet outlines, and Shaded mixes Jet into the light areas. IS's Bold mastiff also has single large
pupils. IS shows the tinted view (dark gaps between Jet stones); RS has no tinted view yet
(IMG-026Q), which is why these pictures draw the stones on grey. IS's exp-bw-stencil experiment has
no results document at `e9e7014`, only its two commit messages, so nothing more was compared.

## How it was made

- Scripts in `tools/scratch/img-026p/` (git-ignored): `real-run.mjs` (one redraw through
  `redrawImage()` and the server handler, with real OpenAI and the local service; it counts provider
  calls across runs and refuses a fifth), `sheet.py` (the pictures and `runs.json`).
- Photos: `tools/scratch/img-026n/photos/`, the same as IMG-026N. Model input: the Flat Sheet crop at
  1024 px (723 × 1024 and 1012 × 1024 px); output size `auto`.
- The service ran natively on the iMac from this branch (`scripts/start_layout.sh`), `DEFAULT` rules
  with the build O steps on. The layouts took 109 to 132 s each.
