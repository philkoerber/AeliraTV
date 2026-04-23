#!/usr/bin/env bash
set -euo pipefail

TRAIN_SVC="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$TRAIN_SVC/.." && pwd)"
cd "$TRAIN_SVC"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required."
  exit 1
fi

if [[ ! -d "$TRAIN_SVC/.venv" ]]; then
  python3 -m venv "$TRAIN_SVC/.venv"
fi
# shellcheck source=/dev/null
source "$TRAIN_SVC/.venv/bin/activate"
python -m pip install -U pip

echo "Installing PyTorch for macOS (CPU + MPS when available)..."
python -m pip install torch torchvision torchaudio

python -m pip install -r "$TRAIN_SVC/requirements-mac.txt"

echo "Initializing git submodule (midi-model v1.3.5)..."
cd "$REPO_ROOT"
git submodule update --init --recursive "training-service/vendor/midi-model"

cd "$TRAIN_SVC/vendor/midi-model"
git fetch --tags --quiet 2>/dev/null || true
git checkout -q v1.3.5

if grep -q "safe_load_file" train.py; then
  echo "train.py already contains Mac patches; skipping patch."
else
  echo "Applying patches/train_mac.patch to vendor/midi-model/train.py..."
  patch -p1 < "$TRAIN_SVC/patches/train_mac.patch"
fi

echo "Done. Activate with: source \"$TRAIN_SVC/.venv/bin/activate\""
