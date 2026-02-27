# ACE-Step-Wrangler

A creative-friendly web UI for [AceStep 1.5](https://github.com/ace-step/ACE-Step-1.5), designed for musicians and producers — not ML researchers.

ACE-Step-Wrangler replaces the default Gradio interface with a dark, DAW-inspired UI that abstracts complex model parameters behind intuitive controls. If you know what a compressor does but not what a guidance scale is, this is for you.

## Features

- **Friendly controls** — sliders like "Strictly follow lyrics" and "Creativity" instead of raw model parameters
- **Genre + mood tag picker** — click presets or type your own style description
- **Song parameters** — set key (e.g. A minor), BPM, and time signature; appended to the AceStep prompt automatically
- **Auto duration** — estimates song length from your lyrics and tempo using AceStep's LM planner, with a heuristic fallback
- **Lyrics panel** — write lyrics, leave blank for AI-generated lyrics, or switch to Instrumental mode
- **AI lyrics generation** — leave the lyrics field empty and AceStep's LM writes them from your style settings (single-shot; no separate step)
- **Instrumental mode** — generate purely instrumental tracks with one click
- **Smart warnings** — get notified if your song duration is too short for your lyrics before you generate
- **Rework mode** — reimagine a full song or fix and blend a selected region using the waveform editor
- **DAW-style audio transport** — Rewind / Play / Stop / scrubber on every player, consistent across all result cards and previews
- **Elapsed-time counter** — shows how long generation has been running so you know it hasn't stalled
- **Advanced panel** — raw AceStep parameters (guidance scale, inference steps, scheduler, seed, batch size, audio format) still accessible for power users
- **Dark DAW aesthetic** — feels at home next to your other music tools

## Requirements

- Python 3.11 or 3.12
- A CUDA-capable GPU (for AceStep — Wrangler itself has no GPU requirements)
- A modern browser
- [uv](https://docs.astral.sh/uv/) (recommended) or pip

ACE-Step 1.5 is bundled as a git submodule — no separate installation needed.

## Installation

```bash
git clone --recursive https://github.com/tsondo/ACE-Step-Wrangler.git
cd ACE-Step-Wrangler
uv sync
```

The `--recursive` flag pulls in the ACE-Step 1.5 submodule. If you already cloned without it:

```bash
git submodule update --init --recursive
uv sync
```

`uv sync` creates a virtual environment and installs everything — Wrangler's lightweight dependencies and ACE-Step's full ML stack (PyTorch, transformers, etc.).

## Usage

```bash
uv run python run.py
```

This starts both servers:
- **AceStep API** on `http://localhost:8001` (loads models, runs inference on GPU)
- **Wrangler UI** on `http://localhost:7860` (serves the web interface, no GPU)

Open `http://localhost:7860` in your browser and start making music.

Ctrl+C shuts down both servers gracefully.

> **First run:** AceStep will automatically download its models (~10 GB) on first launch. The default download includes the turbo DiT model, the 1.7B language model, the Qwen3 text encoder, and the audio VAE. The exact LM model chosen may vary based on your GPU's available VRAM. Ensure you have sufficient disk space and a reasonable internet connection. Models are cached locally and only downloaded once. You can also pre-download them with `uv run acestep-download`.

### GPU Selection

ACE-Step is a single-GPU model — it does not do multi-GPU inference, but `CUDA_VISIBLE_DEVICES` controls which GPU it uses.

```bash
# Use a specific GPU (e.g. GPU 1)
uv run python run.py --gpu 1

# Equivalent using environment variable
ACESTEP_GPU=1 uv run python run.py
```

The `--gpu` flag takes priority over `ACESTEP_GPU`. If neither is set, AceStep uses its default auto-detection.

The Wrangler UI server never sees `CUDA_VISIBLE_DEVICES` — it has no GPU requirements.

### Advanced GPU Configuration

ACE-Step supports several environment variables for fine-tuning GPU behavior. These are forwarded to the AceStep subprocess if set:

| Variable | Description |
|---|---|
| `ACESTEP_DEVICE` | Override compute device (e.g. `cuda`, `cpu`, `mps`) |
| `MAX_CUDA_VRAM` | Limit VRAM usage (in GB) |
| `ACESTEP_VAE_ON_CPU` | Run VAE decoding on CPU to save VRAM (`true`/`false`) |
| `ACESTEP_LM_BACKEND` | LLM inference backend override |
| `ACESTEP_INIT_LLM` | Force LLM initialization even if VRAM is tight (`true`/`false`) |

Example:

```bash
MAX_CUDA_VRAM=14 ACESTEP_VAE_ON_CPU=true uv run python run.py --gpu 0
```

See the [ACE-Step 1.5 documentation](https://github.com/ace-step/ACE-Step-1.5) for full details on GPU compatibility and these variables.

### Using a Separate AceStep Instance

If you already have AceStep running elsewhere (different machine, custom setup, etc.), you can skip `run.py` and start only the Wrangler UI:

```bash
uv run python backend/main.py
```

This connects to AceStep's API at `http://localhost:8001` by default. Open `http://localhost:7860` in your browser.

## Project Structure

```
ACE-Step-Wrangler/
├── run.py                    # Unified launcher (both servers)
├── pyproject.toml            # Project dependencies (managed by uv)
├── vendor/
│   └── ACE-Step-1.5/        # Git submodule — upstream ACE-Step
├── backend/
│   ├── main.py               # FastAPI server (Wrangler UI)
│   └── acestep_wrapper.py    # AceStep API wrapper
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── docs/
    └── PROJECT_PLAN.md       # Full design spec and build plan
```

## Compatibility

- **Python:** 3.11–3.12
- **CUDA:** up to 13 (via ACE-Step's PyTorch pins)
- **PyTorch:** up to 2.10 (pinned by ACE-Step per platform)
- **Platforms:** Linux x86_64, Linux aarch64, macOS Apple Silicon, Windows

Wrangler itself has no GPU dependencies — GPU/platform support comes entirely from ACE-Step.

## Status

Complete — all 9 build stages shipped and end-to-end tested. The full generation loop works: style + song parameters → AceStep → audio playback, download, and JSON metadata export.

| Stage | Description | Status |
|---|---|---|
| 1 | Static HTML/CSS shell | Done |
| 2 | Lyrics panel (file load, count) | Done |
| 3 | Style panel (tags, mood, preview) | Done |
| 4 | Controls column (sliders, validation) | Done |
| 5 | FastAPI backend + AceStep wiring | Done |
| 6 | Progress + output panel | Done |
| 7 | Warnings system | Done |
| 8 | Advanced panel | Done |
| 9 | Polish pass | Done |

## License

MIT
