# Lyrics Guide for ACE-Step

ACE-Step is a melody-first singing model. It prioritizes musical phrasing and expressive delivery over literal text reproduction. It may skip, merge, or reorder lines to serve the music. You can reduce this by structuring lyrics clearly, but you cannot eliminate it — ACE-Step is not a text-to-speech engine.

Note: The "Strictly follow lyrics" slider controls how closely the model tracks your lyrics. Even at the Strict setting, ACE-Step may still adapt phrasing for musical reasons.

---

## Structure

**Use section tags.** Tags tell ACE-Step how to shape energy and dynamics over time.

```
[Intro]

[Verse 1]
Walking down the empty road
Counting every step I take

[Chorus]
We are the ones who stayed behind
Standing where the rivers meet

[Verse 2]
Morning comes without a sound
Nothing left but open sky

[Bridge]
If the world forgets our name
We will carve it in the stone

[Chorus]
We are the ones who stayed behind
Standing where the rivers meet

[Outro]
```

Numbered verses (`[Verse 1]`, `[Verse 2]`) work fine. Tags like `[Pre-Chorus]`, `[Bridge]`, `[Instrumental]`, `[Guitar Solo]`, `[Fade Out]` are all recognized.

You can add hints to tags for finer control: `[Chorus - anthemic]`, `[Verse - whispered]`. Keep hints short — put detailed style descriptions in the caption instead.

**Leave a blank line between sections.** This reinforces boundaries.

---

## Line Length

Aim for **6-10 syllables per line**. This matches natural sung phrasing and gives ACE-Step the best chance of aligning syllables to beats. Keep syllable counts roughly consistent within a section (within 1-2 syllables).

Lines that are too short may get merged with the next line. Lines that are too long may get truncated or rushed.

---

## Line Independence

Each line should feel like a complete phrase. If a line reads like the continuation of the previous one, ACE-Step may merge them.

Vary how lines begin — if two lines start with the same words, the model may treat one as a duplicate and skip it.

---

## Formatting

**UPPERCASE** signals emphasis or shouting: `WE ARE THE CHAMPIONS` vs `walking through the streets`.

**Parentheses** mark background vocals or echoes: `We rise together (together)`.

**Avoid forced or inconsistent rhyme schemes.** Natural rhymes are fine, but forcing rhymes or switching patterns mid-section can cause the model to reorder or smooth lines unpredictably.

---

## Vocabulary

Use varied language across sections. When the same emotionally loaded words (rise, light, dream, fire) appear in multiple sections, ACE-Step is more likely to drift or shuffle lines between them.

Give each section its own distinct emotional territory.

---

## Phonetic Spellings

If a word is consistently mispronounced, try spelling it phonetically:
- AI → Ay Eye
- higher → hi er

This is experimental — results vary.

---

## Style Description Matters More Than You Think

The style description (tags + custom text in the Style panel) is the single most important input affecting the generated music. Be specific about genre, instruments, mood, and production style. Vague descriptions give the model too much freedom; detailed ones anchor it.

See the upstream [Songwriting Guide](../vendor/ACE-Step-1.5/.claude/skills/acestep-songwriting/SKILL.md) for style-writing principles.

---

## Expect Some Drift

Even with perfect formatting, ACE-Step will always prioritize musical expression over literal reproduction. Literal fidelity can be improved but never guaranteed. Generate in batches (2-4 variations) and pick the best result — this is faster than trying to engineer one perfect output.

---

## Quick Checklist

- Use section tags (`[Verse]`, `[Chorus]`, `[Bridge]`, etc.)
- Blank line between sections
- 6-10 syllables per line
- Each line is a complete thought
- Vary line openings
- Vary vocabulary across sections
- UPPERCASE for emphasis, (parentheses) for backing vocals
- Detailed, specific caption
- Generate in batches and pick the best
