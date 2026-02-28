"""
ACE-Step Wrangler — FastAPI backend.

Endpoints:
  POST /generate                    Submit a generation job, return task_id
  GET  /status/{task_id}            Poll job status; stores result on completion
  GET  /audio                       Proxy audio stream from AceStep (no download header)
  GET  /download/{job_id}/{n}/audio Download audio with Content-Disposition
  GET  /download/{job_id}/{n}/json  Download generation metadata as JSON
  GET  /api/health                  Forward AceStep health check

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
from typing import Optional
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
    task_type:             str             = "text2music"  # text2music | cover | repaint
    src_audio_path:        Optional[str]   = None
    audio_cover_strength:  Optional[float] = None          # 0.0–1.0 for cover
    repainting_start:      Optional[float] = None          # seconds, for repaint
    repainting_end:        Optional[float] = None          # seconds, for repaint

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

    # Rework params
    if req.task_type in ("cover", "repaint"):
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
# Static frontend — mounted last so API routes take priority
# ---------------------------------------------------------------------------

_frontend = Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="frontend")

# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=7860, reload=True)
