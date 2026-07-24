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


def test_status_returns_enriched_results_after_watcher_finalized(tmp_path, monkeypatch):
    """If the watcher finalizes a job before the browser's next poll, /status
    must still return the enriched results (take ref + takes-dir audio path),
    not the raw AceStep response."""
    from fastapi.testclient import TestClient

    monkeypatch.setattr(takes, "TAKES_DIR", tmp_path)
    src = tmp_path / "gen.mp3"
    src.write_bytes(b"audio")
    task_id = "watched-job-2"
    backend_main._pending[task_id] = _pending_entry()

    def fresh_done():
        return {
            "status": "done",
            "results": [{"audio_url": f"/v1/audio?path={src}", "meta": {"bpm": 90},
                         "prompt": "p", "lyrics": "la la", "seed_value": "7"}],
        }

    async def fake_query(tid):
        return fresh_done()  # new dicts every call, like a real AceStep response

    monkeypatch.setattr(backend_main, "query_result", fake_query)

    # Watcher finalizes first (enriches ITS copy of the results)
    asyncio.run(backend_main._watch_pending_jobs_once())
    assert task_id in backend_main._jobs

    # Browser polls afterwards — gets a fresh, unenriched AceStep response
    client = TestClient(backend_main.app)
    body = client.get(f"/status/{task_id}").json()
    assert body["results"][0]["take"] == {"job_id": task_id, "index": 0}
    assert body["results"][0]["audio_url"].endswith("take-1.mp3")
