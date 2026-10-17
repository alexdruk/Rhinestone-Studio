#!/bin/bash
set -e
cd "$(dirname "$0")"
export CATALOGUE=catalogue_v4.json
n=$1; N=N2_$n
python3 detect.py $N > /dev/null
python3 detect2.py $N > /dev/null
SD_VIEWS=alpha,Lw SD_OUT=${N}_sdens_2.0.npy python3 sdens.py $N > /dev/null 2>&1
SD_IN=${N}_sdens_2.0.npy FUSED_OUT=${N}_fused.npy python3 runfuse.py $N 0.03 0.8
TARGET_PITCH=2.1 python3 rs_fix.py $N > /dev/null
cp ${N}_rs.json ${N}_p21_rs.json
EYE_MODE=copy LASHES=1 TARGET_PITCH=2.1 python3 -c "import post; r = post.run('$N', '${N}_p21_rs.json', '${N}_ord21_rs.json'); print('$n', r['stones'], round(r['width_mm']), round(r['coverage'], 3), r['gap_violations'], round(r['min_gap_mm'], 3))"
python3 distinct.py $n ord21 final
