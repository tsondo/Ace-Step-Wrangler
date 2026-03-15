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
  GET  /train/snapshots             List saved snapshots
  POST /train/snapshots/save        Save dataset + tensors as named snapshot
  POST /train/snapshots/load        Load a named snapshot into working dir
  DELETE /train/snapshots/{name}    Delete a named snapshot

Static frontend is served from /  (catch-all, mounted last).
"""

import json
import logging
import os
import re
import shutil
import tempfile
import time
import uuid
import mimetypes
import uvicorn
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse, parse_qs

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx

import asyncio

logging.basicConfig(format="%(asctime)s [%(levelname)s] %(message)s", level=logging.INFO)
logger = logging.getLogger("wrangler")

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
# Multi-user configuration (all overridable via env)
# ---------------------------------------------------------------------------

MAX_USERS = int(os.environ.get("MAX_USERS", "0"))                # 0 = unlimited
MAX_JOBS_PER_USER = int(os.environ.get("MAX_JOBS_PER_USER", "2"))
SESSION_TIMEOUT_MIN = int(os.environ.get("SESSION_TIMEOUT_MINUTES", "60"))
JOB_TTL_MIN = int(os.environ.get("JOB_TTL_MINUTES", "120"))
UPLOAD_TTL_MIN = int(os.environ.get("UPLOAD_TTL_MINUTES", "120"))

# ---------------------------------------------------------------------------
# User middleware — inject request.state.user from reverse proxy header
# ---------------------------------------------------------------------------

@app.middleware("http")
async def inject_user(request: Request, call_next):
    user = request.headers.get("x-auth-user", "local")
    request.state.user = user

    now = time.monotonic()
    # Session tracking
    if user not in _sessions:
        # Enforce max users (skip for "local" — single-user/dev mode)
        if user != "local" and MAX_USERS > 0:
            timeout = SESSION_TIMEOUT_MIN * 60
            active = sum(
                1 for s in _sessions.values()
                if now - s["last_seen"] < timeout
            )
            if active >= MAX_USERS:
                from starlette.responses import JSONResponse
                return JSONResponse(
                    status_code=503,
                    content={"detail": "Server is at capacity. Try again later."},
                )
        _sessions[user] = {"first_seen": now, "last_seen": now}
    else:
        _sessions[user]["last_seen"] = now

    response = await call_next(request)
    return response

# ---------------------------------------------------------------------------
# In-process stores (cleared on restart — acceptable for now)
# ---------------------------------------------------------------------------

# task_id → { "results": [...], "params": dict, "format": str, "user": str, "created_at": float }
_jobs: dict[str, dict] = {}

# task_id → { "params": dict, "format": str, "user": str, "created_at": float }
_pending: dict[str, dict] = {}

# upload_id → { "path": str, "filename": str, "user": str, "created_at": float }
_uploads: dict[str, dict] = {}
_upload_dir = Path(tempfile.mkdtemp(prefix="wrangler-uploads-"))

# (task_id, user) — tracks submission order for queue position
_queue_order: list[tuple[str, str]] = []

# user → { "last_seen": float, "first_seen": float }
_sessions: dict[str, dict] = {}

# "lora"|"training" → { "user": str, "acquired_at": float, "action": str }
_resource_locks: dict[str, dict] = {}
_LOCK_TIMEOUT = 300  # auto-release stale locks after 5 min


def _acquire_lock(resource: str, user: str, action: str) -> str | None:
    """Try to acquire a resource lock. Returns error message on conflict, None on success."""
    now = time.monotonic()
    lock = _resource_locks.get(resource)
    if lock:
        # Same user refreshes their own lock
        if lock["user"] == user:
            lock["acquired_at"] = now
            lock["action"] = action
            return None
        # Stale lock — auto-release
        if now - lock["acquired_at"] > _LOCK_TIMEOUT:
            logger.info("lock.expired resource=%s user=%s", resource, lock["user"])
        else:
            return f"Resource is in use by another user."
    _resource_locks[resource] = {"user": user, "acquired_at": now, "action": action}
    return None


def _release_lock(resource: str, user: str) -> None:
    """Release a lock if owned by user (or expired)."""
    lock = _resource_locks.get(resource)
    if not lock:
        return
    if lock["user"] == user or time.monotonic() - lock["acquired_at"] > _LOCK_TIMEOUT:
        del _resource_locks[resource]

# ---------------------------------------------------------------------------
# Parameter mapping tables
# ---------------------------------------------------------------------------

_LYRIC_ADHERENCE = [3.0, 6.0, 10.0]   # Little, Some, Strong → guidance_scale
_QUALITY_STEPS   = [20,  40,  100]    # Raw, Balanced, Polished → inference_steps

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
    cover_noise_strength:  Optional[float] = None          # 0.0–1.0 noise init for cover
    repainting_start:      Optional[float] = None          # seconds, for repaint
    repainting_end:        Optional[float] = None          # seconds, for repaint

    # Conditioning
    reference_audio_path:  Optional[str]   = None          # style/timbre reference (separate from src)
    audio_code_string:     str             = ""            # pre-extracted VQ tokens as structural blueprint
    use_adg:               bool            = False         # angle-based guidance (base/sft only)
    cfg_interval_start:    float           = 0.0           # guidance active from this step fraction
    cfg_interval_end:      float           = 1.0           # guidance active until this step fraction

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

    # Conditioning params
    if req.reference_audio_path:
        payload["reference_audio_path"] = req.reference_audio_path
    if req.audio_code_string:
        payload["audio_code_string"] = req.audio_code_string
        payload["thinking"] = False  # codes bypass LM code generation
    if req.use_adg:
        payload["use_adg"] = True
    if req.cfg_interval_start > 0.0:
        payload["cfg_interval_start"] = req.cfg_interval_start
    if req.cfg_interval_end < 1.0:
        payload["cfg_interval_end"] = req.cfg_interval_end

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
        if req.task_type == "cover" and req.cover_noise_strength is not None:
            payload["cover_noise_strength"] = req.cover_noise_strength
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
async def generate(req: GenerateRequest, request: Request):
    user = request.state.user

    # Per-user rate limit (skip for "local" user)
    if user != "local":
        user_pending = sum(1 for p in _pending.values() if p.get("user") == user)
        if user_pending >= MAX_JOBS_PER_USER:
            raise HTTPException(
                status_code=429,
                detail=f"You already have {user_pending} jobs in progress. Wait for one to finish.",
            )

    # AceStep rejects absolute audio paths outside /tmp — copy if needed
    updates = {}
    if req.src_audio_path:
        safe = _ensure_in_tmp(req.src_audio_path)
        if safe != req.src_audio_path:
            updates["src_audio_path"] = safe
    if req.reference_audio_path:
        safe = _ensure_in_tmp(req.reference_audio_path)
        if safe != req.reference_audio_path:
            updates["reference_audio_path"] = safe
    if updates:
        req = req.model_copy(update=updates)
    payload = _build_payload(req)
    try:
        task_id = await release_task(payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")

    _pending[task_id] = {
        "params": req.model_dump(),
        "format": req.audio_format,
        "user": user,
        "created_at": time.monotonic(),
    }
    _queue_order.append((task_id, user))
    logger.info("generate user=%s task_id=%s duration=%s batch=%s", user, task_id, req.duration, req.batch_size)
    return {"task_id": task_id}


class GenerateLyricsRequest(BaseModel):
    description: str
    vocal_language: str = "en"


@app.post("/generate-lyrics")
async def generate_lyrics(req: GenerateLyricsRequest, request: Request):
    """Generate structured lyrics from a natural language description.

    Uses AceStep's sample_query mode: the LM generates lyrics + metadata,
    then AceStep proceeds to audio generation. We poll until complete and
    extract the lyrics/metadata from the result. The generated audio is
    available as a bonus but not returned here.
    """
    if not req.description.strip():
        raise HTTPException(status_code=422, detail="Description cannot be empty")
    logger.info("generate-lyrics user=%s desc=%.60s", request.state.user, req.description)

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


class AnalyzeAudioRequest(BaseModel):
    audio_path: str


@app.post("/analyze-audio")
async def analyze_audio(req: AnalyzeAudioRequest, request: Request):
    """Analyze uploaded audio: extract BPM, key, lyrics, style description, and audio codes.

    Uses AceStep's full_analysis_only mode: VAE-encodes audio, VQ-tokenizes to
    discrete codes, then the LLM reverse-engineers metadata from the codes.
    No audio generation occurs — this is analysis only.
    """
    if not req.audio_path:
        raise HTTPException(status_code=422, detail="audio_path is required")

    safe_path = _ensure_in_tmp(req.audio_path)
    try:
        task_id = await release_task({
            "full_analysis_only": True,
            "src_audio_path": safe_path,
        })
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")

    # Server-side polling — analysis is LM-only, typically ~10-30s
    for _ in range(150):  # 150 × 2s = 5 min timeout
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
            return {
                "caption": result.get("prompt", ""),
                "lyrics": result.get("lyrics", ""),
                "bpm": meta.get("bpm"),
                "key_scale": meta.get("keyscale", ""),
                "time_signature": meta.get("timesignature", "4/4"),
                "vocal_language": meta.get("language", ""),
                "duration": meta.get("duration"),
            }
        elif data["status"] == "error":
            raise HTTPException(status_code=502, detail="Audio analysis failed")

    raise HTTPException(status_code=504, detail="Audio analysis timed out")


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
            "user":    pending.get("user", "local"),
            "created_at": pending.get("created_at", time.monotonic()),
        }
        # Remove from queue
        _queue_order[:] = [(t, u) for t, u in _queue_order if t != task_id]
        logger.info("complete user=%s task_id=%s results=%d", pending.get("user", "?"), task_id, len(data.get("results", [])))

    elif data["status"] == "error" and task_id in _pending:
        pending = _pending.pop(task_id, {})
        _queue_order[:] = [(t, u) for t, u in _queue_order if t != task_id]
        logger.warning("failed user=%s task_id=%s", pending.get("user", "?"), task_id)

    # Add queue position info
    pos = next((i for i, (t, _) in enumerate(_queue_order) if t == task_id), -1)
    data["queue_position"] = pos
    data["queue_depth"] = len(_queue_order)

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
async def download_audio(job_id: str, index: int, request: Request):
    job = _jobs.get(job_id)
    if not job or index >= len(job["results"]):
        raise HTTPException(status_code=404, detail="Result not found")
    user = request.state.user
    if user != "local" and job.get("user") != user:
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
async def download_json(job_id: str, index: int, request: Request):
    job = _jobs.get(job_id)
    if not job or index >= len(job["results"]):
        raise HTTPException(status_code=404, detail="Result not found")
    user = request.state.user
    if user != "local" and job.get("user") != user:
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
async def upload_audio(file: UploadFile, request: Request):
    """Accept an audio file upload, save to temp dir, return server-side path."""
    if not file.content_type or not file.content_type.startswith("audio/"):
        raise HTTPException(status_code=422, detail="Only audio files are supported")

    user = request.state.user
    upload_id = uuid.uuid4().hex[:12]
    suffix = Path(file.filename or "audio").suffix or ".wav"
    dest = _upload_dir / f"{upload_id}{suffix}"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    _uploads[upload_id] = {
        "path": str(dest),
        "filename": file.filename or "audio",
        "user": user,
        "created_at": time.monotonic(),
    }
    logger.info("upload user=%s file=%s", user, file.filename)
    return {"upload_id": upload_id, "path": str(dest), "filename": file.filename}


# ---------------------------------------------------------------------------
# LoRA adapter management
# ---------------------------------------------------------------------------

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
async def lora_load_route(req: LoRALoadRequest, request: Request):
    user = request.state.user
    err = _acquire_lock("lora", user, "load")
    if err:
        raise HTTPException(status_code=409, detail="Style adapter is being changed by another user.")
    logger.info("lora.load user=%s path=%s", user, req.lora_path)
    try:
        result = await lora_load(req.lora_path, req.adapter_name)
        return result
    except httpx.HTTPStatusError as exc:
        _release_lock("lora", user)
        detail = exc.response.text if exc.response else str(exc)
        raise HTTPException(status_code=exc.response.status_code, detail=detail)
    except Exception as exc:
        _release_lock("lora", user)
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/lora/unload")
async def lora_unload_route(request: Request):
    user = request.state.user
    logger.info("lora.unload user=%s", user)
    _release_lock("lora", user)
    try:
        result = await lora_unload()
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/lora/toggle")
async def lora_toggle_route(req: LoRAToggleRequest, request: Request):
    user = request.state.user
    lock = _resource_locks.get("lora")
    if lock and lock["user"] != user and time.monotonic() - lock["acquired_at"] < _LOCK_TIMEOUT:
        raise HTTPException(status_code=409, detail="Style adapter is being changed by another user.")
    try:
        result = await lora_toggle(req.use_lora)
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/lora/scale")
async def lora_scale_route(req: LoRAScaleRequest, request: Request):
    user = request.state.user
    lock = _resource_locks.get("lora")
    if lock and lock["user"] != user and time.monotonic() - lock["acquired_at"] < _LOCK_TIMEOUT:
        raise HTTPException(status_code=409, detail="Style adapter is being changed by another user.")
    try:
        result = await lora_scale(req.scale, req.adapter_name)
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.get("/lora/status")
async def lora_status_route():
    try:
        result = await lora_status()
        lock = _resource_locks.get("lora")
        if isinstance(result, dict):
            result["locked_by"] = lock["user"] if lock else None
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
        # PEFT LoRA: directory with adapter_config.json (may be nested in adapter/ subdir)
        if entry.is_dir():
            adapter_dir = entry
            if (entry / "adapter" / "adapter_config.json").exists():
                adapter_dir = entry / "adapter"
            if (adapter_dir / "adapter_config.json").exists():
                size_bytes = sum(f.stat().st_size for f in entry.rglob("*") if f.is_file())
                adapters.append({
                    "name": entry.name,
                    "path": str(adapter_dir),
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
_TRAIN_SNAPSHOTS_DIR = _TRAIN_DIR / "snapshots"


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


@app.post("/train/label")
async def train_label(req: TrainLabelRequest = TrainLabelRequest()):
    """Start async auto-labeling of dataset samples."""
    payload = {"only_unlabeled": True}
    if req.lm_model_path:
        payload["lm_model_path"] = req.lm_model_path
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


# ---------------------------------------------------------------------------
# Snapshots — named save/load of dataset + tensors
# ---------------------------------------------------------------------------

_SNAPSHOT_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,62}[a-zA-Z0-9]$|^[a-zA-Z0-9]$")


def _safe_snapshot_name(name: str) -> str:
    """Validate and return a safe snapshot directory name."""
    name = name.strip()
    if not name or not _SNAPSHOT_NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail="Snapshot name must be 1-64 alphanumeric characters, spaces, hyphens, or underscores.",
        )
    return name


class SnapshotRequest(BaseModel):
    name: str


@app.get("/train/snapshots")
async def train_snapshot_list():
    """List saved snapshots with metadata."""
    if not _TRAIN_SNAPSHOTS_DIR.is_dir():
        return {"snapshots": []}
    snapshots = []
    for d in sorted(_TRAIN_SNAPSHOTS_DIR.iterdir()):
        if not d.is_dir():
            continue
        ds_file = d / "dataset.json"
        tensor_dir = d / "tensors"
        tensor_count = sum(1 for f in tensor_dir.iterdir() if f.suffix == ".pt") if tensor_dir.is_dir() else 0
        snapshots.append({
            "name": d.name,
            "has_dataset": ds_file.exists(),
            "tensor_count": tensor_count,
            "created": datetime.fromtimestamp(d.stat().st_mtime, tz=timezone.utc).isoformat(),
        })
    return {"snapshots": snapshots}


@app.post("/train/snapshots/save")
async def train_snapshot_save(req: SnapshotRequest):
    """Save current dataset + tensors as a named snapshot."""
    name = _safe_snapshot_name(req.name)
    snap_dir = _TRAIN_SNAPSHOTS_DIR / name
    snap_dir.mkdir(parents=True, exist_ok=True)

    copied = {"dataset": False, "tensors": 0}

    # Copy dataset.json
    if _TRAIN_DATASET_FILE.exists():
        shutil.copy2(_TRAIN_DATASET_FILE, snap_dir / "dataset.json")
        copied["dataset"] = True

    # Copy tensors
    snap_tensors = snap_dir / "tensors"
    if _TRAIN_TENSOR_DIR.is_dir():
        if snap_tensors.exists():
            shutil.rmtree(snap_tensors)
        shutil.copytree(_TRAIN_TENSOR_DIR, snap_tensors)
        copied["tensors"] = sum(1 for f in snap_tensors.iterdir() if f.suffix == ".pt")

    return {"name": name, "copied": copied}


@app.post("/train/snapshots/load")
async def train_snapshot_load(req: SnapshotRequest):
    """Load a named snapshot back into the working directory and AceStep memory."""
    name = _safe_snapshot_name(req.name)
    snap_dir = _TRAIN_SNAPSHOTS_DIR / name
    if not snap_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Snapshot '{name}' not found")

    restored = {"dataset": False, "tensors": 0}

    # Restore dataset.json
    snap_ds = snap_dir / "dataset.json"
    if snap_ds.exists():
        _TRAIN_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(snap_ds, _TRAIN_DATASET_FILE)
        # Reload into AceStep memory
        try:
            await dataset_load(str(_TRAIN_DATASET_FILE))
        except Exception:
            pass  # dataset file is on disk even if AceStep load fails
        restored["dataset"] = True

    # Restore tensors
    snap_tensors = snap_dir / "tensors"
    if snap_tensors.is_dir():
        if _TRAIN_TENSOR_DIR.exists():
            shutil.rmtree(_TRAIN_TENSOR_DIR)
        shutil.copytree(snap_tensors, _TRAIN_TENSOR_DIR)
        restored["tensors"] = sum(1 for f in _TRAIN_TENSOR_DIR.iterdir() if f.suffix == ".pt")

    return {"name": name, "restored": restored}


@app.delete("/train/snapshots/{name}")
async def train_snapshot_delete(name: str):
    """Delete a named snapshot."""
    name = _safe_snapshot_name(name)
    snap_dir = _TRAIN_SNAPSHOTS_DIR / name
    if not snap_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Snapshot '{name}' not found")
    shutil.rmtree(snap_dir)
    return {"deleted": name}


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
async def train_start(req: TrainStartRequest, request: Request):
    """Start LoRA/LoKR training from preprocessed tensors."""
    user = request.state.user
    err = _acquire_lock("training", user, "train")
    if err:
        raise HTTPException(status_code=409, detail="Training is in progress by another user.")
    logger.info("train.start user=%s adapter=%s epochs=%d", user, req.adapter_type, req.train_epochs)

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
        lock = _resource_locks.get("training")
        if isinstance(result, dict):
            result["locked_by"] = lock["user"] if lock else None
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/train/stop")
async def train_stop(request: Request):
    """Stop the current training run."""
    user = request.state.user
    logger.info("train.stop user=%s", user)
    _release_lock("training", user)
    try:
        result = await training_stop()
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/train/export")
async def train_export(req: TrainExportRequest, request: Request):
    """Export trained adapter to the loras directory for immediate use."""
    user = request.state.user
    logger.info("train.export user=%s name=%s", user, req.name)
    _release_lock("training", user)
    output_dir = req.output_dir or str(_TRAIN_OUTPUT_DIR)
    safe_name = re.sub(r'[^\w\-.]', '_', req.name.strip()) or "trained_adapter"
    export_path = str(_LORA_DIR / safe_name)
    try:
        result = await training_export(export_path, output_dir)
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


@app.post("/train/reinitialize")
async def train_reinitialize(request: Request):
    """Reinitialize model components after training completes."""
    user = request.state.user
    logger.info("train.reinitialize user=%s", user)
    _release_lock("training", user)
    try:
        result = await reinitialize_service()
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AceStep error: {exc}")


# ---------------------------------------------------------------------------
# Session info endpoint
# ---------------------------------------------------------------------------

@app.get("/api/session")
async def api_session(request: Request):
    user = request.state.user
    now = time.monotonic()
    timeout = SESSION_TIMEOUT_MIN * 60
    active = sum(1 for s in _sessions.values() if now - s["last_seen"] < timeout)
    return {
        "user": user,
        "active_users": active,
        "max_users": MAX_USERS,
        "pending_jobs": sum(1 for p in _pending.values() if p.get("user") == user),
        "max_jobs_per_user": MAX_JOBS_PER_USER,
        "queue_depth": len(_queue_order),
    }


# ---------------------------------------------------------------------------
# TTL cleanup background task
# ---------------------------------------------------------------------------

async def _cleanup_loop():
    """Periodically expire stale jobs, uploads, sessions, and locks."""
    while True:
        await asyncio.sleep(60)
        now = time.monotonic()
        evicted = {"jobs": 0, "pending": 0, "uploads": 0, "sessions": 0, "locks": 0}

        job_ttl = JOB_TTL_MIN * 60
        upload_ttl = UPLOAD_TTL_MIN * 60
        session_ttl = SESSION_TIMEOUT_MIN * 60

        # Expire completed jobs
        expired_jobs = [k for k, v in _jobs.items() if now - v.get("created_at", now) > job_ttl]
        for k in expired_jobs:
            del _jobs[k]
            evicted["jobs"] += 1

        # Expire stuck pending tasks
        expired_pending = [k for k, v in _pending.items() if now - v.get("created_at", now) > job_ttl]
        for k in expired_pending:
            del _pending[k]
            _queue_order[:] = [(t, u) for t, u in _queue_order if t != k]
            evicted["pending"] += 1

        # Expire uploads (delete files too)
        expired_uploads = [k for k, v in _uploads.items() if now - v.get("created_at", now) > upload_ttl]
        for k in expired_uploads:
            info = _uploads.pop(k)
            try:
                Path(info["path"]).unlink(missing_ok=True)
            except OSError:
                pass
            evicted["uploads"] += 1

        # Expire inactive sessions
        expired_sessions = [u for u, s in _sessions.items() if now - s["last_seen"] > session_ttl]
        for u in expired_sessions:
            del _sessions[u]
            evicted["sessions"] += 1

        # Release stale resource locks
        expired_locks = [r for r, l in _resource_locks.items() if now - l["acquired_at"] > _LOCK_TIMEOUT]
        for r in expired_locks:
            del _resource_locks[r]
            evicted["locks"] += 1

        total = sum(evicted.values())
        if total:
            logger.info("cleanup evicted=%s", evicted)


@app.on_event("startup")
async def start_cleanup():
    asyncio.create_task(_cleanup_loop())


# ---------------------------------------------------------------------------
# Static frontend — mounted last so API routes take priority
# ---------------------------------------------------------------------------

_frontend = Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="frontend")

# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=7860, reload=True)
