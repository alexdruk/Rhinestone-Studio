import sys, numpy as np
from fuse import grads, fuse, drop_small
from wshed import detect as wsd
name=sys.argv[1]; smin=float(sys.argv[2]); mind=float(sys.argv[3])
G,a=grads(name)
C=[]
import os; sd=np.load(os.environ.get('SD_IN', f'{name}_sdens_2.0.npy')); C.append(sd[sd[:,3]>0.3][:,:3])
fr=np.load(f'{name}_frst.npy'); C.append(fr[:,:3]+[0,0,1])
lg=np.load(f'{name}_log.npy'); C.append(lg[:,:3])
for sig,h in [(1.2,0.005),(1.6,0.01)]:
    p,_=wsd(name,sig,h); C.append(np.stack([p[:,0],p[:,1],p[:,2]*0.85],1)); C.append(np.stack([p[:,0],p[:,1],p[:,3]],1))
cands=np.concatenate(C)
f=fuse(G,a,cands,3.5,30,smin,mind)
n0=len(f)
for _ in range(2): f=drop_small(f)
np.save(os.environ.get('FUSED_OUT', f'{name}_fused.npy'),f)
print(name,n0,'->',len(f),'r pct',np.percentile(f[:,2],[5,25,50,75,95]).round(2))
