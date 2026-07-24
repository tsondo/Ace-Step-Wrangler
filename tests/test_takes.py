import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
import takes


def test_normalize_meta_backfills_bpm_and_timesig():
    params = {"bpm": None, "time_signature": ""}
    meta = {"bpm": 73, "timesignature": "4"}
    p, m = takes.normalize_meta(params, meta)
    assert p["bpm"] == 73
    assert m["timesignature"] == "4/4"
    assert p["time_signature"] == "4/4"


def test_normalize_meta_keeps_explicit_params():
    params = {"bpm": 120, "time_signature": "3/4"}
    meta = {"bpm": 73, "timesignature": "4"}
    p, m = takes.normalize_meta(params, meta)
    assert p["bpm"] == 120
    assert p["time_signature"] == "3/4"
    assert m["timesignature"] == "4/4"


def test_write_read_update_delete_take(tmp_path, monkeypatch):
    monkeypatch.setattr(takes, "TAKES_DIR", tmp_path)
    src = tmp_path / "src.mp3"
    src.write_bytes(b"fake-audio")
    result = {
        "audio_url": f"/v1/audio?path={src}",
        "meta": {"bpm": 90, "timesignature": "4"},
        "prompt": "an enhanced prompt",
        "lyrics": "[verse]\nhello world",
        "seed_value": "12345",
    }
    take = takes.write_take("job1", 0, result, {"bpm": None}, "mp3",
                            seed_mode="random", parent_take=None, rework=None)
    assert take["seed_used"] == 12345
    assert take["seed_mode"] == "random"
    assert take["lyrics"] == "[verse]\nhello world"
    assert take["alignment"] is None

    audio = takes.audio_path_for("job1", 0)
    assert audio.exists() and audio.read_bytes() == b"fake-audio"

    loaded = takes.read_take("job1", 0)
    assert loaded["seed_used"] == 12345

    takes.update_take("job1", 0, {"alignment": {"model": "mms_fa", "lines": []}})
    assert takes.read_take("job1", 0)["alignment"]["model"] == "mms_fa"

    assert takes.delete_take("job1", 0) is True
    assert takes.read_take("job1", 0) is None


def test_write_take_missing_audio_returns_none(tmp_path, monkeypatch):
    monkeypatch.setattr(takes, "TAKES_DIR", tmp_path)
    result = {"audio_url": "/v1/audio?path=/nonexistent/x.mp3", "meta": {},
              "lyrics": "", "seed_value": None}
    assert takes.write_take("job2", 0, result, {}, "mp3", "random", None, None) is None
