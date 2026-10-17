import dlib, numpy as np, glob, cv2, sys
from PIL import Image
from pathcfg import MODELS
PRED = MODELS + 'shape_predictor_68_face_landmarks.dat'
_det = None; _sp = None
def landmarks(img_rgb):
    global _det, _sp
    if _det is None:
        _det = dlib.get_frontal_face_detector(); _sp = dlib.shape_predictor(PRED)
    for prep in (lambda x: cv2.medianBlur(x, 5), lambda x: cv2.GaussianBlur(x, (0, 0), 3), lambda x: cv2.GaussianBlur(x, (0, 0), 6)):
        w2 = prep(img_rgb)
        for up in (1, 2):
            faces = sorted(_det(w2, up), key=lambda f: -f.area())
            if faces and faces[0].width() > img_rgb.shape[1] * 0.12:
                sh = _sp(w2, faces[0])
                return np.array([[sh.part(i).x, sh.part(i).y] for i in range(68)])
    return None
def load_onwhite(path):
    im = np.array(Image.open(path).convert('RGBA')).astype(float) / 255
    return (np.clip(im[..., :3] * im[..., 3:] + (1 - im[..., 3:]), 0, 1) * 255).astype(np.uint8)
if __name__ == '__main__':
    p = landmarks(load_onwhite(sys.argv[1]))
    if p is None: print('no face'); sys.exit(0)
    np.save(sys.argv[2], p); print(p[36:42].mean(0), p[42:48].mean(0))
