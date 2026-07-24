import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
import takes
import main as backend_main


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
