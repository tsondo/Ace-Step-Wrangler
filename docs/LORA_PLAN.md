# LoRA Integration Plan

## Overview

Two-phase integration of ACE-Step's LoRA capabilities into the Wrangler UI:
1. **Phase 1: LoRA Conditioner** — load and use trained LoRA adapters during generation (Advanced panel)
2. **Phase 2: LoRA Training** — train custom LoRA adapters from audio files (new Train tab)

Both phases use ACE-Step's existing infrastructure. The Wrangler never imports ACE-Step directly — all communication is via REST API.

---

## Phase 1: LoRA Conditioner (Advanced Panel)

### What it does
Load a pre-trained LoRA adapter to influence the generation model's style. Users can browse community LoRAs or use their own trained adapters.

### ACE-Step API endpoints (already exist)
- `POST /v1/lora/load` — `{ lora_path, adapter_name? }`
- `POST /v1/lora/unload` — restore base model
- `POST /v1/lora/toggle` — `{ use_lora: bool }`
- `POST /v1/lora/scale` — `{ scale: 0.0-1.0, adapter_name? }`
- `GET /v1/lora/status` — current state

### Wrangler backend (new endpoints)
```
POST /lora/load        → proxy to /v1/lora/load
POST /lora/unload      → proxy to /v1/lora/unload
POST /lora/toggle      → proxy to /v1/lora/toggle
POST /lora/scale       → proxy to /v1/lora/scale
GET  /lora/status      → proxy to /v1/lora/status
GET  /lora/browse      → list .safetensors / adapter dirs in configured lora directory
```

### Wrangler backend changes
- `acestep_wrapper.py`: Add async functions for each LoRA endpoint
- `main.py`: Add route handlers that proxy through the wrapper
- `GET /lora/browse`: Scan a configurable directory (env var `LORA_DIR`, default `./loras/`) for adapter directories (containing `adapter_config.json`) and LoKR files (`*.safetensors` with lokr metadata). Return list of `{ name, path, type, size_mb }`.

### Frontend: Advanced panel addition
Location: Inside `<details class="advanced-panel">`, after the Scheduler/Inference steps section, before the closing `</div>`.

```html
<div class="section-divider"></div>

<!-- Style Adapter (LoRA) -->
<div class="control-group" id="lora-section">
  <span class="tag-group-label">Style Adapter</span>
  <div class="lora-status" id="lora-status">No adapter loaded</div>

  <div class="lora-controls">
    <select id="lora-browser" class="select-input">
      <option value="">Select adapter...</option>
    </select>
    <button class="ghost-btn" id="lora-load-btn" type="button">Load</button>
    <button class="ghost-btn hidden" id="lora-unload-btn" type="button">Unload</button>
  </div>

  <div class="lora-active-controls hidden" id="lora-active-controls">
    <div class="control-label-row">
      <label class="field-label" for="lora-scale">Style influence</label>
      <span class="control-value" id="lora-scale-value">100%</span>
    </div>
    <input type="range" id="lora-scale" class="slider" min="0" max="100" value="100" step="5">
    <div class="slider-bounds"><span>Subtle</span><span>Full</span></div>
  </div>
</div>
```

### Frontend JS
- On page load: `GET /lora/status` to restore state if adapter already loaded
- On page load: `GET /lora/browse` to populate the dropdown
- Load button: `POST /lora/load` with selected path, show status, reveal active controls
- Unload button: `POST /lora/unload`, hide active controls
- Scale slider: debounced `POST /lora/scale` with `scale = value / 100`
- Status display: friendly text like "Jazz LoRA loaded (75% influence)"

### Constraint
LoRA loading fails if the model is quantized (int8/fp8). The status message from ACE-Step will indicate this. Display it as-is in the status element.

---

## Phase 2: LoRA Training (Train Tab)

### What it does
Train a custom LoRA adapter from a collection of audio files. Uses ACE-Step's training_v2 (Side-Step) pipeline, which fixes critical bugs in the original trainer.

### Architecture decision: proxy the existing training API
ACE-Step already has a complete training API (`/v1/training/*`, `/v1/dataset/*`)
that runs training in-process using `RuntimeComponentManager` to offload
VAE/text encoder/LLM to CPU, keeping only the decoder on GPU. This is far
more VRAM-efficient than a separate subprocess (no duplicate model load).

The Wrangler proxies these endpoints — same pattern as Phase 1 and all
other AceStep communication. Note: this uses V1's `LoRATrainer`, not
training_v2's corrected trainer. V2 integration would require either
upstream API support or a subprocess approach (future work).

After training completes, `POST /v1/reinitialize` restores all model
components for generation.

### Training and generation are mutually exclusive
AceStep offloads model components during training, so generation is
unavailable. The UI shows a clear warning and disables mode switching
during active training.

### UI: New "Train" mode tab
Add a fourth mode button alongside Create / Rework / Analyze:

```
[Create] [Rework] [Analyze] [Train]
```

When Train is active:
- Left panel: Training wizard (replaces Style panel)
- Center panel: Training progress & logs (replaces Lyrics panel)
- Right panel: Training config (replaces Controls panel)
- Output panel: hidden or shows "Training mode — generation disabled"

### Training wizard flow (left panel)

**Step 1: Dataset**
- Drag-and-drop audio files or select a folder
- Upload via multipart to Wrangler backend (saved to temp dir)
- Display list of uploaded files with durations
- "Auto-label" button → calls ACE-Step's LLM to generate captions/lyrics
- Editable caption per file

**Step 2: Configure (right panel)**
Friendly presets with expandable details:

| Friendly label | Maps to | Default |
|---|---|---|
| Training preset | epochs + lr + accumulation | "Standard (10 epochs)" |
| Adapter rank | lora_rank | 64 |
| Adapter type | "lora" or "lokr" | LoRA |
| Save checkpoints | save_every_n_epochs | 5 |

Expand for raw params: learning_rate, lora_alpha, lora_dropout, gradient_accumulation, optimizer, scheduler, seed.

**Step 3: Train (center panel)**
- "Start Training" button
- Progress bar with epoch/step counter
- Live loss value display
- Stop button
- On completion: "Load this adapter" button (calls Phase 1's load endpoint)

### Wrangler backend (new endpoints)
```
POST /train/upload          → save audio files, return upload manifest
POST /train/preprocess      → launch preprocessing subprocess
GET  /train/preprocess/status → poll preprocessing progress
POST /train/start           → launch training subprocess with config
GET  /train/status          → poll training progress (epoch, loss, etc.)
POST /train/stop            → kill training subprocess
GET  /train/checkpoints     → list saved checkpoints for loading
```

### Subprocess management
- `backend/train_manager.py` (new file): manages the training subprocess lifecycle
- Launches `python vendor/ACE-Step-1.5/train.py fixed --checkpoint-dir ... --dataset-dir ... --output-dir ...`
- Captures stdout line-by-line, parses progress indicators
- Stores current state in memory (like `_jobs` dict pattern)
- Only one training session at a time

---

## Build Sequence

1. **Phase 1a**: `acestep_wrapper.py` — add LoRA proxy functions
2. **Phase 1b**: `main.py` — add LoRA route handlers + browse endpoint
3. **Phase 1c**: `index.html` — add Style Adapter section to advanced panel
4. **Phase 1d**: `app.js` — add LoRA UI logic
5. **Phase 1e**: `style.css` — add LoRA-specific styles
6. **Phase 1 test**: Load/unload/scale cycle with a real adapter

7. **Phase 2a**: `backend/train_manager.py` — subprocess management
8. **Phase 2b**: `main.py` — training route handlers
9. **Phase 2c**: `index.html` — Train mode tab + wizard panels
10. **Phase 2d**: `app.js` — training wizard logic
11. **Phase 2e**: `style.css` — training UI styles
12. **Phase 2 test**: Full train → load → generate cycle

---

## File changes summary

### New files
- `docs/LORA_PLAN.md` (this file)
- `backend/train_manager.py` (Phase 2)

### Modified files
- `backend/acestep_wrapper.py` — LoRA proxy functions
- `backend/main.py` — LoRA + training endpoints
- `frontend/index.html` — Style Adapter section + Train tab
- `frontend/app.js` — LoRA controls + training wizard
- `frontend/style.css` — new component styles
- `CLAUDE.md` — update current stage
- `.gitmodules` — updated submodule URL (already done)
