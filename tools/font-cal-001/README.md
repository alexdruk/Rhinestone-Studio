# FONT-CAL-001 -- Sacramento Calibration Pilot tooling

Supporting tooling for `docs/specifications/FONT-CAL-001-SacramentoCalibrationPilot.md`. Not a
general calibration engine -- every script here is hardcoded to this one experiment (Sacramento,
glyphs m/n/v, phrase "movement").

## Setup

```
python3 -m venv tmp/font-cal-001-venv
tmp/font-cal-001-venv/bin/pip install -r tools/font-cal-001/python/requirements.txt
```

## Pipeline (run in order from the repo root)

1. `node tools/font-cal-001/baseline.mjs` -- measures unmodified Sacramento (full glyph/word
   corpus) at SS6/SS10/SS30 through the real, unmodified production pipeline. Writes
   `output/baseline.json`.
2. `node tools/font-cal-001/diagnose.mjs` -- ranks single-contour glyphs by SS30 cluster
   fragmentation vs the SS6/SS10 controls, selects the experiment's glyphs/phrase. Writes
   `output/diagnosis.json`.
3. `tmp/font-cal-001-venv/bin/python3 tools/font-cal-001/python/modify_glyph.py --glyph <g> --delta <fontUnits> --out output/mods/mod-<g>.json`
   -- finds the glyph's sharpest same-contour cusp and describes a single-vertex push outward.
4. `tmp/font-cal-001-venv/bin/python3 tools/font-cal-001/python/build_candidate_font.py --source fonts/sources/Sacramento/Sacramento.ttf --modification output/mods/mod-<g>.json --out output/fonts/candidate-<label>.ttf`
   -- assembles a temporary candidate TTF with only that glyph's outline replaced.
5. `node tools/font-cal-001/validate.mjs output/fonts/candidate-<label>.ttf <label>` -- runs the
   candidate (or the original Sacramento, for height-scaling comparisons via
   `--height-override ss30=<mm>`) through the same real pipeline against the selected
   glyphs/phrase. Writes `output/candidate-<label>.json`.
6. `node tools/font-cal-001/compare.mjs <label1> <label2> ...` -- prints Markdown comparison
   tables built directly from the JSON files above.

`output/fonts/*.ttf` are temporary experimental artifacts (gitignored) -- only the JSON
measurements, this pipeline, and the report are committed.
