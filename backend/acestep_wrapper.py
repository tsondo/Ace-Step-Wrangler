"""
Thin async wrapper around the AceStep local REST API.

AceStep runs as a separate process (default: http://localhost:8001).
We never import AceStep directly — all communication is via HTTP.

Key quirk: /query_result returns `result` as a JSON *string*, not a
nested object. parse_result() handles that.
"""

import json
import httpx

ACESTEP_BASE_URL = "http://localhost:8001"
_TIMEOUT_SUBMIT  = httpx.Timeout(30.0)
_TIMEOUT_POLL    = httpx.Timeout(10.0)
_TIMEOUT_AUDIO   = httpx.Timeout(60.0)


async def health_check() -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT_POLL) as client:
        r = await client.get(f"{ACESTEP_BASE_URL}/health")
        r.raise_for_status()
        return r.json()


async def release_task(payload: dict) -> str:
    """Submit a generation task. Returns the task_id string."""
    async with httpx.AsyncClient(timeout=_TIMEOUT_SUBMIT) as client:
        r = await client.post(f"{ACESTEP_BASE_URL}/release_task", json=payload)
        r.raise_for_status()
        body = r.json()
        return body["data"]["task_id"]


async def query_result(task_id: str) -> dict:
    """
    Poll a task. Returns a normalised dict:
      { "status": "processing" | "done" | "error",
        "audio_url": str | None,   # relative URL, only when done
        "meta": dict | None }      # metas dict from AceStep, only when done
    """
    async with httpx.AsyncClient(timeout=_TIMEOUT_POLL) as client:
        r = await client.post(
            f"{ACESTEP_BASE_URL}/query_result",
            json={"task_id_list": [task_id]},
        )
        r.raise_for_status()
        body  = r.json()
        entry = body["data"][0]
        code  = entry["status"]   # 0=running, 1=succeeded, 2=failed

    if code == 0:
        return {"status": "processing", "audio_url": None, "meta": None}

    if code == 2:
        return {"status": "error", "audio_url": None, "meta": None}

    # status == 1: result is a JSON string — parse it
    results = json.loads(entry["result"])
    first   = results[0]
    return {
        "status":    "done",
        "audio_url": first["file"],   # already a relative URL e.g. /v1/audio?path=...
        "meta":      first.get("metas"),
    }


async def get_audio_bytes(path: str) -> tuple[bytes, str]:
    """
    Download audio from AceStep and return (bytes, content_type).
    `path` is the URL-encoded path value from audio_url, e.g.
    '/v1/audio?path=%2F...'  — we forward the path query param.
    """
    async with httpx.AsyncClient(timeout=_TIMEOUT_AUDIO) as client:
        r = await client.get(f"{ACESTEP_BASE_URL}{path}")
        r.raise_for_status()
        ct = r.headers.get("content-type", "audio/mpeg")
        return r.content, ct
