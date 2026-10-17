export function drawStone(ctx, xPx, yPx, radiusPx, colorKey, style = 'layout') {
  const c = STONE_COLORS[colorKey] || STONE_COLORS.crystal;
  if (style === 'cup') {
    // A faint dark contrast ring keeps light stone colors readable on light cup backgrounds and
    // dark stone colors readable on dark cup backgrounds — the cup preview has no fixed
    // background color (cupColor is configurable), unlike the 2D layout's white canvas.
    ctx.beginPath();
    ctx.ellipse(xPx, yPx, radiusPx * 1.12, radiusPx * 1.12, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.16)';
    ctx.fill();
  }
  const g = ctx.createRadialGradient(xPx - radiusPx * .35, yPx - radiusPx * .45, radiusPx * .1, xPx, yPx, radiusPx);
  g.addColorStop(0, c.shine);
  g.addColorStop(.45, c.fill);
  g.addColorStop(1, c.accent);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(xPx, yPx, radiusPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = style === 'cup' ? Math.max(.35, radiusPx * .06) : Math.max(.55, radiusPx * .10);
  ctx.strokeStyle = c.stroke;
  ctx.stroke();
  if (radiusPx > 2.4) {
    ctx.beginPath();
    ctx.moveTo(xPx - radiusPx * .42, yPx);
    ctx.lineTo(xPx, yPx - radiusPx * .42);
    ctx.lineTo(xPx + radiusPx * .42, yPx);
    ctx.lineTo(xPx, yPx + radiusPx * .42);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,.42)';
    ctx.lineWidth = Math.max(.3, radiusPx * .05);
    ctx.stroke();
  }
}
