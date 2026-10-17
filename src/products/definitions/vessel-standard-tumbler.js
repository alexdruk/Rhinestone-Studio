/**
 * Standard Tumbler product definition data.
 *
 * MAINT-007: converted from a JSON module import to a plain .js module. Chrome 103
 * (this project's minimum supported browser, see docs/specifications/MAINT-007-BrowserBaseline.md)
 * predates the JS import-attributes syntax used for JSON modules, so the data below -- unchanged
 * in meaning from the original vessel-standard-tumbler.json -- is exported as a plain ES module default export
 * instead.
 */
export default {
  "schemaVersion": 1,
  "id": "vessel-standard-tumbler",
  "name": "Standard Tumbler",
  "family": "vessel",
  "type": "tumbler",
  "status": "proposed",
  "dimensions": {
    "bodyDiameterMm": {
      "description": "Cylindrical body wall diameter, measured at the main straight section.",
      "min": 70,
      "average": 76,
      "max": 82
    },
    "topDiameterMm": {
      "description": "Diameter at the rim. A straight tumbler's wall does not taper, so this always equals bodyDiameterMm.",
      "min": 70,
      "average": 76,
      "max": 82
    },
    "bodyHeightMm": {
      "description": "Full physical height of the cylindrical body wall, base to rim.",
      "min": 165,
      "average": 175,
      "max": 185
    }
  },
  "printableMarginMm": 30,
  "defaults": {
    "bodyDiameterMm": 76,
    "topDiameterMm": 76,
    "bodyHeightMm": 175
  },
  "validation": {
    "requirePositiveDimensions": true,
    "requireTopDiameterEqualsBody": true
  },
  "research": {
    "scope": "Conventional 20oz stainless double-wall skinny/straight tumbler blanks; excludes tapered tumblers.",
    "notes": [
      "The ranges are a practical modeling envelope, not an industry standard.",
      "printableMarginMm is larger than the mug's: the tapered base and rolled rim lip are both excluded from a typical 20oz skinny tumbler's sublimation wrap."
    ]
  }
};
