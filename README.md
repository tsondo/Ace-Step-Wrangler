# ACE-Step-Wrangler

A creative-friendly web UI for [AceStep 1.5](https://github.com/ace-step/AceStep), designed for musicians and producers — not ML researchers.

ACE-Step-Wrangler replaces the default Gradio interface with a dark, DAW-inspired UI that abstracts complex model parameters behind intuitive controls. If you know what a compressor does but not what a guidance scale is, this is for you.

## Features

- **Friendly controls** — sliders like "Strictly follow lyrics" and "Creativity" instead of raw model parameters
- **Genre tag picker** — click presets or type your own style description
- **Lyrics panel** — type, paste, or load from a file
- **Smart warnings** — get notified if your song duration is too short for your lyrics before you generate
- **Advanced panel** — raw AceStep parameters still accessible for power users
- **Dark DAW aesthetic** — feels at home next to your other music tools

## Requirements

- Python 3.11+
- A running AceStep 1.5 instance with its REST API enabled (see [AceStep 1.5 docs](https://github.com/ace-step/ACE-Step-1.5))
- A modern browser

ACE-Step-Wrangler runs in its own virtual environment and communicates with AceStep over its local REST API. You do not need to install AceStep into the same environment.

## Installation

```bash
git clone https://github.com/yourusername/ACE-Step-Wrangler.git
cd ACE-Step-Wrangler
uv sync
```

That's it. uv will create the virtual environment and install all dependencies automatically.

## Usage

First, make sure AceStep 1.5 is running with its API enabled:
```bash
# In your AceStep directory
uv run acestep-api  # default: http://localhost:8001
```

Then start ACE-Step-Wrangler:
```bash
uv run python backend/main.py
```

Then open your browser to `http://localhost:7860`.

## Project Structure

```
ACE-Step-Wrangler/
├── pyproject.toml            # Project dependencies (managed by uv)
├── backend/
│   ├── main.py               # FastAPI server
│   └── acestep_wrapper.py    # AceStep API wrapper
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── docs/
    └── PROJECT_PLAN.md       # Full design spec and build plan
```

## Status

Early development — frontend shell is in place but generation is not yet wired up.

| Stage | Description | Status |
|---|---|---|
| 1 | Static HTML/CSS shell | Done |
| 2 | Lyrics panel (file load, count) | Done |
| 3 | Style panel (tags, mood, preview) | Done |
| 4 | Controls column (sliders, validation) | Done |
| 5 | FastAPI backend + AceStep wiring | Pending |
| 6 | Progress + output panel | Pending |
| 7 | Warnings system | Pending |
| 8 | Advanced panel | Pending |
| 9 | Polish pass | Pending |

## License

MIT
