import json, sys, numpy as np
from scipy.spatial import cKDTree
import rs_fix as R, compact as K, pack as PK
name=sys.argv[4]; ka=float(sys.argv[1]); tag=sys.argv[2]
rgb,a,det,s,mask=PK.setup(name); h,w=mask.shape
ix=lambda P:(np.clip((P[:,1]/s).astype(int),0,h-1),np.clip((P[:,0]/s).astype(int),0,w-1)); from scipy import ndimage as _ndi; tight=_ndi.binary_dilation(R._ALPHA>0.5,iterations=2)&mask; inside=lambda P: tight[ix(P)]
js=json.load(open(f'{name}_tight_rs.json')); st=js['stones']; rep=js['report']
P0=np.array([[q['x'],q['y']] for q in st]); C0=[q['color'] for q in st]
P=P0.copy(); D=np.array([q['d'] for q in st]); A=P.copy()
if len(sys.argv)>3:
    from scipy import ndimage as ndi
    flab,clab=PK.openai_sources(name); e=PK.detail_map(flab,mask,s)
    Z=ndi.binary_dilation(e>np.percentile(e[mask],93),iterations=3)
    small=(D==1.5)&~Z[ix(P)]
    D[small]=2.0
    print('ss4 -> ss6 attempted',small.sum(),flush=True)
    P=R.legalise(P,D,A,iters=800,pull=0.002,maxmove=1.2)
    P,D,_,kk=R.resolve_idx(P,D.copy(),P.copy(),np.ones(len(P)),np.zeros(len(P),bool)); A=A[kk]
    hm,cov=R.holes(P,D,mask,s); print('after upsizing',len(P),'ss4',(D==1.5).sum(),round(cov,3),flush=True)
for cyc,need in enumerate([0.6,0.5,0.45] if ka>=0 else []):
    P=PK.spring(P,D,inside,anchor=A,k_anchor=ka)
    P=R.legalise(P,D,P.copy(),iters=400,pull=0.0,maxmove=0.6)
    P,D,_,kk=R.resolve_idx(P,D.copy(),P.copy(),np.ones(len(P)),np.zeros(len(P),bool)); A=A[kk]
    P,D,A=K.densify(P,D,A,mask,s,inside,need_mm=need)[:3]
    hm,cov=R.holes(P,D,mask,s); print('cycle',cyc+1,len(P),round(cov,3),flush=True)
if ka<0:
    for need in [0.62,0.55,0.5]:
        P,D,A=K.densify(P,D,A,mask,s,inside,need_mm=need)[:3]
        hm,cov=R.holes(P,D,mask,s); print('densify',need,len(P),'ss4',(D==1.5).sum(),round(cov,3),flush=True)
fP,fD=R.fill(P,D,mask,s); P=np.concatenate([P,fP]); D=np.concatenate([D,fD])
P,D,_,_=R.resolve_idx(P,D.copy(),P.copy(),np.ones(len(P)),np.zeros(len(P),bool)); K.upgrade(P,D)
col=R.stone_colours(rgb,a,det); keepd=2*det[:,2]*s>=1.6
ids,_=R.snap_colours(col[keepd][cKDTree(det[keepd][:,[1,0]]*s).query(P)[1]])
dd,ii=cKDTree(P0).query(P); C=[C0[ii[k]] if dd[k]<0.6 else ids[k] for k in range(len(P))]
cnt,g=R.violations(P,D); hm,cov=R.holes(P,D,mask,s)
rep2=dict(rep); rep2.update({'stones':int(len(P)),'ss6':int((D==2).sum()),'ss4':int((D==1.5).sum()),'min_gap_mm':float(g),'gap_violations':int(cnt.sum()//2),'largest_empty_circle_mm':float(hm),'coverage':float(cov),'colours_used':len(set(C))})
json.dump({'report':rep2,'stones':[{'x':round(float(x),3),'y':round(float(y),3),'size':'ss6' if d==2 else 'ss4','d':float(d),'color':c} for (x,y),d,c in zip(P,D,C)]},open(f'{name}_{tag}_rs.json','w'))
print({k:rep2[k] for k in ['stones','ss6','ss4','min_gap_mm','gap_violations','coverage']})
