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
import uvicorn
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from acestep_wrapper import (
    health_check,
    release_task,
    query_result,
    get_audio_bytes,
)

app = FastAPI(title="ACE-Step Wrangler")

# ---------------------------------------------------------------------------
# In-process job store (cleared on restart — acceptable for now)
# ---------------------------------------------------------------------------

# task_id → { "results": [...], "params": dict, "format": str }
_jobs: dict[str, dict] = {}

# task_id → { "params": dict, "format": str }  (pending, before results arrive)
_pending: dict[str, dict] = {}

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

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_payload(req: GenerateRequest) -> dict:
    lyric_adherence = max(0, min(2, req.lyric_adherence))
    quality         = max(0, min(2, req.quality))
    creativity      = max(0.0, min(100.0, req.creativity))

    # Creativity → shift (inverse): restrained (0%) = 5.0, wild (100%) = 1.0
    shift = round(5.0 - (creativity / 100.0) * 4.0, 2)

    payload = {
        "prompt":          req.style,
        "lyrics":          req.lyrics,
        "audio_duration":  req.duration,
        "guidance_scale":  _LYRIC_ADHERENCE[lyric_adherence],
        "shift":           shift,
        "inference_steps": _QUALITY_STEPS[quality],
        "batch_size":      max(1, req.batch_size),
        "use_random_seed": req.seed is None,
        "seed":            req.seed if req.seed is not None else -1,
        "infer_method":    _SCHEDULER.get(req.scheduler, "ode"),
        "audio_format":    req.audio_format,
    }

    model_name = _GEN_MODEL.get(req.gen_model)
    if model_name:
        payload["model"] = model_name

    return payload

# ---------------------------------------------------------------------------
# API routes  (must come before the static-files catch-all)
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def api_health():
    try:
        return await health_check()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.post("/generate")
async def generate(req: GenerateRequest):
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
    """Transparent audio proxy (no Content-Disposition) — used by <audio> elements."""
    try:
        data, content_type = await get_audio_bytes(path)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Audio fetch error: {exc}")
    return Response(content=data, media_type=content_type)


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


# ---------------------------------------------------------------------------
# Static frontend — mounted last so API routes take priority
# ---------------------------------------------------------------------------

_frontend = Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="frontend")

# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=7860, reload=True)
