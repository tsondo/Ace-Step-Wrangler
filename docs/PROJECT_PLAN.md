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

## Build Order

1. **Static shell** — HTML/CSS layout, colors, typography, no functionality ✓
2. **Lyrics panel** — type, paste, file load, character/line count display ✓
3. **Style panel** — clickable genre preset tags + free text override field ✓
4. **Controls column** — friendly sliders, Generate button, basic validation
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
