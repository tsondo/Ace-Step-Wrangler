# LYRICS_GUIDE.md
Guidelines for Writing Lyrics That Ace Step Can Follow Reliably

Ace Step’s vocal engine is melody‑first, not text‑first. It tries to sing naturally, which means it may merge lines, skip lines, reorder lines, or reinterpret words unless the lyrics are written in a way that minimizes ambiguity. This guide explains how to structure lyrics so Ace Step is most likely to sing them exactly as written.

---

## 1. Write One Complete Idea Per Line
Ace Step treats each line as a musical phrase. If a line feels incomplete or too short, the model may merge it with the next line. If two lines feel like one idea, it may drop the boundary.

**Good:**
My voice grew stronger when I started creating  
A new spark rose inside me with steady warmth  

**Avoid:**
My voice grew stronger  
When I started creating  

Short lines invite merging.

---

## 2. Avoid Rhymes and Near‑Rhymes
Rhymes cause the model to smooth lines together or reorder them to create a more “musical” pattern.

**Avoid:**
fear / near  
me / see  
light / night  

**Prefer:**
fear / forward  
me / create  
light / motion  

Distinct vowel shapes reduce merging.

---

## 3. Make Each Line Structurally Different
If two lines begin the same way, Ace Step may treat them as duplicates and skip one.

**Avoid:**
I walked through the day with a quiet mind  
I walked through the night with a quiet heart  

**Prefer:**
I walked through the day with a quiet mind  
The night brought a stillness that felt familiar  

Different openings = safer alignment.

---

## 4. Avoid Punctuation Entirely
Punctuation encourages the model to reinterpret phrasing.

**Avoid:**
I felt a spark, rising inside me  
I felt a spark rising inside me.  

**Prefer:**
I felt a spark rising inside me  

Clean text = stable alignment.

---

## 5. Avoid Contractions
Contractions create unstable phoneme clusters.

**Avoid:**
I’m  
don’t  
can’t  
you’re  

**Prefer:**
I am  
do not  
cannot  
you are  

This reduces slurring and dropped syllables.

---

## 6. Use Phonetic Spellings for Unstable Words
Some words are consistently mispronounced or stylized. Spell them phonetically.

**Examples:**
AI → Ay Eye  
alive → a live  
electric → e lek trik  
higher → hi er  

This forces clear articulation.

---

## 7. Keep Lines Long Enough to Feel “Singable”
Lines that are too short get merged. Lines that are too long get truncated.

**Target length:**  
10–14 syllables per line is the most stable range.

This gives the model enough material to treat each line as a complete phrase.

---

## 8. Avoid Semantic Continuations Across Lines
If line B feels like the natural continuation of line A, the model may merge them.

**Avoid:**
I opened the door to a new way of thinking  
And then I stepped inside to explore the space  

**Prefer:**
I opened the door to a new way of thinking  
A calm steady light filled the room around me  

Distinct ideas = distinct lines.

---

## 9. Use Clear Section Headers
Ace Step respects section boundaries more than CFG values.

Use:
[Verse]  
[Chorus]  
[Pre Chorus]  
[Bridge]  
[Outro]  

Do not include bar counts or numbers in the header. The model may sing them.

---

## 10. Avoid Repeated Words at the Start of Lines
Repeated openings cause deduplication.

**Avoid:**
Now I rise  
Now I see  
Now I feel  

**Prefer:**
Now I rise  
A new sense of motion fills my mind  
The world feels open in a new way  

Variety prevents skipping.

---

## 11. Keep Style Conditioning Simple
The more style detail you give, the more freedom the model takes.

For maximum fidelity, use:
Clean pop vocal  
No melisma  
No ad libs  
Sing lines exactly as written  

Instrumentation can be described separately.

---

## 12. Use Moderate CFG and Moderate Inference Steps
High CFG causes skipping and reordering.  
Low CFG causes improvisation.

**Recommended:**
lyrics_cfg: 6–8  
inference_steps: 20–30  

Higher steps polish pronunciation but do not improve obedience.

---

## 13. Avoid Internal Rhythmic Patterns
If lines share rhythm or cadence, the model may reorder them to create a “better” musical flow.

Vary:
- stress patterns  
- vowel shapes  
- line length slightly  
- semantic domains  

This prevents smoothing.

---

## 14. Keep Each Line Semantically Self‑Contained
Ace Step tries to “fix” lines that feel incomplete.

**Avoid:**
I reached for the light  
that rose inside me  

**Prefer:**
I reached for the light rising inside me  

One line = one idea.

---

## 15. Test Small Sections Before Writing a Full Song
Ace Step’s alignment behavior is predictable.  
Test:
- a verse  
- a chorus  
- a bridge  

Then adjust your writing style before committing to a full lyric sheet.

---

## 16. Expect Some Drift
Even with perfect formatting, Ace Step is not a text‑to‑speech engine. It is a singing model. It will always prioritize:
- melodic phrasing  
- vowel smoothing  
- expressive delivery  

Literal fidelity can be maximized, not guaranteed.

---

## Summary Checklist
- One complete idea per line  
- No rhymes  
- No punctuation  
- No contractions  
- Distinct line openings  
- 10–14 syllables per line  
- Phonetic spellings for unstable words  
- Clear section headers  
- Moderate CFG  
- Moderate inference steps  
- Avoid semantic continuations  
- Avoid repeated rhythmic patterns  
- Keep style conditioning simple  

Following these guidelines will give Ace Step the highest chance of singing your lyrics exactly as written while still allowing expressive, musical performance.

