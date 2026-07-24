import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
import alignment


def test_preprocess_strips_tags_and_blanks():
    lyrics = "[Verse 1]\n\nHello world\n[Chorus]\nSing it loud\n...\n"
    lines = alignment.preprocess_lyrics(lyrics)
    assert [l["text"] for l in lines] == ["Hello world", "Sing it loud"]
    assert lines[0]["line_idx"] == 2
    assert lines[1]["line_idx"] == 4
    assert lines[0]["words"] == ["Hello", "world"]


def test_preprocess_keeps_cyrillic():
    lines = alignment.preprocess_lyrics("Люди любят мир\n")
    assert lines[0]["words"] == ["Люди", "любят", "мир"]


def test_romanize_cyrillic_to_latin():
    rom = alignment._romanize("Люди")
    assert rom and all("a" <= c <= "z" or c == "'" for c in rom)


def test_romanize_plain_english_lowercases():
    assert alignment._romanize("Hello") == "hello"
