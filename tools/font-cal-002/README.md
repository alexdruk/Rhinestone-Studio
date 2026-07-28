# FONT-CAL-002 -- Contiguous Span Calibration Experiment tooling

Supporting tooling for
`docs/specifications/FONT-CAL-002-ContiguousSpanCalibrationExperiment.md`. Not a general
calibration engine -- every script here is hardcoded to this one experiment (Sacramento, glyphs
m/n, span radius 3 around each glyph's sharpest same-contour cusp).

Reuses FONT-CAL-001's tooling wherever possible instead of re-deriving it:
`../font-cal-001/python/modify_glyph.py` (cusp-finding/push-direction helpers, imported directly),
`../font-cal-001/python/build_candidate_font.py` (generic TTF assembly, used unchanged),
`../font-cal-001/lib/measureProduction.mjs` (production measurement, imported directly), and
`../font-diag-001/pipeline-trace.mjs` (prune-event tracing, used unchanged against this
milestone's candidate fonts).

## Setup

Reuses FONT-CAL-001's venv -- no new Python dependencies.

```
tmp/font-cal-001-venv/bin/pip install -r tools/font-cal-001/python/requirements.txt   # if not already done
```

## Pipeline (run in order from the repo root)

1. `tmp/font-cal-001-venv/bin/python3 tools/font-cal-002/python/modify_glyph_span.py --glyph <g> --mode <widen|straighten|smooth> --span-radius 3 [--delta <fu>|--iterations <n>] --out output/mods/mod-<g>-<mode>.json`
   -- locates the same sharpest same-contour cusp FONT-CAL-001 used, then modifies a 7-point
   contiguous span centered on it (span endpoints always unchanged, so the edit blends
   continuously into the rest of the contour).
2. `tmp/font-cal-001-venv/bin/python3 tools/font-cal-001/python/build_candidate_font.py --source fonts/sources/Sacramento/Sacramento.ttf --modification output/mods/mod-<g>-<mode>.json --out output/fonts/candidate-<g>-<mode>.ttf`
   -- unmodified FONT-CAL-001 script, reused as-is (it only replays a `commands` list, agnostic to
   how that list was produced).
3. `node tools/font-cal-002/validate.mjs output/fonts/candidate-<g>-<mode>.ttf <g>-<mode>` --
   runs the candidate through the same real pipeline FONT-CAL-001 used, against the same selected
   glyphs (m, n, v) and phrase ("movement"). Writes `output/candidate-<g>-<mode>.json`.
4. `node tools/font-cal-002/compare.mjs <label1> <label2> ... [--cal001 <cal001Label1> ...]` --
   prints Markdown comparison tables, optionally pulling FONT-CAL-001 candidates
   (`baseline-selected`, `m-d300`, `height-ss30-150`, ...) into the same table for direct
   before/after/height-scaling comparison without copying those JSON files.
5. `node tools/font-diag-001/pipeline-trace.mjs output/fonts/candidate-<g>-<mode>.ttf <g> 108.5` --
   unmodified FONT-DIAG-001 script, reused as-is, to check whether a candidate changed the actual
   driving prune event (not just the final `clusterCount`).

`output/fonts/*.ttf` are temporary experimental artifacts (gitignored) -- only the JSON
measurements, this pipeline, and the report are committed.
