#!/bin/bash
cd "$(dirname "$0")"
export CATALOGUE=catalogue_v4.json
n=$1; p=$2; N=N2_$n; tag=ord${p/./}
cp ${N}_rs.json /tmp/${N}_rs_bak.json
TARGET_PITCH=$p python3 rs_fix.py $N > /dev/null 2>&1
cp ${N}_rs.json ${N}_p${p/./}_rs.json
TARGET_PITCH=$p python3 -c "
import post as PO, json
r=PO.run('$N','$PWD/${N}_p${p/./}_rs.json','$PWD/${N}_${tag}_rs.json'); print('$n',$p,r['stones'],round(r['width_mm']),round(r['coverage'],3),r['gap_violations'],round(r['min_gap_mm'],3))"
cp /tmp/${N}_rs_bak.json ${N}_rs.json
