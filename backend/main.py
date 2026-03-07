"""
ACE-Step Wrangler — FastAPI backend.

Endpoints:
  POST /generate                    Submit a generation job, return task_id
  GET  /status/{task_id}            Poll job status; stores result on completion
  GET  /audio                       Proxy audio stream from AceStep (no download header)
  GET  /download/{job_id}/{n}/audio Download audio with Content-Disposition
  GET  /download/{job_id}/{n}/json  Download generation metadata as JSON
  GET  /api/health                  Forward AceStep health check

  POST /lora/load                   Load a LoRA/LoKR adapter
  POST /lora/unload                 Unload adapter, restore base model
  POST /lora/toggle                 Enable/disable loaded adapter
  POST /lora/scale                  Set adapter influence (0.0–1.0)
  GET  /lora/status                 Current adapter state
  GET  /lora/browse                 List adapters in loras/ directory

  POST /train/upload                Upload audio files for training
  POST /train/scan                  Scan + load audio into AceStep dataset
  POST /train/preprocess            Start async preprocessing
  GET  /train/preprocess/status     Poll preprocessing progress
  GET  /train/samples               List loaded dataset samples
  POST /train/start                 Start LoRA/LoKR training
  GET  /train/status                Poll training progress
  POST /train/stop                  Stop current training
  POST /train/export                Export adapter to loras/ directory
  POST /train/reinitialize          Reload model after training

Static frontend is served from /  (catch-all, mounted last).
"""

import json
import re
import shutil
import tempfile
import uuid
import mimetypes
import uvicorn
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse, parse_qs

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import asyncio

from acestep_wrapper import (
    health_check,
    release_task,
    query_result,
    get_audio_bytes,
    format_input,
    create_sample,
    lora_load,
    lora_unload,
    lora_toggle,
    lora_scale,
    lora_status,
    dataset_scan,
    dataset_auto_label,
    dataset_auto_label_async,
    dataset_auto_label_status,
    dataset_sample_update,
    dataset_save,
    dataset_load,
    dataset_preprocess_async,
    dataset_preprocess_status,
    dataset_samples,
    training_start,
    training_start_lokr,
    training_status,
    training_stop,
    training_export,
    reinitialize_service,
    _LANG_LABELS,
)

app = FastAPI(title="ACE-Step Wrangler")

# ---------------------------------------------------------------------------
# In-process job store (cleared on restart — acceptable for now)
# ---------------------------------------------------------------------------

# task_id → { "results": [...], "params": dict, "format": str }
_jobs: dict[str, dict] = {}

# task_id → { "params": dict, "format": str }  (pending, before results arrive)
_pending: dict[str, dict] = {}

# upload_id → { "path": str, "filename": str }
_uploads: dict[str, dict] = {}
_upload_dir = Path(tempfile.mkdtemp(prefix="wrangler-uploads-"))

# ---------------------------------------------------------------------------
# Parameter mapping tables
# ---------------------------------------------------------------------------

_LYRIC_ADHERENCE = [3.0, 7.0, 12.0]   # Loose, Med, Strict  → guidance_scale
_QUALITY_STEPS   = [15,  60,  120]    # Raw, Balanced, Polished → inference_steps

_GEN_MODEL = {
    "turbo": "acestep-v15-turbo",
    "sft":   "acestep-v15-sft",
    "base":  "acestep-v15-base",
}

_SCHEDULER = {
    "euler": "ode",
    "dpm":   "dpm",
    "ddim":  "ddim",
}

# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    # Main UI — friendly params
    style:            str   = ""
    lyrics:           str   = ""
    duration:         float = 30.0
    lyric_adherence:  int   = 1      # 0=Loose  1=Med  2=Strict
    creativity:       float = 50.0   # 0–100
    quality:          int   = 1      # 0=Raw  1=Balanced  2=Polished

    # Advanced panel
    seed:         Optional[int] = None
    gen_model:    str           = "turbo"
    batch_size:   int           = 1
    scheduler:    str           = "euler"
    audio_format: str           = "mp3"   # mp3 | wav | flac

    # Song parameters (from style panel)
    key:            str          = ""     # e.g. "C major" — appended to AceStep prompt
    bpm:            Optional[int] = None
    time_signature: str          = "4/4"

    # Raw advanced overrides (from advanced panel sliders — win over friendly presets)
    guidance_scale_raw:   Optional[float] = None
    audio_guidance_scale: Optional[float] = None
    inference_steps_raw:  Optional[int]   = None

    # AI lyrics generation (sample_query mode — LM writes lyrics from style description)
    sample_query:   Optional[str] = None
    vocal_language: str           = "en"

    # Rework mode
    task_type:             str             = "text2music"  # text2music | cover | repaint | extract | lego | complete
    src_audio_path:        Optional[str]   = None
    audio_cover_strength:  Optional[float] = None          # 0.0–1.0 for cover
    repainting_start:      Optional[float] = None          # seconds, for repaint
    repainting_end:        Optional[float] = None          # seconds, for repaint

    # Analyze mode (extract / lego / complete)
    track_name:    Optional[str]       = None   # single track for extract/lego
    track_classes: Optional[List[str]] = None   # multiple tracks for complete

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_payload(req: GenerateRequest) -> dict:
    lyric_adherence = max(0, min(2, req.lyric_adherence))
    quality         = max(0, min(2, req.quality))
    creativity      = max(0.0, min(100.0, req.creativity))

    # Creativity → shift (inverse): restrained (0%) = 5.0, wild (100%) = 1.0
    shift = round(5.0 - (creativity / 100.0) * 4.0, 2)

    # Build AceStep prompt: style + optional song parameter suffix
    song_parts = []
    if req.key:
        song_parts.append(req.key)
    if req.bpm:
        song_parts.append(f"{req.bpm} BPM")
    if song_parts:
        song_parts.append(f"{req.time_signature} time")
        suffix = ", ".join(song_parts)
        prompt = f"{req.style}, {suffix}" if req.style else suffix
    else:
        prompt = req.style

    # Raw advanced values override the friendly preset mappings when provided
    guidance_scale   = req.guidance_scale_raw  if req.guidance_scale_raw  is not None \
                       else _LYRIC_ADHERENCE[lyric_adherence]
    inference_steps  = req.inference_steps_raw if req.inference_steps_raw is not None \
                       else _QUALITY_STEPS[quality]

    payload = {
        "prompt":          prompt,
        "lyrics":          req.lyrics,
        "audio_duration":  req.duration,
        "guidance_scale":  guidance_scale,
        "shift":           shift,
        "inference_steps": inference_steps,
        "batch_size":      max(1, req.batch_size),
        "use_random_seed": req.seed is None,
        "seed":            req.seed if req.seed is not None else -1,
        "infer_method":    _SCHEDULER.get(req.scheduler, "ode"),
        "audio_format":    req.audio_format,
    }

    if req.audio_guidance_scale is not None:
        payload["audio_guidance_scale"] = req.audio_guidance_scale

    if req.sample_query:
        # AceStep ignores vocal_language="en" in sample_query mode — embed the
        # language label in the query text so _parse_description_hints() picks it up.
        label = _LANG_LABELS.get(req.vocal_language, "")
        enriched = f"{req.sample_query}. {label} vocals." if label else req.sample_query
        payload["sample_query"]   = enriched
        payload["vocal_language"] = req.vocal_language

    model_name = _GEN_MODEL.get(req.gen_model)
    if model_name:
        payload["model"] = model_name

    # Rework / Analyze params
    if req.task_type in ("cover", "repaint", "extract", "lego", "complete"):
        payload["task_type"] = req.task_type
        if req.src_audio_path:
            payload["src_audio_path"] = req.src_audio_path
        if req.task_type == "cover" and req.audio_cover_strength is not None:
            payload["audio_cover_strength"] = req.audio_cover_strength
        if req.task_type == "repaint":
            if req.repainting_start is not None:
                payload["repainting_start"] = req.repainting_start
            if req.repainting_end is not None:
                payload["repainting_end"] = req.repainting_end
        if req.track_name:
            payload["track_name"] = req.track_name
        if req.track_classes:
            payload["track_classes"] = req.track_classes

    return payload

# ---------------------------------------------------------------------------
# Duration estimation — heuristic fallback
# ---------------------------------------------------------------------------

# Default bar counts per common section header keyword
_SECTION_BARS: dict[str, int] = {
    "intro":        8,
    "verse":       16,
    "pre-chorus":   8,
    "prechorus":    8,
    "pre chorus":   8,
    "chorus":       8,
    "hook":         8,
    "bridge":       8,
    "outro":        8,
    "instrumental": 8,
    "break":        8,
    "interlude":    8,
    "refrain":      8,
    "drop":         8,
    "build":        8,
    "solo":         8,
}

_SECTION_RE = re.compile(r"^\[([^\]]+)\]", re.MULTILINE | re.IGNORECASE)


def _heuristic_seconds(lyrics: str, bpm: int, time_signature: str) -> float:
    """Estimate song duration from section headers, bar counts, BPM, and time sig."""
    headers = _SECTION_RE.findall(lyrics)

    try:
        num = int(time_signature.split("/")[0])
    except (ValueError, IndexError):
        num = 4

    def _lookup_bars(header: str) -> int:
        h = header.strip().lower()
        if h in _SECTION_BARS:
            return _SECTION_BARS[h]
        # "Verse 1", "Pre-Chorus 2", etc. — match by prefix/containment
        for key, bars in _SECTION_BARS.items():
            if h.startswith(key) or key in h:
                return bars
        return 8  # unknown section: default 8 bars

    if not headers:
        # No section markers — assume generic 2-verse / 2-chorus structure
        total_bars = 16 * 2 + 8 * 2
    else:
        total_bars = sum(_lookup_bars(h) for h in headers)

    seconds = total_bars * num / bpm * 60
    seconds = round(seconds / 5) * 5          # snap to nearest 5 s
    return max(10.0, min(600.0, seconds))


def _estimate_sections(
    lyrics: str, duration: float, bpm: int, time_signature: str
) -> list[dict]:
    """Estimate section boundaries from lyrics structure, scaled to actual duration."""
    headers = _SECTION_RE.findall(lyrics)
    if not headers:
        return []

    try:
        num = int(time_signature.split("/")[0])
    except (ValueError, IndexError):
        num = 4

    def _lookup_bars(header: str) -> int:
        h = header.strip().lower()
        if h in _SECTION_BARS:
            return _SECTION_BARS[h]
        for key, bars in _SECTION_BARS.items():
            if h.startswith(key) or key in h:
                return bars
        return 8

    sections = []
    for header in headers:
        bars = _lookup_bars(header)
        raw_secs = bars * num / bpm * 60
        sections.append({"name": header.strip(), "bars": bars, "raw_secs": raw_secs})

    # Scale proportionally to fit actual duration
    total_raw = sum(s["raw_secs"] for s in sections)
    if total_raw <= 0:
        return []

    scale = duration / total_raw
    cursor = 0.0
    result = []
    for s in sections:
        scaled = s["raw_secs"] * scale
        result.append({
            "name": s["name"],
            "start": round(cursor, 2),
            "end": round(cursor + scaled, 2),
            "bars": s["bars"],
        })
        cursor += scaled

    return result


class EstimateSectionsRequest(BaseModel):
    lyrics:         str           = ""
    duration:       float         = 30.0
    bpm:            Optional[int] = None
    time_signature: str           = "4/4"


class EstimateDurationRequest(BaseModel):
    lyrics:         str          = ""
    bpm:            Optional[int] = None
    time_signature: str          = "4/4"
    lm_model:       str          = "1.7b"


# ---------------------------------------------------------------------------
# API routes  (must come before the static-files catch-all)
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def api_health():
    try:
        return await health_check()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


def _resolve_audio_path(path: str) -> str:
    """Extract the real filesystem path from an AceStep audio path or URL.

    AceStep sometimes returns audio paths in URL format:
      /v1/audio?path=%2Fdata%2Fprojects%2F...mp3
    We need the raw filesystem path for file operations.
    """
    if "?" in path:
        qs = parse_qs(urlparse(path).query)
        if "path" in qs:
            return qs["path"][0]
    return path


# Directories from which the /audio endpoint is permitted to serve files.
# Audio originates from two places: the system temp dir (AceStep output,
# user uploads) and the vendor tree (AceStep's own .cache directory).
_VENDOR_DIR = (Path(__file__).parent.parent / "vendor").resolve()
_ALLOWED_AUDIO_DIRS = [
    Path(tempfile.gettempdir()).resolve(),
    _VENDOR_DIR,
]


def _is_safe_audio_path(path: str) -> bool:
    """Return True only if path resolves inside an allowed audio directory."""
    try:
        real = Path(_resolve_audio_path(path)).resolve()
    except Exception:
        return False
    return any(real == d or d in real.parents for d in _ALLOWED_AUDIO_DIRS)


def _ensure_in_tmp(path: str) -> str:
    """Copy a file to the system temp dir if it isn't already there.

    AceStep's /release_task rejects absolute src_audio_path values that lie
    outside tempfile.gettempdir() (typically /tmp) as a path-traversal guard.
    Generated audio files live in the project's .cache directory, so we copy
    them to /tmp before forwarding the path.
    """
    import os
    path = _resolve_audio_path(path)
    system_temp = os.path.realpath(tempfile.gettempdir())
    real = os.path.realpath(path)
    try:
        in_temp = os.path.commonpath([system_temp, real]) == system_temp
    except ValueError:
        in_temp = False
    if in_temp:
        return path
    suffix = Path(path).suffix or ".mp3"
    fd, tmp_path = tempfile.mkstemp(prefix="wrangler_src_", suffix=suffix)
    os.close(fd)
    shutil.copy2(real, tmp_path)
    return tmp_path


@app.post("/generate")
async def generate(req: GenerateRequest):
    # AceStep rejects absolute src_audio_path values outside /tmp — copy if needed
    if req.src_audio_path:
        safe_path = _ensure_in_tmp(req.src_audio_path)
        if safe_path != req.src_audio_path:
            req = req.model_copy(update={"src_audio_path": safe_path})
    payload = _build_payload(req)
    try:
        task_id = await release_task(payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")

    _pending[task_id] = {
        "params": req.model_dump(),
        "format": req.audio_format,
    }
    return {"task_id": task_id}


class GenerateLyricsRequest(BaseModel):
    description: str
    vocal_language: str = "en"


@app.post("/generate-lyrics")
async def generate_lyrics(req: GenerateLyricsRequest):
    """Generate structured lyrics from a natural language description.

    Uses AceStep's sample_query mode: the LM generates lyrics + metadata,
    then AceStep proceeds to audio generation. We poll until complete and
    extract the lyrics/metadata from the result. The generated audio is
    available as a bonus but not returned here.
    """
    if not req.description.strip():
        raise HTTPException(status_code=422, detail="Description cannot be empty")

    try:
        task_id = await create_sample(req.description, req.vocal_language)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")

    # Server-side polling — includes full audio generation, so allow longer
    for _ in range(300):  # 300 × 2s = 10 min timeout
        await asyncio.sleep(2)
        try:
            data = await query_result(task_id)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"AceStep poll error: {exc}")

        if data["status"] == "done":
            results = data.get("results") or []
            if not results:
                raise HTTPException(status_code=502, detail="No results returned")
            result = results[0]
            meta = result.get("meta") or {}

            # Extract audio paths for preview & rework
            raw_audio_url = result.get("audio_url", "")
            audio_path = ""
            if raw_audio_url:
                parsed = parse_qs(urlparse(raw_audio_url).query)
                audio_path = parsed.get("path", [""])[0]

            return {
                "caption": result.get("prompt", ""),
                "lyrics": result.get("lyrics", ""),
                "bpm": meta.get("bpm"),
                "key_scale": meta.get("keyscale", ""),
                "time_signature": meta.get("timesignature", "4/4"),
                "duration": meta.get("duration"),
                "audio_url": raw_audio_url,
                "audio_path": audio_path,
            }
        elif data["status"] == "error":
            raise HTTPException(status_code=502, detail="Lyrics generation failed")

    raise HTTPException(status_code=504, detail="Lyrics generation timed out")


@app.get("/status/{task_id}")
async def status(task_id: str):
    try:
        data = await query_result(task_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")

    if data["status"] == "done" and task_id not in _jobs:
        pending = _pending.pop(task_id, {})
        _jobs[task_id] = {
            "results": data["results"],
            "params":  pending.get("params", {}),
            "format":  pending.get("format", "mp3"),
        }

    return data


@app.get("/audio")
async def audio_proxy(path: str):
    """Serve audio for <audio> elements. Uses FileResponse for local files (Range support)."""
    if not _is_safe_audio_path(path):
        raise HTTPException(status_code=403, detail="Access denied")
    resolved = _resolve_audio_path(path)
    fp = Path(resolved)
    if fp.is_file():
        ct = mimetypes.guess_type(str(fp))[0] or "audio/mpeg"
        return FileResponse(str(fp), media_type=ct)
    # Fallback: proxy from AceStep server
    try:
        data, content_type = await get_audio_bytes(path)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Audio fetch error: {exc}")
    return Response(content=data, media_type=content_type)


@app.post("/estimate-duration")
async def estimate_duration(req: EstimateDurationRequest):
    """
    Estimate audio duration from lyrics, BPM, and time signature.

    Primary path: call AceStep's /format_input LM endpoint (if lm_model != "none").
    Fallback: regex-based section-header heuristic.
    """
    bpm = req.bpm if req.bpm else 120

    # Primary: LM-assisted estimation
    if req.lm_model != "none" and req.lyrics.strip():
        try:
            result = await format_input(req.lyrics)
            # Navigate into nested response — AceStep wraps results in "data"
            body = result if isinstance(result, dict) else {}
            for key in ("data", "result"):
                if isinstance(body.get(key), dict):
                    body = body[key]
                    break
            if "duration" in body:
                secs = float(body["duration"])
                secs = round(secs / 5) * 5
                secs = max(10.0, min(600.0, secs))
                return {"seconds": secs, "method": "lm"}
        except Exception:
            pass  # fall through to heuristic

    # Fallback: heuristic
    secs = _heuristic_seconds(req.lyrics, bpm, req.time_signature)
    resp: dict = {"seconds": secs, "method": "heuristic"}
    if not req.bpm:
        resp["assumed_bpm"] = 120
    return resp


@app.post("/estimate-sections")
async def estimate_sections(req: EstimateSectionsRequest):
    """Estimate section boundaries from lyrics structure, scaled to actual duration."""
    bpm = req.bpm if req.bpm else 120
    sections = _estimate_sections(req.lyrics, req.duration, bpm, req.time_signature)
    return {"sections": sections}


@app.get("/download/{job_id}/{index}/audio")
async def download_audio(job_id: str, index: int):
    job = _jobs.get(job_id)
    if not job or index >= len(job["results"]):
        raise HTTPException(status_code=404, detail="Result not found")

    audio_url = job["results"][index]["audio_url"]
    try:
        data, content_type = await get_audio_bytes(audio_url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Audio fetch error: {exc}")

    fmt      = job["format"]
    filename = f"acestep-{job_id[:8]}-{index + 1}.{fmt}"
    return Response(
        content=data,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/download/{job_id}/{index}/json")
async def download_json(job_id: str, index: int):
    job = _jobs.get(job_id)
    if not job or index >= len(job["results"]):
        raise HTTPException(status_code=404, detail="Result not found")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "params":        job["params"],
        "meta":          job["results"][index].get("meta"),
    }
    filename = f"acestep-{job_id[:8]}-{index + 1}.json"
    return Response(
        content=json.dumps(payload, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/upload-audio")
async def upload_audio(file: UploadFile):
    """Accept an audio file upload, save to temp dir, return server-side path."""
    if not file.content_type or not file.content_type.startswith("audio/"):
        raise HTTPException(status_code=422, detail="Only audio files are supported")

    upload_id = uuid.uuid4().hex[:12]
    suffix = Path(file.filename or "audio").suffix or ".wav"
    dest = _upload_dir / f"{upload_id}{suffix}"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    _uploads[upload_id] = {"path": str(dest), "filename": file.filename or "audio"}
    return {"upload_id": upload_id, "path": str(dest), "filename": file.filename}


# ---------------------------------------------------------------------------
# LoRA adapter management
# ---------------------------------------------------------------------------

import os

_LORA_DIR = Path(os.environ.get("LORA_DIR", str(Path(__file__).parent.parent / "loras")))


class LoRALoadRequest(BaseModel):
    lora_path: str
    adapter_name: Optional[str] = None


class LoRAToggleRequest(BaseModel):
    use_lora: bool


class LoRAScaleRequest(BaseModel):
    scale: float
    adapter_name: Optional[str] = None


@app.post("/lora/load")
async def lora_load_route(req: LoRALoadRequest):
    try:
        result = await lora_load(req.lora_path, req.adapter_name)
        return result
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text if exc.response else str(exc)
        raise HTTPException(status_code=exc.response.status_code, detail=detail)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/lora/unload")
async def lora_unload_route():
    try:
        result = await lora_unload()
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/lora/toggle")
async def lora_toggle_route(req: LoRAToggleRequest):
    try:
        result = await lora_toggle(req.use_lora)
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/lora/scale")
async def lora_scale_route(req: LoRAScaleRequest):
    try:
        result = await lora_scale(req.scale, req.adapter_name)
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.get("/lora/status")
async def lora_status_route():
    try:
        result = await lora_status()
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.get("/lora/browse")
async def lora_browse():
    """List available LoRA/LoKR adapters in the configured loras directory."""
    adapters = []
    if not _LORA_DIR.is_dir():
        return {"adapters": adapters, "lora_dir": str(_LORA_DIR)}

    for entry in sorted(_LORA_DIR.iterdir()):
        # PEFT LoRA: directory with adapter_config.json
        if entry.is_dir() and (entry / "adapter_config.json").exists():
            size_bytes = sum(f.stat().st_size for f in entry.rglob("*") if f.is_file())
            adapters.append({
                "name": entry.name,
                "path": str(entry),
                "type": "lora",
                "size_mb": round(size_bytes / 1_048_576, 1),
            })
        # LoKR: single .safetensors file
        elif entry.is_file() and entry.suffix == ".safetensors":
            adapters.append({
                "name": entry.stem,
                "path": str(entry),
                "type": "lokr",
                "size_mb": round(entry.stat().st_size / 1_048_576, 1),
            })

    return {"adapters": adapters, "lora_dir": str(_LORA_DIR)}


# ---------------------------------------------------------------------------
# Training pipeline
# ---------------------------------------------------------------------------

_TRAIN_DIR = Path(os.environ.get("TRAIN_DIR", str(Path(__file__).parent.parent / "training")))
_TRAIN_AUDIO_DIR = _TRAIN_DIR / "audio"
_TRAIN_TENSOR_DIR = _TRAIN_DIR / "tensors"
_TRAIN_OUTPUT_DIR = _TRAIN_DIR / "output"


class TrainStartRequest(BaseModel):
    tensor_dir: str = ""
    adapter_type: str = "lora"  # lora | lokr
    lora_rank: int = 64
    lora_alpha: int = 128
    lora_dropout: float = 0.1
    learning_rate: float = 1e-4
    train_epochs: int = 10
    train_batch_size: int = 1
    gradient_accumulation: int = 4
    save_every_n_epochs: int = 5
    training_seed: int = 42
    output_dir: str = ""
    gradient_checkpointing: bool = True


class TrainExportRequest(BaseModel):
    name: str
    output_dir: str = ""


@app.post("/train/upload")
async def train_upload(files: List[UploadFile]):
    """Accept multiple audio files for training dataset."""
    _TRAIN_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    saved = []
    skipped = 0
    for file in files:
        if not file.content_type or not file.content_type.startswith("audio/"):
            continue
        fname = file.filename or "audio.wav"
        safe_name = Path(fname).name
        dest = _TRAIN_AUDIO_DIR / safe_name
        if dest.exists():
            skipped += 1
            continue
        with open(dest, "wb") as f:
            shutil.copyfileobj(file.file, f)
        saved.append({"filename": safe_name, "path": str(dest)})
    return {"uploaded": len(saved), "skipped": skipped, "files": saved, "audio_dir": str(_TRAIN_AUDIO_DIR)}


@app.post("/train/clear")
async def train_clear():
    """Delete all uploaded audio and preprocessed tensor files."""
    removed = {"audio": 0, "tensors": 0}
    for d, key in [(_TRAIN_AUDIO_DIR, "audio"), (_TRAIN_TENSOR_DIR, "tensors")]:
        if d.is_dir():
            for f in d.iterdir():
                if f.is_file():
                    f.unlink()
                    removed[key] += 1
    return {"removed": removed}


@app.get("/train/pipeline-state")
async def train_pipeline_state():
    """Report what training data exists on disk (survives restarts)."""
    audio_files = sorted(
        f.name for f in _TRAIN_AUDIO_DIR.iterdir()
        if f.is_file() and f.suffix.lower() in ('.wav', '.mp3', '.flac', '.ogg', '.m4a')
    ) if _TRAIN_AUDIO_DIR.is_dir() else []
    tensor_count = sum(
        1 for f in _TRAIN_TENSOR_DIR.iterdir() if f.suffix == '.pt'
    ) if _TRAIN_TENSOR_DIR.is_dir() else 0
    has_saved_dataset = (_TRAIN_DIR / "dataset.json").exists()
    return {
        "audio_count": len(audio_files),
        "audio_files": audio_files,
        "tensor_count": tensor_count,
        "has_audio": len(audio_files) > 0,
        "has_tensors": tensor_count > 0,
        "has_saved_dataset": has_saved_dataset,
    }


class TrainScanRequest(BaseModel):
    stems_mode: bool = False


@app.post("/train/scan")
async def train_scan(req: TrainScanRequest = TrainScanRequest()):
    """Scan the training audio directory and load files into AceStep's dataset."""
    audio_dir = str(_TRAIN_AUDIO_DIR)
    if not _TRAIN_AUDIO_DIR.is_dir():
        raise HTTPException(status_code=400, detail="No audio files uploaded yet")
    try:
        payload = {"audio_dir": audio_dir}
        if req.stems_mode:
            payload["custom_tag"] = "a cappella vocal stem, no instruments"
            payload["tag_position"] = "append"
            payload["all_instrumental"] = False
        scan_result = await dataset_scan(payload)
        return {"scan": scan_result}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


class TrainLabelRequest(BaseModel):
    lm_model_path: Optional[str] = None
    stems_mode: bool = False


_STEMS_INSTRUCTION_HINT = (
    "CRITICAL CONTEXT: This audio is a solo vocal stem extracted from a mix. "
    "It contains ONLY a human voice — zero instruments, zero accompaniment. "
    "Any harmonic content you detect is vocal resonance, overtones, or room tone, NOT instruments. "
    "Your caption MUST describe: vocal type (male/female/choir), singing style, "
    "vocal tone and timbre, emotional delivery, and vocal technique. "
    "NEVER mention piano, guitar, drums, bass, strings, synth, or any instrument. "
    "Example: 'A warm female vocal with breathy delivery and intimate phrasing, "
    "conveying melancholy through subtle vibrato and restrained dynamics.'"
)


@app.post("/train/label")
async def train_label(req: TrainLabelRequest = TrainLabelRequest()):
    """Start async auto-labeling of dataset samples."""
    payload = {"only_unlabeled": True}
    if req.lm_model_path:
        payload["lm_model_path"] = req.lm_model_path
    if req.stems_mode:
        payload["instruction_hint"] = _STEMS_INSTRUCTION_HINT
    try:
        result = await dataset_auto_label_async(payload)
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.get("/train/label/status")
async def train_label_status():
    """Poll auto-label progress."""
    try:
        result = await dataset_auto_label_status()
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


class SampleUpdateRequest(BaseModel):
    caption: str = ""
    genre: str = ""
    lyrics: str = "[Instrumental]"
    bpm: Optional[int] = None
    keyscale: str = ""
    timesignature: str = ""
    language: str = "unknown"
    is_instrumental: bool = True


@app.put("/train/sample/{sample_idx}")
async def train_sample_update(sample_idx: int, req: SampleUpdateRequest):
    """Update a single sample's metadata (caption, genre, lyrics, etc.)."""
    try:
        result = await dataset_sample_update(sample_idx, {
            "sample_idx": sample_idx,
            "caption": req.caption,
            "genre": req.genre,
            "lyrics": req.lyrics,
            "bpm": req.bpm,
            "keyscale": req.keyscale,
            "timesignature": req.timesignature,
            "language": req.language,
            "is_instrumental": req.is_instrumental,
            "labeled": True,
        })
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


_TRAIN_DATASET_FILE = _TRAIN_DIR / "dataset.json"


@app.post("/train/save")
async def train_save():
    """Save current dataset state to disk for later resumption."""
    _TRAIN_DIR.mkdir(parents=True, exist_ok=True)
    try:
        result = await dataset_save(str(_TRAIN_DATASET_FILE))
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/train/load")
async def train_load():
    """Load a previously saved dataset from disk."""
    if not _TRAIN_DATASET_FILE.exists():
        raise HTTPException(status_code=404, detail="No saved dataset found")
    try:
        result = await dataset_load(str(_TRAIN_DATASET_FILE))
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/train/preprocess")
async def train_preprocess():
    """Start async preprocessing of the loaded dataset."""
    _TRAIN_TENSOR_DIR.mkdir(parents=True, exist_ok=True)
    try:
        result = await dataset_preprocess_async(str(_TRAIN_TENSOR_DIR))
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.get("/train/preprocess/status")
async def train_preprocess_status(task_id: Optional[str] = None):
    """Poll preprocessing progress."""
    try:
        result = await dataset_preprocess_status(task_id)
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.get("/train/samples")
async def train_samples():
    """List loaded dataset samples."""
    try:
        result = await dataset_samples()
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/train/start")
async def train_start(req: TrainStartRequest):
    """Start LoRA/LoKR training from preprocessed tensors."""
    tensor_dir = req.tensor_dir or str(_TRAIN_TENSOR_DIR)
    output_dir = req.output_dir or str(_TRAIN_OUTPUT_DIR)
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    try:
        if req.adapter_type == "lokr":
            payload = {
                "tensor_dir": tensor_dir,
                "lokr_linear_dim": req.lora_rank,
                "lokr_linear_alpha": req.lora_alpha,
                "learning_rate": req.learning_rate,
                "train_epochs": req.train_epochs,
                "train_batch_size": req.train_batch_size,
                "gradient_accumulation": req.gradient_accumulation,
                "save_every_n_epochs": req.save_every_n_epochs,
                "training_seed": req.training_seed,
                "output_dir": output_dir,
                "gradient_checkpointing": req.gradient_checkpointing,
            }
            result = await training_start_lokr(payload)
        else:
            payload = {
                "tensor_dir": tensor_dir,
                "lora_rank": req.lora_rank,
                "lora_alpha": req.lora_alpha,
                "lora_dropout": req.lora_dropout,
                "learning_rate": req.learning_rate,
                "train_epochs": req.train_epochs,
                "train_batch_size": req.train_batch_size,
                "gradient_accumulation": req.gradient_accumulation,
                "save_every_n_epochs": req.save_every_n_epochs,
                "training_seed": req.training_seed,
                "lora_output_dir": output_dir,
                "gradient_checkpointing": req.gradient_checkpointing,
            }
            result = await training_start(payload)
        return result
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text if exc.response else str(exc)
        raise HTTPException(status_code=exc.response.status_code, detail=detail)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.get("/train/status")
async def train_status():
    """Get current training status."""
    try:
        result = await training_status()
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/train/stop")
async def train_stop():
    """Stop the current training run."""
    try:
        result = await training_stop()
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/train/export")
async def train_export(req: TrainExportRequest):
    """Export trained adapter to the loras directory for immediate use."""
    output_dir = req.output_dir or str(_TRAIN_OUTPUT_DIR)
    safe_name = re.sub(r'[^\w\-.]', '_', req.name.strip()) or "trained_adapter"
    export_path = str(_LORA_DIR / safe_name)
    try:
        result = await training_export(export_path, output_dir)
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/train/reinitialize")
async def train_reinitialize():
    """Reinitialize model components after training completes."""
    try:
        result = await reinitialize_service()
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


# ---------------------------------------------------------------------------
# Static frontend — mounted last so API routes take priority
# ---------------------------------------------------------------------------

_frontend = Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="frontend")

# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=7860, reload=True)
