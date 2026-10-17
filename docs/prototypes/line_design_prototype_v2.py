import numpy as np, heapq, collections
from PIL import Image
from scipy import ndimage
from skimage.morphology import skeletonize, disk
from skimage import measure, color as skcolor

PALETTE = {'crystal-clear':'#f5f5f5','crystal':'#e9f7ff','jet':'#141414','siam':'#9b1c1c','light-siam':'#d9534f',
 'rose':'#ef8fb0','fuchsia':'#c2185b','amethyst':'#7e3f98','sapphire':'#2269d3','light-sapphire':'#6fa8dc',
 'aquamarine':'#3fc1b0','emerald':'#2aa66a','peridot':'#b5cc18','topaz':'#e08e26','citrine':'#f2c94c',
 'gold':'#f3bd32','silver':'#d8dde4'}
IDS=list(PALETTE); RGB=np.array([[int(h[i:i+2],16) for i in (1,3,5)] for h in PALETTE.values()],float)
LAB=skcolor.rgb2lab(RGB[None]/255)[0]
N8=[(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]

def trace_paths(skel):
    pts=set(zip(*np.where(skel)))
    deg={p:sum((p[0]+a,p[1]+b) in pts for a,b in N8) for p in pts}
    nodes={p for p,d in deg.items() if d!=2}
    used=set(); paths=[]
    def walk(a,b):
        path=[a,b]; prev,cur=a,b
        while cur not in nodes:
            nxt=[(cur[0]+x,cur[1]+y) for x,y in N8 if (cur[0]+x,cur[1]+y) in pts and (cur[0]+x,cur[1]+y)!=prev]
            nxt=[q for q in nxt if frozenset((cur,q)) not in used]
            if not nxt: break
            q=min(nxt,key=lambda q:abs(q[0]-cur[0])+abs(q[1]-cur[1]))
            used.add(frozenset((cur,q))); prev,cur=cur,q; path.append(cur)
        return path
    for n in nodes:
        for x,y in N8:
            q=(n[0]+x,n[1]+y)
            if q in pts and frozenset((n,q)) not in used:
                used.add(frozenset((n,q))); paths.append(walk(n,q))
    for p in pts:
        if any(frozenset((p,(p[0]+x,p[1]+y))) in used for x,y in N8 if (p[0]+x,p[1]+y) in pts): continue
        nb=[(p[0]+x,p[1]+y) for x,y in N8 if (p[0]+x,p[1]+y) in pts]
        if nb: used.add(frozenset((p,nb[0]))); paths.append(walk(p,nb[0]))
    return paths

def smooth(path,w=5):
    a=np.array(path,float)
    if len(a)<2*w+1: return a
    k=np.ones(2*w+1)/(2*w+1)
    out=np.stack([np.convolve(np.pad(a[:,i],w,mode='edge'),k,'valid') for i in (0,1)],1)
    out[0],out[-1]=a[0],a[-1]
    return out

def resample(a,step):
    a=np.asarray(a,float)
    if len(a)<2: return a[:1]
    out=[a[0]]; last=a[0]
    for i in range(len(a)-1):
        p,q=a[i],a[i+1]
        while True:
            d=q-p; f=p-last
            A=(d*d).sum()
            if A<1e-12: break
            B=2*(f*d).sum(); C=(f*f).sum()-step*step
            disc=B*B-4*A*C
            if disc<0: break
            t=(-B+np.sqrt(disc))/(2*A)
            if t<0 or t>1: break
            last=p+t*d; out.append(last); p=last
    return np.array(out)

def resample_arc(a,step):
    seg=np.sqrt((np.diff(a,axis=0)**2).sum(1)); cum=np.concatenate([[0],np.cumsum(seg)])
    L=cum[-1]
    if L<1e-6: return a[:1]
    n=max(1,int(np.floor(L/step+0.5)))
    ss=np.linspace(0,L,n+1)
    return np.stack([np.interp(ss,cum,a[:,0]),np.interp(ss,cum,a[:,1])],1)

class Packing:
    def __init__(s,pxmm,gap_mm,cell=48):
        s.st=[]; s.grid=collections.defaultdict(list); s.cell=cell; s.pxmm=pxmm; s.g=gap_mm*pxmm
    def ok(s,y,x,r):
        gy,gx=int(y//s.cell),int(x//s.cell)
        for i in (-1,0,1):
            for j in (-1,0,1):
                for k in s.grid[(gy+i,gx+j)]:
                    sy,sx,sr=s.st[k][:3]
                    if (sy-y)**2+(sx-x)**2 < (sr+r+s.g)**2-0.5: return False
        return True
    def add(s,y,x,r,kind):
        s.st.append((y,x,r,kind)); s.grid[(int(y//s.cell),int(x//s.cell))].append(len(s.st)-1); return len(s.st)-1
    def near(s,y,x,rad):
        gy,gx=int(y//s.cell),int(x//s.cell); c=int(np.ceil(rad/s.cell))
        for i in range(-c,c+1):
            for j in range(-c,c+1):
                for k in s.grid[(gy+i,gx+j)]:
                    sy,sx=s.st[k][:2]
                    if (sy-y)**2+(sx-x)**2<=rad*rad: yield k

def build(src, design_mm=100, line_mm=2.0, fill_mm=2.0, gap=0.1, min_share=0.012):
    im=np.array(Image.open(src).convert('RGBA')).astype(float)
    alpha=im[...,3]>=128
    sil=ndimage.binary_fill_holes(alpha)
    _,(iy,ix)=ndimage.distance_transform_edt(~alpha,return_indices=True)
    rgb=im[...,:3].copy(); rgb[~alpha]=im[iy[~alpha],ix[~alpha],:3]
    ys,xs=np.where(sil); x0,x1,y0,y1=xs.min(),xs.max(),ys.min(),ys.max()
    pxmm=(x1-x0)/design_mm
    lab=skcolor.rgb2lab(rgb/255)
    d=((lab[...,None,:]-LAB)**2).sum(-1)
    lbl=np.argmin(d,axis=-1)
    share=np.bincount(lbl[sil],minlength=len(IDS))/sil.sum()
    d[...,share<min_share]=np.inf; lbl=np.argmin(d,axis=-1)
    jet=IDS.index('jet')
    rl=line_mm/2*pxmm; rf=fill_mm/2*pxmm
    P=Packing(pxmm,gap)
    edt_sil=ndimage.distance_transform_edt(sil)
    # 1. outer outline chain, one stone-radius inside the silhouette edge
    for c in measure.find_contours(edt_sil,rl+0.5):
        if len(c)<8: continue
        for y,x in resample(smooth(c,4),2*rl+P.g)[:-1]:
            if P.ok(y,x,rl): P.add(y,x,rl,'outline')
    n_out=len(P.st)
    # 2. vein chains: thin dark structures -> traced, smoothed, evenly resampled centre-lines
    dark=(lbl==jet)&sil
    dark=ndimage.binary_opening(dark,iterations=1)
    dark=ndimage.binary_closing(dark,structure=disk(max(1,int(0.6*2*rl))))&ndimage.binary_dilation(sil,structure=disk(max(1,int(0.5*rl))))
    skel=skeletonize(dark)
    halfw=ndimage.distance_transform_edt(dark)
    skel&=(halfw<=0.85*2*rl)
    thin_sil=skeletonize(sil)&(edt_sil<=1.3*rl)
    skel|=thin_sil
    lab_s,ns=ndimage.label(skel,structure=np.ones((3,3)))
    csz=ndimage.sum(skel,lab_s,range(1,ns+1)); keep=np.zeros(ns+1,bool); keep[1:]=csz>=1.2*2*rl
    skel=keep[lab_s]
    paths=[p for p in trace_paths(skel) if len(p)>=2]
    paths.sort(key=len,reverse=True)
    for p in paths:
        for y,x in resample(smooth(p,6),2*rl+P.g):
            if P.ok(y,x,rl): P.add(y,x,rl,'line')
    n_line=len(P.st)-n_out
    # 3. advancing-front packing: each new stone touches two existing ones, filled from the lines inward
    r=rf; heap=[]; tried=set()
    struct=np.zeros(sil.shape,bool); YY,XX=np.ogrid[:sil.shape[0],:sil.shape[1]]
    for (y_,x_,rr_,_) in P.st:
        y0_,y1_=max(0,int(y_-rr_-1)),int(y_+rr_+2); x0_,x1_=max(0,int(x_-rr_-1)),int(x_+rr_+2)
        struct[y0_:y1_,x0_:x1_]|=((YY[y0_:y1_]-y_)**2+(XX[:,x0_:x1_]-x_)**2<=rr_*rr_)
    dstruct=ndimage.distance_transform_edt(~struct)
    def push_from(k):
        ay,ax,ar=P.st[k][:3]
        for j in P.near(ay,ax,ar+2*r+2*P.g+max(rl,rf)+1):
            if j==k: continue
            by,bx,br=P.st[j][:3]
            da=ar+r+P.g; db=br+r+P.g
            dx,dy=bx-ax,by-ay; D=np.hypot(dx,dy)
            if D<1e-6 or D>da+db or D<abs(da-db): continue
            a=(da*da-db*db+D*D)/(2*D); h=np.sqrt(max(0.0,da*da-a*a))
            my,mx=ay+a*dy/D, ax+a*dx/D
            for sgn in (1,-1):
                cy,cx=my+sgn*h*dx/D, mx-sgn*h*dy/D
                key=(int(cy*2),int(cx*2))
                if key in tried: continue
                tried.add(key)
                iyy,ixx=int(round(cy)),int(round(cx))
                if not(0<=iyy<sil.shape[0] and 0<=ixx<sil.shape[1]) or edt_sil[iyy,ixx]<r*0.55: continue
                heapq.heappush(heap,(dstruct[iyy,ixx], cy,cx))
    # 3a. rings: rows following the free space left by the chains, walked stone by stone
    free=sil&~struct if False else None
    occ=np.zeros(sil.shape,bool)
    for (y_,x_,rr_,_) in P.st:
        rad=rr_+P.g
        y0_,y1_=max(0,int(y_-rad-1)),int(y_+rad+2); x0_,x1_=max(0,int(x_-rad-1)),int(x_+rad+2)
        occ[y0_:y1_,x0_:x1_]|=((YY[y0_:y1_]-y_)**2+(XX[:,x0_:x1_]-x_)**2<=rad*rad)
    dtf=ndimage.distance_transform_edt(sil&~occ)
    pitch=2*r+P.g; n_before=len(P.st); k=0
    while True:
        level=r+0.5+k*pitch
        if level>dtf.max(): break
        for c in measure.find_contours(dtf,level):
            seg=np.sqrt((np.diff(c,axis=0)**2).sum(1)); cum=np.concatenate([[0],np.cumsum(seg)])
            for s_ in np.arange(0,cum[-1],1.0):
                i=min(np.searchsorted(cum,s_),len(c)-1); y,x=c[i]
                if edt_sil[int(y),int(x)]>=r*0.55 and P.ok(y,x,r): P.add(y,x,r,'fill')
        k+=1
    n_hex=len(P.st)-n_before
    # 3b. touch-two-stones fill of the pockets left against the lines
    for k in range(len(P.st)): push_from(k)
    while heap:
        _,cy,cx=heapq.heappop(heap)
        if P.ok(cy,cx,r):
            k=P.add(cy,cx,r,'fill'); push_from(k)
    n_fill=len(P.st)-n_out-n_line
    # 4. colour: modal catalog label under each stone
    out=[]
    for (y,x,rad,kind) in P.st:
        rr=max(1,int(rad*0.8)); yy,xx=np.ogrid[-rr:rr+1,-rr:rr+1]; m=xx**2+yy**2<=rr*rr
        py,px=int(y)-rr,int(x)-rr
        patch=lbl[max(0,py):py+2*rr+1,max(0,px):px+2*rr+1]; mm=m[:patch.shape[0],:patch.shape[1]]
        cid=np.bincount(patch[mm].ravel(),minlength=len(IDS)).argmax()
        out.append([(x-x0)/pxmm,(y-y0)/pxmm,2*rad/pxmm,IDS[cid]])
    return out,dict(outline=n_out,line=n_line,fill=n_fill,total=len(out),wmm=design_mm,hmm=(y1-y0)/pxmm,
                   coverage=round(sum(np.pi*(s[2]/2)**2 for s in out)/(sil.sum()/pxmm**2),3))
