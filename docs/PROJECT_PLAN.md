# ACE-Step-Wrangler — Project Plan

## Overview

ACE-Step-Wrangler is a creative-friendly web UI for AceStep 1.5, designed to replace the default Gradio interface. The goal is to make AI music generation accessible to musicians and creatives — not just researchers — by abstracting complex ML parameters behind intuitive, music-production-oriented controls.

## Architecture

**Frontend:** Vanilla HTML, CSS, JavaScript (no framework, no build toolchain)  
**Backend:** FastAPI (Python) — thin wrapper around the AceStep Python API  
**Communication:** `fetch()` with polling or Server-Sent Events for generation progress  
**Aesthetic:** Dark pro audio / DAW-like  

## Layout

Three-column layout with a persistent output panel at the bottom:

```
┌─────────────────────────────────────────────────────────────┐
│  [Logo/Name]                              [Settings ⚙]      │
├───────────────┬─────────────────────────┬───────────────────┤
│               │                         │                   │
│  STYLE        │  LYRICS                 │  CONTROLS         │
│               │                         │                   │
│  Genre tags   │  Big text area          │  Duration slider  │
│  (presets)    │  (type/paste/load)      │  ──────────────   │
│               │                         │  Lyric adherence  │
│  + free text  │  ⚠ warnings inline      │  Creativity       │
│  override     │                         │  Polished/Raw     │
│               │                         │  ──────────────   │
│               │                         │  Seed (optional)  │
│               │                         │                   │
│               │                         │  [▶ GENERATE]     │
├───────────────┴─────────────────────────┴───────────────────┤
│  OUTPUT — waveform / progress / playback / download          │
└─────────────────────────────────────────────────────────────┘
```

## User-Facing Parameter Abstractions

These friendly controls map to underlying AceStep parameters:

| UI Control | Maps To | Notes |
|---|---|---|
| Duration slider | `audio_duration` | Shows warning if too short for lyrics |
| Strictly follow lyrics | `guidance_scale` (lyric) | Low/Med/High or slider |
| Creativity | `guidance_scale` (audio) + temperature | Inverse relationship |
| Polished / Raw | `num_inference_steps` | More steps = more polished |
| Seed | `seed` | Optional, shown in advanced panel |

## Model Selection (Advanced Panel)

Two independent model axes, both exposed in the advanced panel with friendly labels.

### Generation Model (`ACESTEP_CONFIG_PATH` / DiT)

| UI Label | Model | Notes |
|---|---|---|
| Turbo (default) | `acestep-v15-turbo` | Fast, high quality, 8 steps |
| High Quality | `acestep-v15-sft` | Best prompt adherence, slower |
| Base | `acestep-v15-base` | For LoRA/fine-tuning workflows; tricky to use manually |

### Planning Intelligence (`ACESTEP_LM_MODEL_PATH` / LM)

| UI Label | Model | Notes |
|---|---|---|
| None | — | Fastest, lowest VRAM, no Chain-of-Thought planning |
| Small | `acestep-5Hz-lm-0.6B` | ~6.5GB VRAM total |
| Medium (default) | `acestep-5Hz-lm-1.7B` | ~8.5GB VRAM total |
| Large | `acestep-5Hz-lm-4B` | ~13.5GB VRAM total, strongest composition |

**Note:** `Qwen3-Embedding-0.6B` is a fixed internal text encoder baked into the DiT architecture. It is always required and is never a user-facing choice.

### Batch Size & VRAM Constraint

`batch_size` controls how many songs generate simultaneously (1–8). Limits depend on the model combination and available VRAM. The UI should always expose batch_size but enforce sensible limits per tier:

| VRAM Tier | Example GPUs | sft/base + 4B LM | All other combos |
|---|---|---|---|
| ≤16GB | RTX 4080, 3080 Ti | Lock to 1, show warning | Max 2 |
| 24GB | RTX 3090, 4090 | Max 2 | Max 4 |
| 32GB+ | A100, H100, 3090x2 | Max 4 | Max 8 |

Implementation notes:
- The UI cannot auto-detect VRAM — expose a **VRAM tier selector** in the advanced panel (≤16GB / 24GB / 32GB+) so the user sets it once and the batch_size max updates accordingly.
- Default tier: 16GB (conservative — better to under-promise).
- When batch_size is locked to 1 due to model+VRAM combination, show a clear inline note explaining why.
- `batch_size` lives in the advanced panel and is always visible regardless of tier.

## Build Order

1. **Static shell** — HTML/CSS layout, colors, typography, no functionality ✓
2. **Lyrics panel** — type, paste, file load, character/line count display ✓
3. **Style panel** — clickable genre preset tags + free text override field ✓
4. **Controls column** — friendly sliders, Generate button, basic validation ✓
5. **FastAPI backend** — `/generate`, `/status`, `/cancel` endpoints wired to AceStep
6. **Progress + output panel** — polling, waveform display, playback, download
7. **Warnings system** — duration vs. lyrics length heuristic, other validation
8. **Advanced panel** — raw AceStep params, seed, scheduler (collapsed by default)
9. **Polish pass** — transitions, error states, keyboard shortcuts, accessibility

## Key Design Principles

- **Abstract, don't hide.** Advanced params are always accessible, just not in the way.
- **Warn early.** Surface problems (e.g. duration too short) before the user hits Generate.
- **No jargon in the main UI.** Terms like "guidance scale" and "inference steps" belong in the advanced panel only.
- **Fast to use.** A creative should be able to go from idea to generated audio in under 60 seconds of UI interaction.

## Target User

Musicians, producers, and creatives who are comfortable with DAW software but have no background in machine learning. They understand concepts like tempo, dynamics, and arrangement but should never need to know what a guidance scale is.

## Out of Scope (for now)

- Multi-track / stems support
- Project save/load
- Cloud deployment
- User accounts
