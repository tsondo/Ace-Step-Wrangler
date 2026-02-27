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

- Python 3.10+
- AceStep 1.5 installed and working
- A modern browser

## Installation

```bash
git clone https://github.com/yourusername/ACE-Step-Wrangler.git
cd ACE-Step-Wrangler
pip install -r backend/requirements.txt
```

## Usage

```bash
python backend/main.py
```

Then open your browser to `http://localhost:7860`.

## Project Structure

```
ACE-Step-Wrangler/
├── backend/
│   ├── main.py               # FastAPI server
│   ├── acestep_wrapper.py    # AceStep API wrapper
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── docs/
    └── PROJECT_PLAN.md       # Full design spec and build plan
```

## Status

🚧 Early development — not yet functional.

## License

MIT
