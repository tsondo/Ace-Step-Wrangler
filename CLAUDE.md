# CLAUDE.md — ACE-Step-Wrangler

This file provides context and instructions for Claude Code when working on this project.

## What This Project Is

ACE-Step-Wrangler is a creative-friendly web UI for AceStep 1.5. It replaces the default Gradio interface with a dark, DAW-inspired HTML/CSS/JS frontend backed by a FastAPI Python server. The goal is to make AI music generation usable by musicians and creatives, not just ML researchers.

See `docs/PROJECT_PLAN.md` for full architecture, layout, build order, and design principles.

## Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript — no framework, no build step
- **Backend:** FastAPI (Python)
- **AceStep:** Called via its Python API from the backend
- **Styling target:** Dark pro audio / DAW aesthetic

## Project Structure

```
ACE-Step-Wrangler/
├── CLAUDE.md               ← you are here
├── README.md
├── pyproject.toml          ← managed by uv, do not hand-edit
├── uv.lock                 ← auto-generated, commit this
├── docs/
│   └── PROJECT_PLAN.md     ← full design spec, read this first
├── backend/
│   ├── main.py             ← FastAPI app entry point
│   └── acestep_wrapper.py  ← thin wrapper around AceStep REST API
└── frontend/
    ├── index.html
    ├── style.css
    └── app.js
```

## Development Conventions

- **No frameworks.** Frontend is plain HTML/CSS/JS. Do not introduce React, Vue, or any JS framework.
- **No build toolchain.** No webpack, vite, npm, etc. All JS is written to run directly in the browser.
- **One file per concern.** Keep HTML, CSS, and JS in separate files unless there's a compelling reason.
- **Use uv for all dependency management.** Do not create or edit `requirements.txt`. Add dependencies via `uv add <package>` which updates `pyproject.toml` and `uv.lock` automatically.
- **Backend is thin.** The FastAPI backend should do minimal logic — its job is to relay requests to AceStep's REST API cleanly, not to reimplement AceStep features.
- **AceStep is a separate process.** Never import AceStep directly. All communication goes through its local REST API (default: `http://localhost:8001`).
- **Friendly labels only in the main UI.** ML jargon (guidance scale, inference steps, scheduler) belongs exclusively in the advanced panel.
- **Warn early.** Validation and warnings (e.g. lyrics too long for duration) should fire in the frontend before the user hits Generate, not after.

## Key Abstractions

These friendly UI controls map to AceStep parameters:

| UI Label | AceStep Param | Notes |
|---|---|---|
| Duration | `audio_duration` | Warn if lyrics likely won't fit |
| Strictly follow lyrics | `guidance_scale` (lyric) | |
| Creativity | `guidance_scale` (audio) / temperature | |
| Polished / Raw | `num_inference_steps` | |
| Seed | `seed` | Advanced panel only |

### Model Selection (Advanced Panel)

| UI Label | AceStep Param | Values |
|---|---|---|
| Generation model | `ACESTEP_CONFIG_PATH` | `acestep-v15-turbo` (default), `acestep-v15-sft`, `acestep-v15-base` |
| Planning intelligence | `ACESTEP_LM_MODEL_PATH` | None, `acestep-5Hz-lm-0.6B`, `acestep-5Hz-lm-1.7B` (default), `acestep-5Hz-lm-4B` |
| Batch size | `batch_size` | 1–4 normally; locked to 1 when sft/base + 4B LM |

`Qwen3-Embedding-0.6B` is an internal text encoder — always required, never exposed in the UI.

### Batch Size & VRAM Constraint

`batch_size` is always visible in the advanced panel. Its maximum is determined by two factors: the model combination and the user-selected VRAM tier.

**VRAM tier selector** (advanced panel, user sets once):
- ≤16GB (default — conservative)
- 24GB
- 32GB+

**Batch size maximums by tier:**

| VRAM Tier | sft/base + 4B LM | All other combos |
|---|---|---|
| ≤16GB | 1 (locked, show inline note) | 2 |
| 24GB | 2 | 4 |
| 32GB+ | 4 | 8 |

When batch_size is locked to 1, show a concise inline note in the advanced panel explaining the model+VRAM combination requires it. Never silently change the value.

## Current Build Stage

Check `docs/PROJECT_PLAN.md` build order. Update this line when a stage is complete:

**Current stage: 8 — Advanced panel**

## What to Avoid

- Do not add features not in the build plan without discussing first
- Do not expose raw AceStep params in the main UI
- Do not use popups/modals for warnings — use inline messages near the relevant control
- Do not add npm/node dependencies
