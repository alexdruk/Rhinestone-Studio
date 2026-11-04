# IMG-026N: prompt v7 and the model input, real check

1 Nov 2026, branch `feature/img-026n-prompt-v7-model-input`. **3 provider calls** (OpenAI, one per
photo, no retries), out of the 6 allowed.

IMG-026N gives every product prompt version 7: PatternNifty's (IS, commit `e9e7014`) two skin lines,
which ask the AI to keep each person's skin tone and lightness. On the Flat Sheet it also asks for the
photo's own shape (`size: auto`, the whole-image line, no "60 stones across"), and it sends the AI only
the subject (cut-out box + 3 %, 1024 px on the long side). This page checks that on three portraits,
each made as a Flat Sheet layer and laid out by the service with today's `DEFAULT`.

## Looks worse, or does not match what the brief expected

1. **On the deep-skinned face the AI still lightens the skin, by less than before.** portrait-curls'
   cheeks are L\* 52.6 in the photo and 65.3 in the RS v7 AI image (+12.7). PatternNifty's listing
   design of the same photo (IS prompt v3, same skin wording as RS v6) was +23.5, and IS's two
   prompt-v4 test runs were +17.4 and +19.4. So the skin lines help, but the face is still clearly
   lighter than the photo. Over the whole face (eyes, brows and lips included) it is +8.9.
2. **The stones come out lighter than the AI image on the two darker faces.** The layout service's
   colour step puts Silk (the lightest skin stone, L\* 76.9) on lit cheeks. Face stones against the
   AI's face skin: curls 67.0 against 65.3 (mean 62.6 against 53.0), flower crown 65.6 against 61.6.
   On the light face it does not (freckles 73.5 against 75.1). IS reported the opposite for its own
   listing designs ("the colour step does not lighten skin", IS `docs/skin-check.md`), but there the
   AI had already painted the cheeks lighter than Silk. Once the AI keeps the skin darker, the step
   shows. IMG-026O's clean-up does not touch colours; this would need its own look.
3. **No RS v6 result exists for these photos,** so the plan's "face ΔL\* no worse than v6" could only
   be checked against a stand-in: IS's listing designs made with IS prompt v3, whose skin wording is
   RS v6's. Against those, v7 is better on both photos they cover (freckles +5.3 → +2.3, curls
   +23.5 → +12.7). Each figure is one run. IS saw up to 6 L\* between two runs of the same prompt, so
   small differences mean little.
4. **PatternNifty's AI images and stone files are not in its repository** (they live in IS's
   git-ignored `data/listing/runs/`). Its figures below are IS's published ones (`docs/skin-check.md`,
   `docs/skin-prompt.md`). Where IS gives only the face stones' three most common colours, the stone
   L\* is computed from those three ("≈"). PatternNifty's layout picture is its own tinted render
   (shaded stones, dark gaps). The RS layout picture is flat catalogue colours on white, so the two
   look different in lightness by eye even where the colours are the same. Compare the numbers, not
   the brightness of the pictures.

## Photos

Picked from PatternNifty's Etsy listing designs (`docs/listing/` and `tools/make-listing-designs.mjs`
at IS `e9e7014`) to cover light to deep skin with real photos:
- **portrait-freckles:** light skin.
- **portrait-flower-crown:** deep-medium skin. It is the only listing design IS made with its
  prompt v4, which has the same skin lines as RS v7, so it is the like-for-like reference.
- **portrait-curls:** deep skin, the design IS's skin investigation started from.

La Belle Ferronnière was left out: in that painting the yellowed varnish, not the skin, decides the
measure, and IS found that no prompt wording changed it.

The photo is the listing design's `prepared.png` from the IS repository: IS's background-removed
cut-out, 1200 px on the long side, stored as a 256-colour PNG. RS has no background removal, so this
is also what an RS user would upload as a transparent PNG. It exercises the new crop. No file from
`data/private-portraits` was used.

| Photo | Source | Author | Licence |
| --- | --- | --- | --- |
| portrait-freckles | [Wikimedia Commons, Smile with Freckles (Unsplash)](https://commons.wikimedia.org/wiki/File:Smile_with_Freckles_(Unsplash).jpg), via [Unsplash](https://unsplash.com/photos/u3WmDyKGsrY) (2017-03-13) | Gabriel Silvério | CC0 |
| portrait-flower-crown | [Wikimedia Commons, Mother Nature, Summer (Unsplash)](https://commons.wikimedia.org/wiki/File:Mother_Nature,_Summer_(Unsplash).jpg), via [Unsplash](https://unsplash.com/photos/vTL_qy03D1I) (2017-04-19) | Autumn Goodman | CC0 |
| portrait-curls | [Wikimedia Commons, Confident Eye Contact (Unsplash)](https://commons.wikimedia.org/wiki/File:Confident_Eye_Contact_(Unsplash).jpg), via [Unsplash](https://unsplash.com/photos/HKquADJl8CU) (2016-10-27) | Tanja Heffner | CC0 |

## Results

Face skin L\*: the median (IS's measure), with the mean in brackets. ΔL\* is against the photo.

| Photo | Photo | RS v7 AI image | RS v7 face stones | PatternNifty AI image | PatternNifty face stones |
| --- | ---: | ---: | ---: | ---: | ---: |
| portrait-freckles | 72.8 (72.6) | 75.1 (74.2), **+2.3** | 73.5 (71.5), 48 stones | +5.3 (prompt v3) | ≈76.9 (≈74.4) |
| portrait-flower-crown | 61.4 (61.2) | 61.6 (54.6), **+0.2** | 65.6 (65.3), 41 stones | −0.2 (prompt v4) | ≈67.0 (≈65.2) |
| portrait-curls | 52.6 (49.7) | 65.3 (53.0), **+12.7** | 67.0 (62.6), 27 stones | 75.5, +23.5 (prompt v3) | 76.9 (76.0), 34 stones |

| Photo | RS v7 natural size | RS v7 stones | AI image | PatternNifty natural size | PatternNifty stones |
| --- | --- | ---: | --- | --- | ---: |
| portrait-freckles | 135.0 × 193.9 mm | 3139 | 1054 × 1492 px | 137.1 × 200.8 mm | 3176 |
| portrait-flower-crown | 161.2 × 165.4 mm | 3237 | 1254 × 1254 px | 157.3 × 160.5 mm | 3033 |
| portrait-curls | 145.6 × 148.8 mm | 3450 | 1247 × 1261 px | 174.6 × 174.7 mm | 4764 |

Whole face (the face mesh's hull) in the photo → RS v7 AI image: freckles 67.9 → 70.8, flower crown
52.7 → 50.2, curls 37.7 → 46.6.

The model input followed each photo's shape (freckles 723 × 1024, flower crown 1024 × 1023, curls
1012 × 1024), and so did OpenAI's output. The output is about 1.5 MP, as IS-03b found. Natural sizes
are close to PatternNifty's, except curls, which is about 17 % smaller with 28 % fewer stones. Why
was not looked into: one run each, and the AI's stone pitch varies from run to run.

## In plain words

- **Light skin (freckles):** kept. The AI face is 2.3 L\* lighter than the photo and the stones are
  within 1 L\*. The red hair, freckles and lipstick read well. PatternNifty's v3 design was 5.3
  lighter.
- **Deep-medium skin (flower crown):** kept in the AI image (within 0.2 L\*, as in PatternNifty's v4
  design, −0.2). The stones are about 4 L\* lighter than the AI image, mostly Silk on the lit cheeks,
  so the stone face is a little lighter than the photo, about as much as PatternNifty's design.
- **Deep skin (curls):** better than before, not right. The AI face is brown, not the light peach of
  PatternNifty's listing design, but the lit cheeks are still 12.7 L\* lighter than the photo. The
  stones add another 1.7 at the median.
- **Against PatternNifty:** RS v7 does at least as well as PatternNifty's listing designs on all three
  faces. The flower crown, made with the same skin wording on both sides, gives the same result.

## Files

- `<photo>.jpg`: photo, RS v7 AI image, RS v7 stone layout, PatternNifty's stone layout, side by side,
  with natural size, stone count and face L\* under each.
- `<photo>-rs-v7-ai.jpg`: the RS v7 AI image (on white).
- `<photo>-rs-v7-layout.json` and `.png`: the service's answer (`aiLayout` stones and report), and the
  stones drawn in their catalogue colours at 8 px/mm.
- `skin-check.json`: IS's skin-check output per photo (areas, medians, stone colours).

## How it was made and measured

- **Redraw:** RS's own client (`redrawImage({ shape: 'auto' })`, so the cut-out crop and 1024 px fit
  of `src/redraw/ModelInput.js`) and server handler (prompt v7 whole-image text, `size: auto`), run
  from a Node script with the real OpenAI key from `.env` (`gpt-image-2.5-sunburst`, quality high).
  The layout came from the local layout service with today's `DEFAULT` (code at `e5d5762`). Each
  layer records `promptVersion: 7`.
- **Measure:** IS's `services/strass/scripts/skin_check.py` at `e9e7014`, unchanged, run on the RS
  results laid out as IS attempt folders. It finds the face with MediaPipe in the photo and in the AI
  image and takes discs on both cheeks and the chin (Face Mesh 50, 280, 205, 425, 199; none of the
  three has a beard). The face stones are the stones whose centre lies in that area. Colours are CIE
  Lab (D65). Only the mean L\* was added next to IS's median.
  - On curls this gives the photo L\* 52.6, where IS measured 52.0 on the full-size file. The 1200 px
    256-colour copy costs about 0.6.
  - On the flower crown the AI drew the face 1.5 patch radii away from where the crop puts it. The
    measurement follows the AI's own landmarks, as IS's does.
