# CLAUDE.md — ACE-Step-Wrangler

This file provides context and instructions for Claude Code when working on this project.

## What This Project Is

ACE-Step-Wrangler is a creative-friendly web UI for AceStep 1.5. It replaces the default Gradio interface with a dark, DAW-inspired HTML/CSS/JS frontend backed by a FastAPI Python server. The goal is to make AI music generation usable by musicians and creatives, not just ML researchers.

ACE-Step 1.5 is bundled as a git submodule in `vendor/ACE-Step-1.5/`, giving users a single-clone install. At runtime, AceStep still runs as a separate API server process — the vendoring unifies installation, not the runtime boundary. `run.py` launches both servers.

See `docs/PROJECT_PLAN.md` for full architecture, layout, build order, and design principles.

## Tech Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript — no framework, no build step
- **Backend:** FastAPI (Python)
- **AceStep:** Vendored submodule, called via REST API from the backend
- **Styling target:** Dark pro audio / DAW aesthetic

## Project Structure

```
ACE-Step-Wrangler/
├── CLAUDE.md               ← you are here
├── README.md
├── run.py                  ← unified launcher (both servers)
├── pyproject.toml          ← managed by uv, do not hand-edit
├── uv.lock                 ← auto-generated, commit this
├── vendor/
│   └── ACE-Step-1.5/      ← git submodule — upstream ACE-Step (do not modify)
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
- **ACE-Step is vendored as a git submodule** in `vendor/ACE-Step-1.5/`. Do not modify files inside `vendor/` — pull upstream changes with `git submodule update --remote`. All communication with AceStep is still via its REST API.
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

**Current stage: Complete — all 9 stages shipped**

## Shared Model Location

Set `MODEL_LOCATION` in `.env` (or the environment) to share model checkpoints across installs. When set, `run.py` symlinks `vendor/ACE-Step-1.5/checkpoints` → `$MODEL_LOCATION` at startup, so ACE-Step finds its models transparently. If the variable is unset, checkpoints live in the default vendor location as before.

## GPU Selection

`run.py` manages device isolation between the two servers:

- **AceStep subprocess** gets `CUDA_VISIBLE_DEVICES` set if the user passes `--gpu N` or sets `ACESTEP_GPU=N`. This controls which GPU AceStep uses for inference.
- **Wrangler subprocess** has `CUDA_VISIBLE_DEVICES` explicitly removed from its environment — it has no GPU requirements and must never trigger CUDA initialization.

The following AceStep environment variables are forwarded to the AceStep subprocess if set in the parent environment (never set by default): `ACESTEP_DEVICE`, `MAX_CUDA_VRAM`, `ACESTEP_VAE_ON_CPU`, `ACESTEP_LM_BACKEND`, `ACESTEP_INIT_LLM`.

When modifying `run.py`, preserve this separation — Wrangler code should never depend on GPU availability.

This project uses vanilla HTML, CSS, and JavaScript. No framework, no build step, no exceptions.
HTML

All markup lives in frontend/index.html
New UI components are added as semantic HTML within the existing grid structure
Use <section class="panel"> for major panels, <div class="control-group"> for control blocks
Show/hide content with the .hidden class (adds display: none !important), not by creating/destroying DOM nodes
Tooltips, tabs, and mode switches should use existing HTML elements with class toggling, not third-party libraries

CSS

All styles live in frontend/style.css
Never use inline styles
All colors, spacing, fonts, and layout values come from CSS custom properties defined in :root
New components must use the existing design tokens: --bg, --surface, --accent, --text-primary, --border, etc.
Follow the existing class naming: .panel, .field-group, .field-label, .control-group, .control-label-row, .ghost-btn, .tag, .slider, .select-input, .number-input, .text-input
The app layout is a CSS grid on #app (rows) and #main (columns). Column widths are controlled by CSS variables. Do not replace the grid with flexbox or a different layout system.
When adding new panel variants (e.g. Rework mode), create new content inside the existing grid cells rather than restructuring the grid itself

JavaScript

All JS lives in frontend/app.js as a single file loaded via <script> tag
No ES modules, no import statements, no bundlers
State lives in the DOM: active classes on elements, input values, data- attributes. There is no central JS state object or store.
Pattern: query elements at the top of a section, attach event listeners, call update functions that read DOM state and sync the UI
Use the existing updateSlider() function for any new range inputs
Use the existing debounce() utility for input handlers that trigger API calls
New API calls follow the existing fetch() pattern with async/await, JSON body, and error handling that displays messages in the relevant hint/warning element
Do not add jQuery, Alpine, HTMX, or any JS library

Backend ↔ Frontend Contract

All communication is fetch() to FastAPI endpoints on the same origin
Request bodies are JSON, responses are JSON
New endpoints follow the existing pattern: Pydantic BaseModel for the request schema, async def handler, errors raised as HTTPException
File uploads (e.g. audio for Rework mode) use multipart/form-data, not JSON
## What to Avoid

- Do not add features not in the build plan without discussing first
- Do not expose raw AceStep params in the main UI
- Do not use popups/modals for warnings — use inline messages near the relevant control
- Do not add npm/node dependencies
