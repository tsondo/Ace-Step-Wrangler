# ACE-Step-Wrangler v2 — Design Spec & Build Plan

## Summary

This spec adds three major features to ACE-Step-Wrangler:

1. **Task Mode Selector** — A top-level mode switcher (Create / Rework) that reconfigures the UI panels contextually
2. **Lyrics Generation Tab** — A second tab in the Lyrics panel that generates lyrics from a natural language description via ACE-Step's Simple Mode LM endpoint
3. **Rework Mode** — A unified workflow for Cover and Repaint operations with audio input, region selection, and clear labeling of the two approaches

These features build on the existing three-column layout without breaking it. The spatial layout stays the same across all modes — only the panel *contents* change.

---

## 1. Task Mode Selector

### UI Location

A segmented control in the header bar, to the right of the logo:

```
♪ ACE-Step Wrangler    [ Create ]  [ Rework ]                    ⚙
```

- **Create** (default) — Current behavior. Style + Lyrics + Controls → generate new audio from scratch.
- **Rework** — Load existing audio, optionally select a region, choose an approach (Reimagine or Fix & Blend), and generate.

### Behavior

Switching modes reconfigures the three-column layout:

| Column | Create Mode | Rework Mode |
|--------|-------------|-------------|
| Left | Style panel (tags, song params, custom text) | Audio Input panel (file picker, waveform, region selector) |
| Center | Lyrics panel (Write / Generate tabs) | Lyrics panel (Write / Generate tabs) — same component |
| Right | Controls panel (sliders, Generate button, Advanced) | Controls panel (adapted — see below) |

The center column (Lyrics) is shared across both modes. The left and right columns swap their contents.

When switching modes:
- Panel state is preserved (switching back to Create restores your tags/text)
- The Generate button label doesn't change — it's always "▶ Generate"
- The Output panel at the bottom is shared

---

## 2. Lyrics Panel — Two Tabs

### Tab Structure

The Lyrics panel header gains two tabs:

```
LYRICS    [ Write ✏ ]  [ Generate ✨ ]
                                        [Load file]  [Clear]
```

**Write tab** (default) — Current behavior. Textarea for typing/pasting lyrics, file load, drag-and-drop, line/char count, duration warning.

**Generate tab** — A text area for a natural language description, plus a Generate Lyrics button. On success, the generated lyrics populate the Write tab and the UI switches to it so the user can review/edit before generating audio.

### Generate Tab Layout

```
┌─────────────────────────────────────┐
│  Describe what you want             │
│  ┌─────────────────────────────────┐│
│  │ Placeholder: "An upbeat pop     ││
│  │ song about summer road trips    ││
│  │ with a nostalgic chorus..."     ││
│  │                                 ││
│  └─────────────────────────────────┘│
│                                     │
│  ☐ Instrumental (no vocals)         │
│                                     │
│  [ ✨ Generate Lyrics ]             │
│                                     │
│  Status: idle / generating / done   │
│                                     │
│  When lyrics are generated:         │
│  ┌─────────────────────────────────┐│
│  │ Preview of generated lyrics     ││
│  │ (read-only)                     ││
│  └─────────────────────────────────┘│
│  [ Use These Lyrics → ]            │
│                                     │
│  Generated metadata shown below:    │
│  BPM: 120 · Key: C major · 4/4     │
│  [ Apply metadata too ]            │
└─────────────────────────────────────┘
```

### Generate Lyrics Flow

1. User types a description and clicks "Generate Lyrics"
2. Frontend calls `POST /generate-lyrics` (new backend endpoint)
3. Backend calls AceStep's Simple Mode / Inspiration Mode LM endpoint
4. Backend parses the structured response, extracts lyrics, caption, and metadata (BPM, key, duration, time signature)
5. Frontend shows a read-only preview of the generated lyrics
6. User clicks "Use These Lyrics →" — lyrics are copied to the Write tab, tab switches
7. Optionally, user clicks "Apply metadata too" — BPM, key, time signature, and duration are populated into the Style panel and Controls panel

### Backend Endpoint

```
POST /generate-lyrics

Request:
{
  "description": "An upbeat pop song about summer road trips",
  "instrumental": false
}

Response:
{
  "lyrics": "[Verse 1]\nDriving down the coast...\n\n[Chorus]\n...",
  "caption": "upbeat pop, bright guitars, warm synths, female vocal...",
  "metadata": {
    "bpm": 120,
    "key": "C major",
    "time_signature": "4/4",
    "duration": 180
  }
}
```

The backend calls AceStep's `/format_input` or the appropriate LM Simple Mode endpoint, parses the YAML-structured response, and returns clean JSON. If the LM is not initialized (model set to "none"), return a 400 error with a clear message ("Lyrics generation requires a Planning Intelligence model — select Small, Medium, or Large in Advanced settings").

---

## 3. Rework Mode

### Left Column: Audio Input Panel

Replaces the Style panel when in Rework mode.

```
┌─────────────────────────────┐
│  AUDIO INPUT                │
│                             │
│  ┌─────────────────────────┐│
│  │  Drop audio file here   ││
│  │  or click to browse     ││
│  │                         ││
│  │  Supports: mp3, wav,    ││
│  │  flac, ogg              ││
│  └─────────────────────────┘│
│                             │
│  filename.wav  3:42  ✕      │
│                             │
│  ── Region ──────────────── │
│  Start: [0:00]  End: [3:42] │
│  (or) ☐ Whole song          │
│                             │
│  ── Approach ────────────── │
│                             │
│  ○ Reimagine                │
│    ⓘ tooltip                │
│                             │
│  ○ Fix & Blend              │
│    ⓘ tooltip                │
│                             │
│  ── Style Direction ─────── │
│  ┌─────────────────────────┐│
│  │ "Make it more jazzy     ││
│  │ with brushed drums"     ││
│  └─────────────────────────┘│
│                             │
│  ── Song Parameters ─────── │
│  (same key/BPM/time sig    │
│  controls as Create mode)   │
└─────────────────────────────┘
```

### Approach Selector

Two radio buttons with tooltips (ⓘ icon that shows on hover/tap):

**Reimagine**
- Tooltip: *"Uses the original as a structural guide — melody, chords, timing — but generates completely new audio. Great for style changes, creating covers, or reimagining a section in a different genre."*
- Maps to AceStep `task_type: "cover"`
- Works on whole song or a selected region

**Fix & Blend**
- Tooltip: *"Keeps surrounding audio intact and regenerates only the selected region to match seamlessly. Great for correcting problem spots, fixing vocal glitches, or changing lyrics in one section."*
- Maps to AceStep `task_type: "repaint"`
- Works on whole song or a selected region
- When "Whole song" is selected, show a subtle note: *"Tip: Fix & Blend works best on sections. For whole-song changes, try Reimagine."*

### Region Selection

Simple numeric inputs for start and end time (MM:SS format), plus a "Whole song" checkbox that disables the inputs and defaults to full duration. 

Future enhancement: waveform visualization with draggable region handles. Not in v2 scope.

### Controls Panel Adaptations (Rework Mode)

When in Rework mode, the Controls panel adjusts:

- **Duration slider**: Disabled when "Whole song" is checked (locked to source audio length). When a region is selected, defaults to the region length but can be adjusted.
- **All other sliders** (lyric adherence, creativity, quality): Same behavior as Create mode
- **Generate button**: Same position, same behavior
- **Advanced panel**: Same, but `task_type` is set automatically based on the Approach selector (user doesn't see this field)

### Backend Changes

The existing `POST /generate` endpoint and `GenerateRequest` schema need new fields:

```python
class GenerateRequest(BaseModel):
    # ... existing fields ...

    # Rework mode fields
    task_type:       str = "text2music"  # "text2music" | "cover" | "repaint"
    source_audio:    Optional[str] = None  # path to uploaded source audio
    repaint_start:   Optional[float] = None  # seconds
    repaint_end:     Optional[float] = None  # seconds
```

New endpoint for audio upload:

```
POST /upload-audio
Content-Type: multipart/form-data

Response:
{
  "path": "/tmp/wrangler-uploads/abc123.wav",
  "duration": 222.5,
  "format": "wav"
}
```

The `_build_payload()` function passes `task_type`, source audio path, and repaint region to the AceStep API payload.

---

## 4. Build Plan

### Phase 1: Lyrics Generation Tab

**Scope:** Add the Write/Generate tabs to the Lyrics panel, new backend endpoint, wire up the LM Simple Mode call.

1. Add tab UI to Lyrics panel (HTML/CSS)
2. Implement Generate tab layout (description textarea, instrumental checkbox, generate button, preview area, metadata display)
3. Add `POST /generate-lyrics` backend endpoint
4. Wire AceStep LM Simple Mode call in `acestep_wrapper.py`
5. Frontend: handle generate → preview → "Use These Lyrics" → populate Write tab flow
6. Frontend: "Apply metadata too" button populates Style panel and Controls
7. Error handling: LM not initialized, empty description, timeout

**Dependencies:** Requires AceStep LM to be running (not "none"). The endpoint should check this and return a clear error.

### Phase 2: Task Mode Selector

**Scope:** Header mode switcher, panel swapping logic, state preservation.

1. Add segmented control to header (HTML/CSS)
2. Implement panel swap logic (show/hide left panel contents based on mode)
3. Preserve panel state across mode switches
4. Ensure Lyrics panel (center) and Output panel (bottom) are shared

**Dependencies:** None — this is purely frontend layout/state management.

### Phase 3: Rework Mode — Audio Input

**Scope:** Audio upload, file display, region selection, approach selector with tooltips.

1. Build Audio Input panel (HTML/CSS) — file picker, drag-drop, file info display
2. Add region selection inputs (start/end time, whole song checkbox)
3. Add Approach radio buttons with tooltip text
4. Add Style Direction text field
5. Add `POST /upload-audio` backend endpoint (save to temp dir, return path + duration)
6. Controls panel adaptations (duration lock, etc.)

### Phase 4: Rework Mode — Generation Wiring

**Scope:** Connect Rework UI to AceStep Cover and Repaint task types.

1. Extend `GenerateRequest` with `task_type`, `source_audio`, `repaint_start`, `repaint_end`
2. Update `_build_payload()` to handle cover and repaint payloads
3. Update `acestep_wrapper.py` if AceStep's cover/repaint API differs from text2music
4. Test full round-trip: upload audio → select region → choose approach → generate → playback

### Phase 5: Polish

1. Tooltips — consistent styling, hover/tap behavior, mobile-friendly
2. Mode transition animations (subtle, fast)
3. Keyboard shortcuts: Ctrl+1 for Create, Ctrl+2 for Rework
4. Validation: can't generate in Rework without uploaded audio
5. Warning: region too short, region exceeds audio duration
6. Clear/reset behavior per mode

---

## 5. Design Principles (carried forward)

- **Abstract, don't hide.** The Approach selector (Reimagine / Fix & Blend) abstracts Cover vs Repaint without hiding the capability. Advanced users can see `task_type` in the JSON download.
- **Warn early.** No audio uploaded? Disable Generate. Region invalid? Show inline warning.
- **No jargon in the main UI.** "Reimagine" and "Fix & Blend" instead of "Cover" and "Repaint." The AceStep task_type names appear only in the Advanced panel and download JSON.
- **The mode selector changes what's visible, not where things are.** Three columns, same positions, different contents.
- **Explain at the point of decision.** Tooltips on the Approach selector, not in a docs page the user will never read.

---

## 6. Out of Scope (for now)

- Waveform visualization with draggable region handles (future enhancement for region selection)
- "Sing over accompaniment" / Vocal2BGM (backlogged — different pipeline)
- Extract mode (separate stems from audio) — could be a third top-level mode later
- Lego / Complete modes — exposed in Advanced panel task_type dropdown for power users
- LRC timestamp generation
- LoRA training UI
