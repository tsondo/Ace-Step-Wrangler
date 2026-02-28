# ACE-Step Wrangler — User Guide

ACE-Step Wrangler is a DAW-style web UI for [AceStep 1.5](https://github.com/ace-step/ACE-Step), an AI music generation model. It replaces the default Gradio interface with a dark, musician-friendly frontend.

---

## Launching

```bash
uv run wrangler
```

Open **http://localhost:7860** in your browser. AceStep must finish loading its models before the first generation — the first run after startup may take a minute.

---

## Layout

The interface is a three-column layout with an output panel across the bottom.

| Column | Contents |
|---|---|
| Left | **Style** (Create mode) or **Rework** controls |
| Centre | **Lyrics** — three tabs: My Lyrics, AI Lyrics, Instrumental |
| Right | **Controls** — duration, quality, generate button |
| Bottom | **Output** — generated audio, waveform editor |

Switch between **Create** and **Rework** mode using the tab buttons in the header.

---

## Create Mode

### Style Panel (left column)

Build a style description by combining tags and free text. The assembled prompt is shown in the **Style prompt** preview at the bottom of the panel.

- **Genre / Mood tags** — click to toggle; multiple selections are combined
- **Key** — root note + major/minor
- **BPM** — beats per minute; leave blank for the model to decide
- **Time signature** — 4/4, 3/4, 6/8, 5/4, 7/8
- **Custom description** — free-text override or addition; mixed with any active tags

### Lyrics Panel (centre column)

The panel header has three tabs: **My Lyrics**, **AI Lyrics**, and **Instrumental**. Each tab independently remembers its last generated song — you can have a different result in each and rework any of them.

**My Lyrics** (default)

Write or paste your own lyrics. Use `[Section]` headers on their own line to mark song structure:

```
[Verse 1]
Lines go here

[Chorus]
Lines go here
```

Actions in the toolbar:
- **Language selector** (EN / ZH / JA / …) — tells AceStep the vocal language
- **Load file** — load lyrics from a `.txt` or `.lrc` file (you can also drag and drop onto the panel)
- **Clear** — empty the textarea
- **Load music** — load an existing audio file (WAV/FLAC/MP3) and optionally a companion JSON. If the JSON is included, lyrics, style, BPM, duration, key, and other settings are restored from it. The audio is stored so switching to Rework auto-loads it.

A character count and a lyrics-too-long warning appear as you type. If the lyrics are likely too long for the chosen duration, adjust the Duration slider before generating.

**AI Lyrics**

Let AceStep's language model write the lyrics for you. The tab has two fields:

- **Song description** — describe the mood, topic, or style of the song you want (e.g. "upbeat summer anthem about road trips"). This is combined with your Style panel settings and sent to the model.
- **Generated lyrics** — a read-only display that fills in after generation. You can select and copy the text to paste into My Lyrics for editing.

The language selector controls which language the AI generates vocals in.

**Instrumental**

AceStep generates a purely instrumental track from your style settings — no lyrics are generated or expected.

### Controls Panel (right column)

| Control | What it does |
|---|---|
| **Duration** | Target length of the output. Use **Auto** to estimate from your lyrics and tempo. |
| **Strictly follow lyrics** | Loose → model interprets freely; Strict → model tracks every syllable |
| **Creativity** | Restrained → stays close to the style prompt; Wild → more unexpected results |
| **Quality** | Raw → fast (fewer steps); Polished → slower, more refined |
| **▶ Generate** | Submit the job. Keyboard shortcut: **Ctrl/Cmd + Enter** |

### Output Panel

While generating, an elapsed timer and a **Cancel** button are shown.

On completion, one card per result appears. Each card has a custom audio player (with a save button for quick download), and download links for the audio file and a JSON metadata file. The result is automatically stored in the active tab — switching to Rework loads it.

---

## Rework Mode

Rework takes an existing audio file and transforms part or all of it.

### Loading Audio

- **Drag and drop** an audio file onto the upload zone, or click **Browse**
- Or simply click the **Rework** tab — it auto-loads the last result from whichever lyrics tab (My Lyrics / AI Lyrics / Instrumental) is currently active
- Or use **Load music** on the My Lyrics tab to load an existing audio file for reworking

Once loaded, the filename, duration, and an audio player appear. The output panel shows a **waveform timeline** of the audio.

### Approach

**Reimagine** — generates a new creative take on the **entire song**. The waveform selection has no effect here; any region you drew is ignored. Use the **Reimagine strength** slider to control how closely the result resembles the original.

| Reimagine strength | Effect |
|---|---|
| Low (Subtle) | Stays close to the original structure and feel |
| High (Dramatic) | More departure from the source |

**Fix & Blend** — regenerates **only the selected region** while keeping everything else intact. This is the approach to use when you want to change a specific section. Best used on targeted sections rather than large portions of the song.

Set the region:
- Click and drag on the **waveform** to select a range (highlighted in amber)
- Drag the left/right handles to adjust an existing selection
- Click a **section label** (if lyrics were provided) to snap to that section; Shift-click to extend the selection
- Start/end timecodes are displayed right on the waveform at the selection edges
- Or type start/end times directly in the region inputs in the Rework panel

### Style Direction

Describe what you want the result to sound like. Works for both approaches.

> *make it more jazzy with warm brass and less percussion*

If you have lyrics in the Lyrics panel, they are sent to the model as guidance.

### After Generation

The output panel stays on the waveform view with the reworked audio loaded. You can:

- Play the result using the audio player in the upload area
- Select a new region and rework again immediately
- Download the result with **Download audio** / **Download JSON**

---

## Playback Controls

Every audio player in the app uses the same transport controls.

| Control | Label | Behaviour |
|---|---|---|
| **Rewind** | ⟪ | Jumps to position 0. If the audio is playing, it keeps playing from the top. If paused, it just repositions without starting playback. |
| **Play / Pause** | ▶ / ⏸ | Toggles between play and pause. Shows ▶ when paused, ⏸ when playing. Resumes from the current position. |
| **Stop** | ⏹ | Pauses and saves the current position. Next Play resumes from there. Greyed out when nothing is playing. |
| **Scrubber** | ▬▬▬ | Click anywhere on the bar to seek to that position and immediately start playback. |
| **Save** | ⬇ | Downloads the audio file directly from the player bar. |

Additional behaviours:

- **End of track** — playback stops and position resets to 0 automatically
- **Exclusive playback** — starting any player pauses all other players

---

## Advanced Settings

Click **Advanced** in the Controls panel to expand.

| Setting | Options | Notes |
|---|---|---|
| **Generation model** | Turbo (default), High Quality, Base | Turbo is fastest; High Quality produces the most refined output |
| **Planning intelligence** | None, Small, Medium (default), Large | The LM that plans lyrics structure and arrangement; larger = slower but often better |
| **VRAM tier** | ≤16GB (default), 24GB, 32GB+ | Controls the maximum allowed batch size |
| **Batch size** | 1–8 (tier-dependent) | How many results to generate in one run |
| **Audio format** | MP3 (default), WAV, FLAC | Format for downloaded files |
| **Seed** | Integer or blank | Leave blank for a random seed; set a value to reproduce a result |
| **Scheduler** | Euler, DPM++, DDIM | Diffusion sampler; Euler is the default |
| **Inference steps** | 10–150 | More steps = slower but more refined; overrides the Quality preset |
| **Guidance scale (lyric)** | 1–15 | Raw control over lyric adherence; overrides the Strictly follow lyrics preset |
| **Guidance scale (audio)** | 1–15 | Raw control over audio style adherence |

### Batch size limits

Certain model combinations require more VRAM and cap the batch size:

| VRAM tier | High Quality / Base + Large LM | All other combinations |
|---|---|---|
| ≤16GB | 1 (locked) | 2 |
| 24GB | 2 | 4 |
| 32GB+ | 4 | 8 |

When the batch size is locked, an inline note explains why.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl / Cmd + Enter** | Trigger Generate from anywhere in the UI |

---

## Tips

- **Section headers in lyrics matter.** `[Verse]`, `[Chorus]`, `[Bridge]` etc. help the model structure the arrangement correctly and enable the Auto Duration estimate.
- **Auto Duration** works best when BPM is set and the lyrics have section headers.
- **Use AI Lyrics** when you want the AI to write them. Describe the song you want and your style panel settings (tags, key, BPM) feed directly into what the LM generates — set those first for better results. Copy the generated lyrics to My Lyrics if you want to edit them.
- **Instrumental mode** is the fastest path to background music or loop generation — no lyrics needed, just set the style and hit Generate.
- **Each tab remembers its last song.** You can have a different result in My Lyrics, AI Lyrics, and Instrumental — switching to Rework auto-loads whichever tab is active.
- **Load music** to rework existing tracks — load a WAV/FLAC/MP3 with its companion JSON to restore all the original settings, then switch to Rework.
- **Fix & Blend on small regions** works better than trying to repaint large portions of a song. For a big change, use Reimagine instead.
- **Save button (⬇)** on every player bar lets you quickly download audio at any point — useful in Rework for comparing versions.
- **Seed** is your best friend for reproducibility. Once you have a result you like, note the seed from the downloaded JSON before running variations.
