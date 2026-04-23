#!/usr/bin/env bash
set -euo pipefail

TRAIN_SVC="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$TRAIN_SVC/.venv/bin/activate"

DATA_DIR="${DATA_DIR:-$TRAIN_SVC/data/midi}"
ART_DIR="${ART_DIR:-$TRAIN_SVC/artifacts}"
CKPT="${CKPT:-}"
MAX_STEPS="${MAX_STEPS:-200}"
VAL_STEP="${VAL_STEP:-50}"

mkdir -p "$ART_DIR" "$DATA_DIR"

if [[ -z "$CKPT" ]]; then
  CKPT=$(find "$TRAIN_SVC/models/base/tv2o-medium" -maxdepth 2 -name "model.safetensors" 2>/dev/null | head -1 || true)
fi
if [[ -z "$CKPT" || ! -f "$CKPT" ]]; then
  echo "Base checkpoint not found. Run: ./scripts/download_base_model.sh"
  echo "Or set CKPT=/path/to/model.safetensors"
  exit 1
fi

N=$(find "$DATA_DIR" -type f \( -name "*.mid" -o -name "*.midi" \) | wc -l | tr -d ' ')
if [[ "${N:-0}" -lt 2 ]]; then
  echo "Need at least 2 MIDI files under $DATA_DIR"
  exit 1
fi

if [[ "$N" -gt 9 ]]; then
  VAL_SPLIT=8
else
  VAL_SPLIT=$((N - 1))
fi

if python -c "import torch; exit(0 if torch.backends.mps.is_available() else 1)" 2>/dev/null; then
  ACCEL=mps
  DEVICES=1
else
  ACCEL=cpu
  DEVICES=1
fi

echo "Using accelerator=$ACCEL data=$DATA_DIR val_split=$VAL_SPLIT ckpt=$CKPT artifacts=$ART_DIR"

cd "$TRAIN_SVC/vendor/midi-model"
export PYTHONPATH="."

python train.py \
  --task lora \
  --config tv2o-medium \
  --ckpt "$CKPT" \
  --data "$DATA_DIR" \
  --data-val-split "$VAL_SPLIT" \
  --default-root-dir "$ART_DIR" \
  --accelerator "$ACCEL" \
  --devices "$DEVICES" \
  --precision 32-true \
  --batch-size-train 1 \
  --batch-size-val 1 \
  --acc-grad 4 \
  --workers-train 0 \
  --workers-val 0 \
  --max-step "$MAX_STEPS" \
  --warmup-step 20 \
  --val-step "$VAL_STEP" \
  --gen-example-interval 0 \
  --lr 1e-4 \
  "$@"
