import numpy as np, cv2
from scipy import ndimage as ndi
from collections import defaultdict


def orientation_field(lab_img, mask, pitch_px, smooth_px=None, integ_px=None):
    smooth_px = smooth_px or 0.6 * pitch_px
    integ_px = integ_px or 1.5 * pitch_px
    Jxx = Jyy = Jxy = 0
    for c in range(3):
        ch = ndi.gaussian_filter(lab_img[..., c], smooth_px)
        gx = ndi.sobel(ch, 1); gy = ndi.sobel(ch, 0)
        Jxx = Jxx + gx * gx; Jyy = Jyy + gy * gy; Jxy = Jxy + gx * gy
    m = mask.astype(np.float32)
    Jxx = ndi.gaussian_filter(Jxx * m, integ_px); Jyy = ndi.gaussian_filter(Jyy * m, integ_px); Jxy = ndi.gaussian_filter(Jxy * m, integ_px)
    big = 4 * integ_px
    Bxx = ndi.gaussian_filter(Jxx, big); Byy = ndi.gaussian_filter(Jyy, big); Bxy = ndi.gaussian_filter(Jxy, big)
    tr = Jxx + Jyy
    coh = np.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy ** 2) / (tr + 1e-9)
    w = np.clip(coh / 0.3, 0, 1)
    Jxx = w * Jxx + (1 - w) * Bxx; Jyy = w * Jyy + (1 - w) * Byy; Jxy = w * Jxy + (1 - w) * Bxy
    ang_grad = 0.5 * np.arctan2(2 * Jxy, Jxx - Jyy)
    ang_tan = ang_grad + np.pi / 2
    return ang_tan, coh


class Field:
    def __init__(self, ang, s):
        self.c = np.cos(2 * ang); self.sn = np.sin(2 * ang); self.s = s
        self.h, self.w = ang.shape

    def dir(self, x, y, prev=None):
        px = min(max(x / self.s, 0), self.w - 1.001); py = min(max(y / self.s, 0), self.h - 1.001)
        x0, y0 = int(px), int(py); fx, fy = px - x0, py - y0
        c = (self.c[y0, x0] * (1 - fx) * (1 - fy) + self.c[y0, x0 + 1] * fx * (1 - fy) + self.c[y0 + 1, x0] * (1 - fx) * fy + self.c[y0 + 1, x0 + 1] * fx * fy)
        sn = (self.sn[y0, x0] * (1 - fx) * (1 - fy) + self.sn[y0, x0 + 1] * fx * (1 - fy) + self.sn[y0 + 1, x0] * (1 - fx) * fy + self.sn[y0 + 1, x0 + 1] * fx * fy)
        a = 0.5 * np.arctan2(sn, c)
        d = np.array([np.cos(a), np.sin(a)])
        if prev is not None and d @ prev < 0:
            d = -d
        return d


def streamlines(field, inside, W, H, dsep, step=0.25, dtest_f=0.75, minlen=3.0):
    cell = dsep
    grid = defaultdict(list)
    lines = []

    def near(p, dist):
        gx, gy = int(p[0] / cell), int(p[1] / cell)
        for i in range(gx - 1, gx + 2):
            for j in range(gy - 1, gy + 2):
                for q in grid.get((i, j), ()):
                    if (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < dist * dist:
                        return True
        return False

    def trace(seed, dtest):
        pts = [np.array(seed)]
        for sgn in (1, -1):
            p = np.array(seed, float); prev = None
            out = []
            for _ in range(4000):
                d = field.dir(p[0], p[1], prev)
                if prev is None:
                    d = d * sgn
                mid = p + 0.5 * step * d
                d2 = field.dir(mid[0], mid[1], d)
                q = p + step * d2
                if not inside(q) or near(q, dtest):
                    break
                if len(out) > 8 and np.linalg.norm(q - (out[-8] if out else p)) < step * 2:
                    break
                out.append(q); p = q; prev = d2
            if sgn == 1:
                pts = pts + out
            else:
                pts = out[::-1] + pts
        return np.array(pts)

    def add(line):
        for p in line:
            grid[(int(p[0] / cell), int(p[1] / cell))].append(p)

    queue = []
    ys = np.arange(dsep / 2, H, dsep * 3)
    xs = np.arange(dsep / 2, W, dsep * 3)
    init = [(x, y) for y in ys for x in xs]
    np.random.default_rng(0).shuffle(init)
    def try_seed(sd):
        sd = np.array(sd)
        if not inside(sd) or near(sd, dsep):
            return None
        ln = trace(sd, dtest_f * dsep)
        if len(ln) * step < minlen:
            return None
        add(ln); lines.append(ln)
        return ln
    pending = list(init)
    while pending:
        sd = pending.pop()
        ln = try_seed(sd)
        if ln is None:
            continue
        for k in range(0, len(ln), max(1, int(1.0 / step))):
            p = ln[k]
            j = min(k + 1, len(ln) - 1); i = max(k - 1, 0)
            t = ln[j] - ln[i]; t = t / (np.linalg.norm(t) + 1e-9)
            n = np.array([-t[1], t[0]])
            pending.append(tuple(p + n * dsep)); pending.append(tuple(p - n * dsep))
    return lines


def stones_on_lines(lines, pitch):
    P, L = [], []
    for li, ln in enumerate(lines):
        seg = np.linalg.norm(np.diff(ln, axis=0), axis=1)
        s = np.r_[0, np.cumsum(seg)]
        if s[-1] < pitch * 0.5:
            continue
        n = int(np.floor(s[-1] / pitch)) + 1
        off = (s[-1] - (n - 1) * pitch) / 2
        for k in range(n):
            t = off + k * pitch
            x = np.interp(t, s, ln[:, 0]); y = np.interp(t, s, ln[:, 1])
            P.append((x, y)); L.append(li)
    return np.array(P), np.array(L)
