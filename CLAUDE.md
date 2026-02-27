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

## Current Build Stage

Check `docs/PROJECT_PLAN.md` build order. Update this line when a stage is complete:

**Current stage: 4 — Controls column**

## What to Avoid

- Do not add features not in the build plan without discussing first
- Do not expose raw AceStep params in the main UI
- Do not use popups/modals for warnings — use inline messages near the relevant control
- Do not add npm/node dependencies
