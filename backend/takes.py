"""Persist finished generation results as self-describing takes.

A take = one audio file + one JSON metadata file under takes/<job_id>/.
The JSON is the durable record: request params, actual meta, resolved seed,
rework lineage, and (once computed) the lyric alignment block.
"""

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

TAKES_DIR = Path(__file__).parent.parent / "takes"

TAKE_VERSION = 2


def _url_to_fs_path(audio_url: str) -> Optional[Path]:
    """Extract the local filesystem path from an AceStep /v1/audio URL or raw path."""
    if not audio_url:
        return None
    if "?" in audio_url:
        qs = parse_qs(urlparse(audio_url).query)
        vals = qs.get("path")
        if not vals:
            return None
        return Path(vals[0])
    return Path(audio_url)


def _normalize_time_signature(ts) -> str:
    s = str(ts or "").strip()
    if not s or s.lower() in ("n/a", "none"):
        return ""
    return s if "/" in s else f"{s}/4"


def normalize_meta(params: dict, meta: dict) -> tuple[dict, dict]:
    """Resolve the params/meta bpm and time-signature mismatches.

    meta reflects what AceStep actually generated and wins; params keeps the
    original request but bpm/time_signature are backfilled when the request
    left them empty, so the take JSON never carries contradictory values.
    """
    params = dict(params or {})
    meta = dict(meta or {})
    meta["timesignature"] = _normalize_time_signature(meta.get("timesignature"))
    if params.get("bpm") in (None, "", 0) and isinstance(meta.get("bpm"), int):
        params["bpm"] = meta["bpm"]
    if not params.get("time_signature") and meta["timesignature"]:
        params["time_signature"] = meta["timesignature"]
    return params, meta


def _json_path(job_id: str, index: int) -> Path:
    return TAKES_DIR / job_id / f"take-{index + 1}.json"


def audio_path_for(job_id: str, index: int) -> Optional[Path]:
    take = read_take(job_id, index)
    if not take:
        return None
    p = TAKES_DIR / job_id / take["audio_file"]
    return p if p.exists() else None


def write_take(job_id: str, index: int, result: dict, params: dict, fmt: str,
               seed_mode: str, parent_take: Optional[dict],
               rework: Optional[dict]) -> Optional[dict]:
    src = _url_to_fs_path(result.get("audio_url", ""))
    if src is None or not src.exists():
        return None

    dest_dir = TAKES_DIR / job_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    audio_name = f"take-{index + 1}.{fmt}"
    shutil.copy2(src, dest_dir / audio_name)

    norm_params, norm_meta = normalize_meta(params, result.get("meta") or {})
    seed_raw = result.get("seed_value")
    try:
        seed_used = int(seed_raw) if seed_raw is not None else None
    except (TypeError, ValueError):
        seed_used = None

    take = {
        "take_version": TAKE_VERSION,
        "job_id": job_id,
        "index": index,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "audio_file": audio_name,
        "params": norm_params,
        "meta": norm_meta,
        "prompt": result.get("prompt", ""),
        "lyrics": result.get("lyrics") or norm_params.get("lyrics", ""),
        "seed_mode": seed_mode,
        "seed_used": seed_used,
        "parent_take": parent_take,
        "rework": rework,
        "alignment": None,
    }
    with open(_json_path(job_id, index), "w", encoding="utf-8") as f:
        json.dump(take, f, ensure_ascii=False, indent=2)
    return take


def read_take(job_id: str, index: int) -> Optional[dict]:
    p = _json_path(job_id, index)
    if not p.exists():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def update_take(job_id: str, index: int, patch: dict) -> Optional[dict]:
    take = read_take(job_id, index)
    if take is None:
        return None
    take.update(patch)
    with open(_json_path(job_id, index), "w", encoding="utf-8") as f:
        json.dump(take, f, ensure_ascii=False, indent=2)
    return take


def delete_take(job_id: str, index: int) -> bool:
    p = _json_path(job_id, index)
    if not p.exists():
        return False
    take = read_take(job_id, index)
    p.unlink()
    audio = TAKES_DIR / job_id / take["audio_file"]
    if audio.exists():
        audio.unlink()
    job_dir = TAKES_DIR / job_id
    if not any(job_dir.iterdir()):
        job_dir.rmdir()
    return True
