# training-service: SkyTNT midi-model LoRA fine-tune (Mac MVP)

This directory wraps [SkyTNT/midi-model](https://github.com/SkyTNT/midi-model) (Apache-2.0) for **LoRA fine-tuning** on a local folder of MIDI files, optimized for **macOS** (Apple Silicon **MPS** when available, otherwise CPU).

Upstream code lives in [`vendor/midi-model`](vendor/midi-model) as a git submodule pinned to **`v1.3.5`**. A small patch ([`patches/train_mac.patch`](patches/train_mac.patch)) is applied during setup so `train.py` supports **`.safetensors` checkpoints**, **MPS accelerator**, safe **DataLoader** settings without CUDA, and **`--default-root-dir`** for logs under [`artifacts/`](artifacts/).

## Prerequisites

- **Python 3.9+** (3.10+ recommended) and Xcode Command Line Tools.
- **Git** (for submodule + patch workflow).
- **Optional**: [FluidSynth](https://www.fluidsynth.org/) (`brew install fluid-synth`) if you later enable sample generation during training (`--gen-example-interval` > 0). The default `train_lora.sh` keeps it **disabled** so training runs without it.
- **Hugging Face**: Public downloads do not need a token. For gated assets, run `huggingface-cli login`.

## Quick start

From this directory (`training-service/`):

```bash
./scripts/setup.sh
source .venv/bin/activate
./scripts/download_base_model.sh
```

The Hub snapshot is roughly **450 MB** (mostly `model.safetensors`).

**zsh:** If you add an inline `# ...` comment on the same line as a command, that line is only treated as a comment when `interactivecomments` is on (not in every config). Avoid patterns like `# ~446 ...` on the same line: zsh may still expand `~446` and error with `no such user or named directory`. Put notes on the line above, or write “about 450 MB” without a tilde before digits.

Place at least **two** `.mid` or `.midi` files in `data/midi/` (for a piano-only impressionist model, use **solo piano** MIDI you have rights to use).

```bash
./scripts/train_lora.sh
```

Artifacts (Lightning logs, checkpoints, LoRA adapter under `lora/`) go to **`artifacts/`** by default. Override with `ART_DIR=/path ./scripts/train_lora.sh`.

### Environment variables (`train_lora.sh`)

| Variable   | Default              | Purpose                          |
|-----------|----------------------|----------------------------------|
| `DATA_DIR` | `$PWD/data/midi`     | Recursive MIDI input folder      |
| `ART_DIR`  | `$PWD/artifacts`     | `--default-root-dir` for Trainer |
| `CKPT`     | auto under `models/` | Base `model.safetensors` path    |
| `MAX_STEPS` | `200`               | Smoke / MVP run length           |
| `VAL_STEP`  | `50`                | Validation interval (steps)      |

Extra CLI args are forwarded to `train.py`, for example:

```bash
./scripts/train_lora.sh --max-step 2000 --lr 5e-5
```

## Small datasets (`--data-val-split`)

Upstream reserves **`--data-val-split` files** for validation (default 128). With few files, that would leave no training data.

`train_lora.sh` sets `VAL_SPLIT` to **`min(8, N - 1)`** when you have **≤ 9** files, so you keep at least one training file. If you call `train.py` yourself, set `--data-val-split` to something **strictly less than** your file count (and ≥ 1 so validation is non-empty).

## Re-running setup

`setup.sh` reuses `.venv` if it already exists, refreshes the submodule, checks out **`v1.3.5`**, and applies the Mac patch if `train.py` is still unpatched.

To reset the vendored `train.py` to pristine upstream (before re-patching):

```bash
cd vendor/midi-model && git checkout -- train.py && cd ../..
./scripts/setup.sh
```

## Base model

`download_base_model.sh` pulls [`skytnt/midi-model-tv2o-medium`](https://huggingface.co/skytnt/midi-model-tv2o-medium) into `models/base/tv2o-medium/`. Training uses **`model.safetensors`** as `--ckpt` for LoRA.

## License

The wrapper scripts and patch in this repo follow your project license. **SkyTNT/midi-model** is Apache-2.0; respect the licenses of your **training MIDI** files.
