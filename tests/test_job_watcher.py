import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
import takes
import main as backend_main


def _pending_entry(user="local"):
    return {
        "params": {"task_type": "text2music", "seed_mode": "random"},
        "format": "mp3",
        "user": user,
        "created_at": time.monotonic(),
    }


def test_watcher_finalizes_done_job_without_client_polling(tmp_path, monkeypatch):
    monkeypatch.setattr(takes, "TAKES_DIR", tmp_path)
    src = tmp_path / "gen.mp3"
    src.write_bytes(b"audio")
    task_id = "watched-job-1"
    backend_main._pending[task_id] = _pending_entry()
    backend_main._queue_order.append((task_id, "local"))

    done = {
        "status": "done",
        "results": [{"audio_url": f"/v1/audio?path={src}", "meta": {"bpm": 90},
                     "prompt": "p", "lyrics": "la la", "seed_value": "7"}],
    }

    async def fake_query(tid):
        return done

    monkeypatch.setattr(backend_main, "query_result", fake_query)
    asyncio.run(backend_main._watch_pending_jobs_once())

    assert task_id in backend_main._jobs
    assert task_id not in backend_main._pending
    assert (task_id, "local") not in backend_main._queue_order
    assert takes.read_take(task_id, 0)["seed_used"] == 7


def test_watcher_survives_errors_and_skips_processing(tmp_path, monkeypatch):
    monkeypatch.setattr(takes, "TAKES_DIR", tmp_path)
    backend_main._pending["broken-job"] = _pending_entry()
    backend_main._pending["running-job"] = _pending_entry()

    async def fake_query(tid):
        if tid == "broken-job":
            raise RuntimeError("AceStep busy")
        return {"status": "processing", "results": None}

    monkeypatch.setattr(backend_main, "query_result", fake_query)
    asyncio.run(backend_main._watch_pending_jobs_once())

    assert "broken-job" in backend_main._pending
    assert "running-job" in backend_main._pending
    assert "broken-job" not in backend_main._jobs
    # cleanup module state for other tests
    del backend_main._pending["broken-job"]
    del backend_main._pending["running-job"]
