/**
 * Standard Mug product definition data.
 *
 * MAINT-007: converted from a JSON module import to a plain .js module. Chrome 103
 * (this project's minimum supported browser, see docs/specifications/MAINT-007-BrowserBaseline.md)
 * predates the JS import-attributes syntax used for JSON modules, so the data below -- unchanged
 * in meaning from the original vessel-standard-mug.json -- is exported as a plain ES module default export
 * instead.
 */
export default {
  "schemaVersion": 1,
  "id": "vessel-standard-mug",
  "name": "Standard Mug",
  "family": "vessel",
  "type": "mug",
  "status": "proposed",
  "dimensions": {
    "bodyDiameterMm": {
      "description": "Cylindrical body wall diameter, measured at the main straight section.",
      "min": 76,
      "average": 82,
      "max": 88
    },
    "topDiameterMm": {
      "description": "Diameter at the mouth/rim. Mugs typically flare slightly outward from the body.",
      "min": 78,
      "average": 85,
      "max": 92
    },
    "bodyHeightMm": {
      "description": "Full physical height of the cylindrical body wall, base to rim.",
      "min": 88,
      "average": 95,
      "max": 102
    }
  },
  "printableMarginMm": 10,
  "defaults": {
    "bodyDiameterMm": 82,
    "topDiameterMm": 85,
    "bodyHeightMm": 95
  },
  "validation": {
    "requirePositiveDimensions": true,
    "requireTopDiameterNotSmallerThanBody": false
  },
  "research": {
    "scope": "Conventional 11oz ceramic sublimation mug blanks; excludes 15oz, latte, and conical mugs.",
    "notes": [
      "The ranges are a practical modeling envelope, not an industry standard.",
      "printableMarginMm is the combined top+bottom band (rim curvature, handle-adjacent distortion) excluded from the printable/wrap height, not a customer-facing spec."
    ]
  }
};
