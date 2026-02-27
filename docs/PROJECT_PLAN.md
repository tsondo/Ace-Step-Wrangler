# ACE-Step-Wrangler — Project Plan

> **Note:** This document reflects the original design spec. The shipped implementation has evolved beyond it — see `docs/USER_GUIDE.md` for current behaviour and `CLAUDE.md` for current architecture notes.

## Overview

ACE-Step-Wrangler is a creative-friendly web UI for AceStep 1.5, designed to replace the default Gradio interface. The goal is to make AI music generation accessible to musicians and creatives — not just researchers — by abstracting complex ML parameters behind intuitive, music-production-oriented controls.

## Architecture

**Frontend:** Vanilla HTML, CSS, JavaScript (no framework, no build toolchain)
**Backend:** FastAPI (Python) — thin wrapper that relays requests to AceStep's REST API
**AceStep:** Vendored as a git submodule in `vendor/ACE-Step-1.5/`, runs as a separate API server process
**Communication:** `fetch()` with polling or Server-Sent Events for generation progress
**Launcher:** `run.py` starts both the AceStep API server (port 8001) and the Wrangler UI server (port 7860)
**Aesthetic:** Dark pro audio / DAW-like

### Vendored Dependencies

ACE-Step 1.5 is included as a git submodule rather than assumed to be a separate installation. This gives users a single-clone, single-command setup while keeping upstream compatibility — we track ACE-Step's releases without maintaining a fork.

- The submodule lives at `vendor/ACE-Step-1.5/` and is referenced as an editable path dependency in `pyproject.toml`.
- `uv sync` installs ACE-Step and all its ML dependencies (PyTorch, transformers, etc.) into the same venv as Wrangler.
- At runtime, AceStep still runs as a **separate process** — communication is via its REST API on localhost. The vendoring only unifies the installation, not the runtime boundary.
- Do not modify files inside `vendor/` — pull upstream changes with `git submodule update --remote`.  

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
│  OUTPUT — result cards / progress / playback / download      │
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

### Audio Format Selector (Advanced Panel)

A format selector is exposed in the advanced panel alongside other generation parameters:

| UI Label | Value | Notes |
|---|---|---|
| MP3 (default) | `mp3` | Smaller files, good for previewing |
| WAV | `wav` | Lossless, best for DAW import |
| FLAC | `flac` | Lossless + compressed |

Passed to AceStep as the `audio_format` payload field. The download filename extension should match the selected format.

## Build Order

1. **Static shell** — HTML/CSS layout, colors, typography, no functionality ✓
2. **Lyrics panel** — type, paste, file load, character/line count display ✓
3. **Style panel** — clickable genre preset tags + free text override field ✓
4. **Controls column** — friendly sliders, Generate button, basic validation ✓
5. **FastAPI backend** — `/generate`, `/status`, `/cancel` endpoints wired to AceStep ✓
6. **Progress + output panel** — polling, per-result cards, playback, download (see Stage 6 spec below) ✓
7. **Warnings system** — duration vs. lyrics length heuristic, other validation ✓
8. **Advanced panel** — raw AceStep params, seed, scheduler (collapsed by default) ✓
9. **Polish pass** — transitions, error states, keyboard shortcuts, accessibility ✓

## Stage 6 — Progress + Output Panel (Detailed Spec)

### Output Panel Behaviour

The output panel (footer) transitions through three states:

1. **Idle** — placeholder hint text, play and download buttons disabled.
2. **Generating** — a progress indicator (spinner or animated bar) with a "Generating…" label. No cards yet.
3. **Done** — a horizontal scrollable row (or wrapping grid) of **result cards**, one per batch item.

### Result Cards

Each card represents a single generated audio file and contains:

- An inline `<audio>` element with browser-native controls for immediate preview.
- A **Download audio** button — triggers a file download via `/download/{job_id}/{index}/audio`. Filename: `acestep-{job_id}-{index}.{format}` where `{format}` matches the audio format chosen at generation time.
- A **Download JSON** button — triggers download via `/download/{job_id}/{index}/json`. Contains the generation metadata returned by AceStep (`metas` field), plus a copy of the parameters used (style prompt, lyrics, all control values). Filename: `acestep-{job_id}-{index}.json`.
- The card index label (e.g. "Result 1 of 3") for orientation when batch_size > 1.

No zip/bulk download is provided — the user previews each result and downloads only what they want to keep.

### Backend Endpoints for Stage 6

Two new download endpoints to add to `main.py`:

#### `GET /download/{job_id}/{index}/audio`
- Fetches the audio bytes from AceStep using the stored `audio_url` for that job/index.
- Returns the file with `Content-Disposition: attachment` and the correct MIME type.
- The job result (task_id → list of audio_urls + metadata) must be stored server-side after a successful `/status` poll resolves to `done`. A simple in-process dict is sufficient for now (no persistence required).

#### `GET /download/{job_id}/{index}/json`
- Returns a JSON file containing:
  - `generated_at`: ISO timestamp
  - `params`: the full `GenerateRequest` fields used for the job
  - `meta`: the AceStep `metas` dict for that index (may be null)
- Returned with `Content-Disposition: attachment; filename="acestep-{job_id}-{index}.json"`.

### Implementation Notes

- Keep result state in a module-level dict in `main.py` keyed by `task_id`. Entries are written when a `/status` poll returns `done` and never expire within a session (process restart clears them, which is acceptable for now).
- The frontend continues polling `/status/{task_id}` as implemented in Stage 5. On `status === "done"`, it renders the result cards using the `audio_url` array from the response. The download buttons hit the new `/download/` endpoints rather than proxying through `/audio`.
- The existing `/audio` proxy endpoint can remain for legacy compatibility but the new card-based UI should use `/download/` for downloads.
- Cards should render in order (index 0 first). If only one result, omit the "Result N of N" label.

---

## Song Parameters — Style Panel Addition

Three always-visible controls placed between the Mood tags and the Custom description field:

| Control | HTML element | Range / options | Default |
|---|---|---|---|
| Key root | `<select id="key-root">` | C, C#, D, D#, E, F, F#, G, G#, A, A#, B | (none) |
| Key mode | `<select id="key-mode">` | Major, Minor | Major |
| BPM | `<input type="number" id="bpm">` | 40–300, step 1 | (empty) |
| Time signature | `<select id="time-sig">` | 4/4, 3/4, 6/8, 5/4, 7/8 | 4/4 |

**Style preview:** `getSongParamsSummary()` generates "C major, 120 BPM, 4/4 time" (only non-empty fields; time sig only included when key or BPM is also set). Combined with style tags/custom text in the preview using " · " separator.

**Payload:** Sent as separate `key`, `bpm`, `time_signature` fields in `GenerateRequest`. The backend's `_build_payload()` appends them to the AceStep `prompt` string (e.g. "…, C major, 120 BPM, 4/4 time") and stores all three in the download JSON.

---

## Auto Duration Toggle

An **Auto** button sits to the left of the Duration value label. Default: off.

- **Auto OFF:** Duration slider is interactive (normal behaviour).
- **Auto ON:** Slider is disabled and automatically set to the result of `POST /estimate-duration` whenever lyrics, BPM, or time signature change (debounced 600 ms). The button gains `.active` styling (amber fill).

### `POST /estimate-duration`

**Request:**
```json
{ "lyrics": "...", "bpm": 120, "time_signature": "4/4", "lm_model": "1.7b" }
```

**Response:**
```json
{ "seconds": 180, "method": "lm" | "heuristic", "assumed_bpm": 120 }
```
(`assumed_bpm` only present when `bpm` was not supplied and the heuristic defaulted to 120.)

**Primary path (lm_model != "none"):** Calls AceStep's `/format_input` endpoint and attempts to extract a `duration` field from the response. If successful, snaps to nearest 5 s and clamps to 10–240 s.

**Fallback — heuristic:**
1. Parse `[Section Header]` lines from lyrics with a regex.
2. Map each header to a bar count (Verse = 16, Intro/Chorus/Bridge/Outro/all others = 8). Unknown headers default to 8.
3. If no headers found, assume 2 verses + 2 choruses (total 48 bars).
4. Formula: `total_bars × time_sig_numerator / BPM × 60`
5. Snap to nearest 5 s, clamp to 10–240 s.

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
