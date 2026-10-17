import json, base64, sys
import numpy as np
from PIL import Image
from io import BytesIO
from playwright.sync_api import sync_playwright

from pathcfg import W
import os
CAT = json.load(open(W + os.environ.get('CATALOGUE', 'catalogue.json')))
DRAW = open(W + 'drawStone.js').read().replace('export function', 'function')

PAGE = """<html><body style="margin:0"><canvas id=c></canvas><script>
const STONE_COLORS = %s;
%s
function go(spec){
  const c=document.getElementById('c'); c.width=spec.w; c.height=spec.h;
  const ctx=c.getContext('2d'); ctx.fillStyle=spec.bg; ctx.fillRect(0,0,spec.w,spec.h);
  if(spec.gap>0){ for(const s of spec.stones){ const c=STONE_COLORS[s[3]]; const h=c.fill; const v=[1,3,5].map(i=>Math.round(parseInt(h.substr(i,2),16)*0.85));
      ctx.fillStyle='rgb('+v.join(',')+')'; ctx.beginPath(); ctx.arc(s[0]*spec.ppm+spec.ox, s[1]*spec.ppm+spec.oy, (s[2]/2+spec.gap)*spec.ppm, 0, Math.PI*2); ctx.fill(); } }
  for(const s of spec.stones){ drawStone(ctx, s[0]*spec.ppm+spec.ox, s[1]*spec.ppm+spec.oy, s[2]/2*spec.ppm, s[3], 'layout'); }
  return c.toDataURL('image/png');
}
</script></body></html>"""


def render(stones, w_mm, h_mm, ppm=8.0, bg='#ffffff', margin_mm=0.0, gap=0.0):
    w = int(round((w_mm + 2 * margin_mm) * ppm)); h = int(round((h_mm + 2 * margin_mm) * ppm))
    spec = {'w': w, 'h': h, 'ppm': ppm, 'bg': bg, 'ox': margin_mm * ppm, 'oy': margin_mm * ppm,
            'gap': gap, 'stones': [[float(s[0]), float(s[1]), float(s[2]), s[3]] for s in stones]}
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.set_content(PAGE % (json.dumps(CAT), DRAW))
        url = pg.evaluate('spec => go(spec)', spec)
        b.close()
    return Image.open(BytesIO(base64.b64decode(url.split(',')[1]))).convert('RGB')


def looks(ppm=40):
    ids = list(CAT)
    stones = [[1.25 + 2.5 * i, 1.25, 2.0, k] for i, k in enumerate(ids)]
    im = np.asarray(render(stones, 2.5 * len(ids), 2.5, ppm=ppm)).astype(np.float32) / 255
    yy, xx = np.mgrid[0:im.shape[0], 0:im.shape[1]]
    out = {}
    for i, k in enumerate(ids):
        cx, cy = (1.25 + 2.5 * i) * ppm, 1.25 * ppm
        m = np.hypot(xx - cx, yy - cy) < 0.95 * ppm
        out[k] = im[m].mean(0).tolist()
    return out


if __name__ == '__main__':
    L = looks()
    json.dump(L, open(W + 'looks.json', 'w'), indent=1)
    for k, v in L.items():
        print(k, [round(x * 255) for x in v], CAT[k]['fill'])
