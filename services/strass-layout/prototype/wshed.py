from pathcfg import W as _W
import sys
import numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi
from skimage.segmentation import watershed
from skimage.morphology import h_maxima, disk
from skimage.measure import regionprops


def views(name):
    im = np.array(Image.open(f'{_W}img/{name}.png').convert('RGBA')).astype(np.float32) / 255
    rgb, a = im[..., :3], im[..., 3]
    w = rgb * a[..., None] + (1 - a[..., None])
    lab = cv2.cvtColor(w, cv2.COLOR_RGB2LAB)
    return rgb, a, w, lab


def detect(name, sig=2.2, h=0.025, med=5, amin=0.35):
    rgb, a, w, lab = views(name)
    L = lab[..., 0] / 100
    Lm = cv2.medianBlur((L * 255).astype(np.uint8), med).astype(np.float32) / 255
    S = ndi.gaussian_filter(Lm, sig)
    bg = ndi.gaussian_filter(Lm, 8)
    D = S - bg
    mk = h_maxima(D, h)
    mk = ndi.label(mk)[0]
    mask = a > amin
    lab_ws = watershed(-D, mk, mask=mask, watershed_line=True)
    pts = []
    for rp in regionprops(lab_ws):
        if rp.area < 12:
            continue
        cy, cx = rp.centroid
        sub = rp.image
        dt = ndi.distance_transform_edt(np.pad(sub, 1))
        rin = dt.max()
        req = np.sqrt(rp.area / np.pi)
        pts.append((cy, cx, req, rin, rp.solidity, rp.eccentricity, rp.area))
    return np.array(pts), lab_ws


if __name__ == '__main__':
    name = sys.argv[1]
    p, lw = detect(name, *[float(v) for v in sys.argv[2:4]])
    np.save(f'{name}_ws.npy', p)
    np.save(f'{name}_wslab.npy', lw)
    print(name, len(p), 'req pct', np.percentile(p[:, 2], [10, 50, 90]).round(1), 'rin', np.percentile(p[:, 3], [10, 50, 90]).round(1))
