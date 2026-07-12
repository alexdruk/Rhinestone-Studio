/**
 * Named constants for layer placement (RS-1009). Kept separate from any single consumer so both
 * `src/editing/**` itself and its one caller (`app.js`) reference the same values instead of
 * duplicating magic numbers.
 */

// Maximum distance (mm) between a dragged edge/center and a candidate snap target for that
// target to be considered a match. One shared value for every kind of snap target (canvas,
// safe area, other layers) — deliberately not per-target, so snapping behavior is predictable.
export const SNAP_TOLERANCE_MM = 1.5;

// Arrow-key nudge step (mm).
export const NUDGE_STEP_MM = 0.5;

// Shift+Arrow-key nudge step (mm).
export const NUDGE_STEP_LARGE_MM = 5;
