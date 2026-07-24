import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
import takes
import main as backend_main
from fastapi.testclient import TestClient


def test_persist_results_writes_takes_and_rewrites_urls(tmp_path, monkeypatch):
    monkeypatch.setattr(takes, "TAKES_DIR", tmp_path)
    src = tmp_path / "gen.mp3"
    src.write_bytes(b"audio")
    results = [{"audio_url": f"/v1/audio?path={src}", "meta": {"bpm": 90, "timesignature": "4"},
                "prompt": "p", "lyrics": "la la", "seed_value": "7"}]
    pending = {"params": {"task_type": "text2music", "bpm": None, "seed_mode": "random"},
               "format": "mp3", "user": "local"}
    backend_main._persist_results("jobX", results, pending)
    take = takes.read_take("jobX", 0)
    assert take["seed_used"] == 7
    assert results[0]["take"] == {"job_id": "jobX", "index": 0}
    assert results[0]["audio_url"] == str(tmp_path / "jobX" / "take-1.mp3")


def test_persist_skips_analyze_task_types(tmp_path, monkeypatch):
    monkeypatch.setattr(takes, "TAKES_DIR", tmp_path)
    results = [{"audio_url": "/v1/audio?path=/x.mp3", "meta": {}, "lyrics": "", "seed_value": "1"}]
    pending = {"params": {"task_type": "extract"}, "format": "mp3"}
    backend_main._persist_results("jobY", results, pending)
    assert takes.read_take("jobY", 0) is None


def test_takes_endpoints_enforce_per_user_ownership(tmp_path, monkeypatch):
    """A take created for 'alice' must not be readable/deletable by 'bob', but
    must remain accessible to its owner and to 'local' (matches /download)."""
    monkeypatch.setattr(takes, "TAKES_DIR", tmp_path)
    src = tmp_path / "gen.mp3"
    src.write_bytes(b"audio")
    result = {"audio_url": f"/v1/audio?path={src}", "meta": {}, "lyrics": "", "seed_value": "1"}
    takes.write_take("jobZ", 0, result, {}, "mp3", "random", None, None, user="alice")

    client = TestClient(backend_main.app)

    # Mismatched user -> 404, indistinguishable from "not found"
    resp = client.get("/takes/jobZ/0", headers={"x-auth-user": "bob"})
    assert resp.status_code == 404

    # Owning user -> 200
    resp = client.get("/takes/jobZ/0", headers={"x-auth-user": "alice"})
    assert resp.status_code == 200
    assert resp.json()["user"] == "alice"

    # "local" escape hatch -> always allowed, matches /download pattern
    resp = client.get("/takes/jobZ/0", headers={"x-auth-user": "local"})
    assert resp.status_code == 200

    # DELETE follows the same rule: mismatched user is denied...
    resp = client.delete("/takes/jobZ/0", headers={"x-auth-user": "bob"})
    assert resp.status_code == 404
    assert takes.read_take("jobZ", 0) is not None

    # ...but the owner can delete it.
    resp = client.delete("/takes/jobZ/0", headers={"x-auth-user": "alice"})
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}
    assert takes.read_take("jobZ", 0) is None
