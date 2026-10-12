#!/usr/bin/env bash
# Download the NTIA/ITS ITM reference (C++) and build a small CLI used by validate_itm.js.
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p itm-ref/include itm-ref/src; cd itm-ref
B=https://raw.githubusercontent.com/NTIA/itm/master
for f in itm.h Enums.h Errors.h Warnings.h; do curl -fsSL $B/include/$f -o include/$f; done
for f in itm_p2p.cpp LongleyRice.cpp QuickPfl.cpp ComputeDeltaH.cpp DiffractionLoss.cpp FindHorizons.cpp FreeSpaceLoss.cpp \
         FresnelIntegral.cpp H0Function.cpp InitializePointToPoint.cpp InverseComplementaryCumulativeDistributionFunction.cpp \
         KnifeEdgeDiffraction.cpp LinearLeastSquaresFit.cpp LineOfSightLoss.cpp SigmaHFunction.cpp SmoothEarthDiffraction.cpp \
         TerrainRoughness.cpp TroposcatterLoss.cpp Variability.cpp ValidateInputs.cpp; do
  curl -fsSL $B/src/$f | sed 's#\.\.\\include\\#../include/#' > src/$f
done
sed -i 's/__declspec(dllexport)//' include/itm.h
cp ../itm_ref_main.cpp src/main.cpp
g++ -O2 -std=c++17 -o itmref src/*.cpp
echo "built tools/itm-ref/itmref — now run: node tools/validate_itm.js"
