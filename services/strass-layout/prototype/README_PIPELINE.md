# Strass layout prototype (v5 colours + v6 eyes)

Prototype that converts an OpenAI rhinestone image into a production-legal Rhinestone Studio stone list.
Paths come from pathcfg.py: W = this folder (override with STRASS_W), models = W/models (override with STRASS_MODELS). Inputs are read from img/, outputs are written to this folder. StarDist and dlib models are in models/, so nothing is downloaded at run time.

Setup on a Mac: ./setup_mac.sh (creates .venv). Then: source .venv/bin/activate; ./run_one.sh cat
The result N2_cat_final_rs.json must equal expected/N2_cat_final_rs.json (verified stone-for-stone in a clean Linux run, 90 s on 2 cores).

## Run order for one image img/N2_<name>.png

run_one.sh <name> runs, in order: detect.py (radial symmetry -> _frst.npy), detect2.py (LoG -> _log.npy), sdens.py (StarDist on views alpha,Lw), runfuse.py (fusion -> _fused.npy), rs_fix.py (ordered layout, pitch 2.1), post.py (eyes v6, fill, colour clean-up), distinct.py (tones) -> N2_<name>_final_rs.json.

render.py (optional, needs playwright + chromium) draws a layout with the app's own drawStone.js.

## Stages
1. sdens.py: StarDist 2D_versatile_fluo on 2 views (alpha, Lw) -> candidate discs.
2. detect.py, detect2.py, runfuse.py / fuse.py: fuse StarDist, radial-symmetry (detect.py), LoG (detect2.py) and watershed (wshed.py) proposals; keep by circular gradient score -> [y, x, r, score].
3. rs_fix.py: scale = 2.1 mm / median NN spacing; ordered layout (OpenAI positions pushed apart to gap >= 0.1 mm); remove shadows, gap dots, strays outside the closed silhouette; fill holes only where OpenAI had a hole; CIEDE2000 colour snap with SKIN_NATURAL.
4. post.py: pupils (pupils2.find) + dlib face landmarks (landmarks.py). Face found -> human: eyes4.build_eye_copy (pupil = largest stone <= OpenAI disc + 0.3 mm, SS4 crystal catch-light outside it) + LASHES. No face -> animal: same + 2 generated SS4 iris rings coloured from the image. Then fill, colour new stones from neighbours, darkdots.clean, colsmooth.family_fix, overlap removal.
5. distinct.py: k-means(14) tone separation within hue families (skin only to skin).

## Output JSON
{report: {mm_per_px, width_mm, height_mm, stones, min_gap_mm, gap_violations, coverage, ...}, stones: [{x, y, size, d, color}]} in mm.
expected/ holds the reference results for the 12 test images in img/.
Sizes: ss4 1.5, ss6 2.0, ss10 2.8, ss16 4.0, ss20 4.7, ss30 6.4 mm. Colours: catalogue_v4.json = app's 23 + colorado-topaz, light-smoked-topaz, scarlet, hyacinth.
