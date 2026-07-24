import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
import takes
import main as backend_main


def test_worker_aligns_and_caches(tmp_path, monkeypatch):
    monkeypatch.setattr(takes, "TAKES_DIR", tmp_path)
    src = tmp_path / "a.mp3"
    src.write_bytes(b"x")
    result = {"audio_url": f"/v1/audio?path={src}", "meta": {}, "prompt": "",
              "lyrics": "hello world", "seed_value": "1"}
    takes.write_take("j1", 0, result, {}, "mp3", "random", None, None)

    fake = {"model": "mms_fa", "lines": [{"line_idx": 0, "text": "hello world",
            "start_s": 0.0, "end_s": 1.0, "confidence": 0.9, "words": []}]}
    monkeypatch.setattr(backend_main.alignment, "run_alignment",
                        lambda audio, lyrics: fake)

    async def go():
        backend_main._enqueue_alignment("j1", 0)
        assert backend_main._alignment_status_for("j1", 0) == "queued"
        await backend_main._drain_alignment_queue_once()

    asyncio.run(go())
    assert takes.read_take("j1", 0)["alignment"] == fake
    assert backend_main._alignment_status_for("j1", 0) == "done"


def test_enqueue_skips_already_aligned(tmp_path, monkeypatch):
    monkeypatch.setattr(takes, "TAKES_DIR", tmp_path)
    src = tmp_path / "b.mp3"
    src.write_bytes(b"x")
    result = {"audio_url": f"/v1/audio?path={src}", "meta": {}, "prompt": "",
              "lyrics": "la", "seed_value": "1"}
    takes.write_take("j2", 0, result, {}, "mp3", "random", None, None)
    takes.update_take("j2", 0, {"alignment": {"model": "mms_fa", "lines": []}})
    backend_main._enqueue_alignment("j2", 0)
    assert backend_main._alignment_status_for("j2", 0) == "done"
