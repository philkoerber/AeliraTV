#!/usr/bin/env bash
set -euo pipefail

TRAIN_SVC="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$TRAIN_SVC/.venv/bin/activate"

OUT="$TRAIN_SVC/models/base/tv2o-medium"
mkdir -p "$OUT"
export OUT

echo "Downloading skytnt/midi-model-tv2o-medium into $OUT ..."
python << 'PY'
from huggingface_hub import snapshot_download
import os
out = os.environ["OUT"]
snapshot_download("skytnt/midi-model-tv2o-medium", local_dir=out)
print("done:", out)
PY

CKPT="$OUT/model.safetensors"
if [[ ! -f "$CKPT" ]]; then
  CKPT=$(find "$OUT" -maxdepth 2 -name "*.safetensors" ! -name "adapter_model.safetensors" | head -1 || true)
fi

echo ""
echo "Base weights ready. Use with train_lora.sh or pass:"
echo "  --ckpt $CKPT"
