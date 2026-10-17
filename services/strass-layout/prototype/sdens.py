from pathcfg import W as _W
import sys, os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import numpy as np, cv2
from PIL import Image
from csbdeep.utils import normalize
from stardist.models import StarDist2D
from skimage.measure import regionprops

name = sys.argv[1]
scale = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
im = np.array(Image.open(f'{_W}img/{name}.png').convert('RGBA')).astype(np.float32) / 255
rgb, a = im[..., :3], im[..., 3:]
over = {}
for bgname, bgv in [('w', 1.0), ('k', 0.0)]:
    over[bgname] = rgb * a + bgv * (1 - a)
lab = cv2.cvtColor(over['w'], cv2.COLOR_RGB2LAB)
labk = cv2.cvtColor(over['k'], cv2.COLOR_RGB2LAB)
chroma = np.hypot(lab[..., 1], lab[..., 2])
views = {
    'Lw': lab[..., 0],
    'invLw': 100 - lab[..., 0],
    'Lk': labk[..., 0],
    'alpha': a[..., 0],
    'chroma': chroma,
    'R': over['k'][..., 0], 'G': over['k'][..., 1], 'B': over['k'][..., 2],
    'invR': 1 - over['w'][..., 0], 'invG': 1 - over['w'][..., 1], 'invB': 1 - over['w'][..., 2],
}
from pathcfg import MODELS
model = StarDist2D(None, name='2D_versatile_fluo', basedir=MODELS + 'stardist')
out = []
SEL = os.environ.get('SD_VIEWS')
for vn, v in views.items():
    if SEL and vn not in SEL.split(','):
        continue
    x = cv2.resize(v, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    x = normalize(x, 1, 99.8)
    labels, det = model.predict_instances(x, n_tiles=(4, 4))
    probs = det['prob']
    for i, rp in enumerate(regionprops(labels)):
        cy, cx = rp.centroid
        r = np.sqrt(rp.area / np.pi)
        p = probs[rp.label - 1] if rp.label - 1 < len(probs) else 0.5
        out.append((cy / scale, cx / scale, r / scale, p, rp.solidity, rp.eccentricity, list(views).index(vn)))
    print(vn, labels.max(), flush=True)
out = np.array(out)
np.save(os.environ.get('SD_OUT', f'{name}_sdens_{scale}.npy'), out)
print(len(out))
