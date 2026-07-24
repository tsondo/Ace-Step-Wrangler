"""Forced alignment of lyrics to rendered audio via torchaudio MMS_FA.

CPU-only by design: the AceStep subprocess owns the GPU. MMS_FA's dictionary
is romanized Latin, so non-Latin scripts (e.g. Cyrillic) are romanized with
uroman before alignment. The ~1.2 GB model downloads lazily on first use.
"""

import re
from typing import Optional

import torch
import torchaudio
import uroman as _uroman_mod

_SAMPLE_RATE = 16000
_TAG_RE = re.compile(r"^\s*\[[^\]]*\]\s*$")

_MODEL = None
_DICT = None
_UROMAN = None


def preprocess_lyrics(lyrics: str) -> list:
    """Alignable lines with a mapping back to original line numbers."""
    out = []
    for i, raw in enumerate((lyrics or "").splitlines()):
        line = raw.strip()
        if not line or _TAG_RE.match(line):
            continue
        words = [w for w in re.split(r"\s+", line) if any(ch.isalnum() for ch in w)]
        if words:
            out.append({"line_idx": i, "text": line, "words": words})
    return out


def _romanize(word: str) -> str:
    global _UROMAN
    if _UROMAN is None:
        _UROMAN = _uroman_mod.Uroman()
    rom = str(_UROMAN.romanize_string(word)).lower()
    return re.sub(r"[^a-z']", "", rom)


def _load_model():
    global _MODEL, _DICT
    if _MODEL is None:
        bundle = torchaudio.pipelines.MMS_FA
        _MODEL = bundle.get_model(with_star=False).to("cpu").eval()
        _DICT = bundle.get_dict(star=None)
    return _MODEL, _DICT


def run_alignment(audio_path: str, lyrics: str) -> dict:
    lines = preprocess_lyrics(lyrics)
    empty = {"model": "mms_fa", "lines": []}
    if not lines:
        return empty

    model, dictionary = _load_model()

    wav, sr = torchaudio.load(audio_path)
    wav = wav.mean(0, keepdim=True)
    if sr != _SAMPLE_RATE:
        wav = torchaudio.functional.resample(wav, sr, _SAMPLE_RATE)

    with torch.inference_mode():
        emission, _ = model(wav)

    flat_words = [(li, w) for li, line in enumerate(lines) for w in line["words"]]
    rom_words = [_romanize(w) or "a" for _, w in flat_words]
    # Drop chars missing from the dictionary; guarantee at least one token per word
    tokens_per_word = [[dictionary[c] for c in w if c in dictionary] or [dictionary["a"]]
                       for w in rom_words]
    targets = torch.tensor([[t for toks in tokens_per_word for t in toks]],
                           dtype=torch.int32)

    aligned, scores = torchaudio.functional.forced_align(emission, targets, blank=0)
    scores = scores.exp()  # forced_align returns log-probabilities; convert to probability
    spans = torchaudio.functional.merge_tokens(aligned[0], scores[0])

    ratio = wav.size(1) / emission.size(1) / _SAMPLE_RATE
    word_results = []
    pos = 0
    for (line_i, word), toks in zip(flat_words, tokens_per_word):
        chunk = spans[pos:pos + len(toks)]
        pos += len(toks)
        word_results.append({
            "line_i": line_i,
            "text": word,
            "start_s": round(chunk[0].start * ratio, 3),
            "end_s": round(chunk[-1].end * ratio, 3),
            "confidence": round(sum(s.score for s in chunk) / len(chunk), 4),
        })

    out_lines = []
    for li, line in enumerate(lines):
        words = [w for w in word_results if w["line_i"] == li]
        out_lines.append({
            "line_idx": line["line_idx"],
            "text": line["text"],
            "start_s": words[0]["start_s"],
            "end_s": words[-1]["end_s"],
            "confidence": round(sum(w["confidence"] for w in words) / len(words), 4),
            "words": [{k: w[k] for k in ("text", "start_s", "end_s", "confidence")}
                      for w in words],
        })
    return {"model": "mms_fa", "lines": out_lines}
