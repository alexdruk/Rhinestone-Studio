import os
import numpy as np
import rs_fix as R

GAPX = R.GAP + 0.035


def ok(x, y, d, skip):
    return all(np.hypot(x - sx, y - sy) >= (d + sd) / 2 + GAPX - 1e-6 for sx, sy, sd in skip)


def greedy_disc(ox, oy, rad, d, skip, step=0.05):
    out = []
    g = np.arange(-rad, rad + 1e-9, step)
    gx, gy = np.meshgrid(g, g)
    m = np.hypot(gx, gy) <= rad - d / 2
    pts = np.stack([ox + gx[m], oy + gy[m]], 1)
    while len(pts):
        sk = np.array(skip)
        dist = np.min(np.hypot(pts[:, None, 0] - sk[None, :, 0], pts[:, None, 1] - sk[None, :, 1]) - (sk[None, :, 2] + d) / 2, 1)
        good = dist >= GAPX
        if not good.any():
            break
        pts, dist = pts[good], dist[good]
        k = np.argmin(dist)
        x, y = pts[k]
        out.append((x, y, d)); skip.append((x, y, d))
    return out


def ring(cx, cy, r, d, skip, phase=0.0):
    n = max(3, int(np.floor(2 * np.pi * r / (d + GAPX))))
    out = []
    for k in range(n):
        a = 2 * np.pi * (k + phase) / n
        x, y = cx + r * np.cos(a), cy + r * np.sin(a)
        if ok(x, y, d, skip):
            out.append((x, y, d)); skip.append((x, y, d))
    return out


def build_eye(c, s, n_rings=2, iris=True):
    Dp = c['diam_mm']; R0 = Dp / 2
    ox, oy = c['x'] * s, c['y'] * s
    hx0, hy0 = c['hx'] * s, c['hy'] * s
    ang = np.arctan2(hy0 - oy, hx0 - ox)
    hd = np.hypot(hx0 - ox, hy0 - oy)
    dc = R.SS4
    hr = min(max(hd, 0.45 * R0), R0 - dc / 2 + 0.1)
    hx, hy = ox + hr * np.cos(ang), oy + hr * np.sin(ang)
    stones = [(hx, hy, dc, 'crystal-clear', None)]
    skip = [(hx, hy, dc)]
    best = None
    for z in (6.4, 4.7, 4.0, 2.8, 2.0):
        for t in np.arange(0, R0, 0.05):
            x, y = ox - t * np.cos(ang), oy - t * np.sin(ang)
            if t + z / 2 <= R0 + 0.4 and ok(x, y, z, skip):
                best = (x, y, z); break
        if best:
            break
    if best:
        stones.append((best[0], best[1], best[2], 'jet', None)); skip.append(best)
    for x, y, d in greedy_disc(ox, oy, R0 + (0.45 if iris else 0.05), R.SS4, skip, step=0.03):
        stones.append((x, y, d, 'jet', None))
    if iris:
        r = R0 + 0.3 + GAPX + R.SS4 / 2
        for k in range(n_rings):
            for x, y, d in ring(ox, oy, r, R.SS4, skip, phase=0.5 * (k % 2)):
                a_ = np.arctan2(y - oy, x - ox); rs = R0 + 0.35 + 0.9 * k
                stones.append((x, y, d, None, (ox + rs * np.cos(a_), oy + rs * np.sin(a_))))
            r += R.SS4 + GAPX
    radius = max(np.hypot(x - ox, y - oy) + d / 2 for x, y, d, _, _ in stones)
    return stones, (ox, oy, radius)


def build_eye_copy(c, s, iris=False, n_rings=2):
    Dp = c['diam_mm']; R0 = Dp / 2
    ox, oy = c['x'] * s, c['y'] * s
    ang = np.arctan2(c['hy'] * s - oy, c['hx'] * s - ox)
    if os.environ.get('CL_INSIDE') == '1':
        dp = next((z for z in (6.4, 4.7, 4.0, 2.8, 2.0) if z + GAPX + R.SS4 <= Dp + 0.4), R.SS4)
        sh = (dp + GAPX + R.SS4) / 2 - dp / 2
        ox, oy = ox - sh * np.cos(ang), oy - sh * np.sin(ang)
    else:
        dp = next((z for z in (6.4, 4.7, 4.0, 2.8, 2.0) if z <= Dp + 0.3), R.SS4)
    stones = [(ox, oy, dp, 'jet', None)]
    rr = dp / 2 + GAPX + R.SS4 / 2
    hx, hy = ox + rr * np.cos(ang), oy + rr * np.sin(ang)
    stones.append((hx, hy, R.SS4, 'crystal-clear', None))
    ox, oy = c['x'] * s, c['y'] * s
    if iris:
        skip = [(x, y, d) for x, y, d, _, _ in stones]
        r = (max(np.hypot(x - ox, y - oy) + d / 2 for x, y, d, _, _ in stones) + GAPX + R.SS4 / 2 - (R.SS4 + GAPX) * 0.6) if os.environ.get('CL_INSIDE') == '1' else dp / 2 + GAPX + R.SS4 / 2
        for k in range(n_rings):
            for x, y, d in ring(ox, oy, r, R.SS4, skip, phase=0.5 * (k % 2)):
                a_ = np.arctan2(y - oy, x - ox); rs = max(R0, dp / 2) + 0.35 + 0.9 * k
                stones.append((x, y, d, None, (ox + rs * np.cos(a_), oy + rs * np.sin(a_))))
            r += R.SS4 + GAPX
    radius = max(np.hypot(x - ox, y - oy) + d / 2 for x, y, d, _, _ in stones)
    return stones, (ox, oy, radius)
