/**
 * RS-3011 Step 11 — Trace tool spacing (pure geometry, no UI/interaction).
 *
 * The precedent is drawleather's own LineStampTool.ts + lineStamping.ts: drag to draw a path,
 * release to commit; placeStampsAlongPath() spaces items along it, with closed paths getting their
 * step size adjusted (count = round(total/step), actualStep = total/count) so the spacing divides
 * evenly and the seam closes cleanly, while open paths use a fixed step from a starting inset.
 *
 * Two deliberate departures from that reference:
 *  - No rotation/tangent output. lineStamping.ts's own rotateAlong branch exists because
 *    drawleather stamps images with a footprint orientation; a round stone has none, so this only
 *    ever returns bare {xMm,yMm} points -- no getTangentAt() call.
 *  - An open path starts its fixed step at t=0, not lineStamping.ts's own stampLen/2 inset. That
 *    inset exists there to keep a rectangular stamp's own footprint from overhanging the path's
 *    start; a round stone has no footprint-orientation concern, so there's nothing for an inset to
 *    protect against.
 */

/**
 * @param {paper.Path} paperPath a Paper.js path in absolute project-mm space (Paper.js project
 *   units already equal this app's millimeters, per DrawingCanvasTool.js's own header comment).
 *   Only `.length`/`.getPointAt()` are read -- never mutated.
 * @param {{stepMm:number, closed:boolean}} options
 * @returns {{xMm:number,yMm:number}[]}
 */
export function placeStonesAlongPath(paperPath, { stepMm, closed }) {
  const total = paperPath.length;
  if (!(total > 0) || !(stepMm > 0)) return [];
  const points = [];
  if (closed) {
    // count/actualStep mirror lineStamping.ts's own closed-path seam logic: adjusting the step so
    // it divides the path evenly, rather than leaving a leftover fractional gap at the wrap-around
    // point.
    const count = Math.max(1, Math.round(total / stepMm));
    const actualStep = total / count;
    for (let i = 0; i < count; i++) {
      const point = paperPath.getPointAt(i * actualStep);
      if (point) points.push({ xMm: point.x, yMm: point.y });
    }
  } else {
    for (let t = 0; t <= total; t += stepMm) {
      const point = paperPath.getPointAt(t);
      if (point) points.push({ xMm: point.x, yMm: point.y });
    }
  }
  return points;
}
