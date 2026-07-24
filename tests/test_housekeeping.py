import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
import takes
import main as backend_main


def test_persist_deletes_tmp_source_after_copy(tmp_path, monkeypatch):
    monkeypatch.setattr(takes, "TAKES_DIR", tmp_path / "takes")
    tmp_audio = tmp_path / ".cache" / "acestep" / "tmp" / "api_audio"
    tmp_audio.mkdir(parents=True)
    src = tmp_audio / "gen.mp3"
    src.write_bytes(b"audio")
    results = [{"audio_url": f"/v1/audio?path={src}", "meta": {}, "prompt": "",
                "lyrics": "la", "seed_value": "1"}]
    pending = {"params": {"task_type": "text2music", "seed_mode": "random"}, "format": "mp3"}
    backend_main._persist_results("hk-job-1", results, pending)
    assert takes.read_take("hk-job-1", 0) is not None
    assert not src.exists()  # tmp copy removed once safely persisted


def test_persist_keeps_source_outside_tmp_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(takes, "TAKES_DIR", tmp_path / "takes")
    src = tmp_path / "elsewhere" / "gen.mp3"
    src.parent.mkdir()
    src.write_bytes(b"audio")
    results = [{"audio_url": f"/v1/audio?path={src}", "meta": {}, "prompt": "",
                "lyrics": "la", "seed_value": "1"}]
    pending = {"params": {"task_type": "text2music", "seed_mode": "random"}, "format": "mp3"}
    backend_main._persist_results("hk-job-2", results, pending)
    assert takes.read_take("hk-job-2", 0) is not None
    assert src.exists()  # only files in AceStep's tmp cache are cleaned up


def test_sweep_tmp_audio_deletes_only_old_files(tmp_path):
    old = tmp_path / "old.flac"
    new = tmp_path / "new.mp3"
    old.write_bytes(b"x")
    new.write_bytes(b"y")
    week_ago = time.time() - 8 * 86400
    os.utime(old, (week_ago, week_ago))
    deleted = backend_main._sweep_tmp_audio(tmp_path, ttl_seconds=7 * 86400)
    assert deleted == 1
    assert not old.exists()
    assert new.exists()


def test_sweep_tmp_audio_missing_dir_is_noop(tmp_path):
    assert backend_main._sweep_tmp_audio(tmp_path / "nope", ttl_seconds=1) == 0
