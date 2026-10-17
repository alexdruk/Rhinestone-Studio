#!/bin/bash
cd "$(dirname "$0")"
export CATALOGUE=catalogue_v4.json
n=$1
./ordp.sh $n 2.1 > /dev/null
python3 distinct.py $n ord21 v5 > /dev/null
