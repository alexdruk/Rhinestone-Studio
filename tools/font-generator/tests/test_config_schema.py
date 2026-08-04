#!/usr/bin/env python3
"""FONT-GEN-001 focused test -- size-specific configuration coverage/schema."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from paths import CONFIG_DIR

REQUIRED_KEYS = [
    "sizeId", "familyName", "stoneDiameterMm", "gapMm", "supportedHeightRangeMm",
    "minFeatureWidthMm", "minCounterOpeningMm", "minLoopOpeningMm", "cornerRoundMm",
    "terminalSimplifyMm", "sideBearingAdjustMm", "minAreaMm2"
]
ALL_SIZES = ["SS6", "SS10", "SS16", "SS20", "SS30"]


def main():
    seen_diameters = set()
    seen_ranges = []
    for size_id in ALL_SIZES:
        path = CONFIG_DIR / f"{size_id}.json"
        assert path.exists(), f"Missing config file: {path}"
        config = json.loads(path.read_text())

        for key in REQUIRED_KEYS:
            assert key in config, f"{size_id}: missing required config key '{key}'"

        assert config["stoneDiameterMm"] not in seen_diameters, f"{size_id}: duplicate stone diameter"
        seen_diameters.add(config["stoneDiameterMm"])

        lo, hi = config["supportedHeightRangeMm"]
        assert lo < hi, f"{size_id}: supportedHeightRangeMm must be increasing"
        seen_ranges.append((lo, hi))

        assert 0.2 <= config["gapMm"] <= 0.5, f"{size_id}: gapMm {config['gapMm']} outside the 0.2-0.5mm brief requirement"

        print(f"PASS: {size_id} config schema OK (stone={config['stoneDiameterMm']}mm, range={lo}-{hi}mm)")

    # Not identical across sizes (brief: "Do not require identical parameter values for all sizes")
    thresholds_by_size = [json.loads((CONFIG_DIR / f"{s}.json").read_text())["minFeatureWidthMm"] for s in ALL_SIZES]
    assert len(set(thresholds_by_size)) == len(ALL_SIZES), "minFeatureWidthMm must differ per size"

    print("PASS: all 5 configs present, schema-valid, and size-differentiated")


if __name__ == "__main__":
    main()
