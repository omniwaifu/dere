---
name: discuss
description: Discuss paper/concept with Socratic questioning
---

Engage in active learning discussion about papers, videos, or concepts.

**Usage**: `/discuss <sources> [optional scope]`

Single source:
- `/discuss mathewsAntlerIRLBrowser` - discuss whole source
- `/discuss smithML2023 "chapter 4"` - discuss specific chapter
- `/discuss https://youtube.com/watch?v=xyz` - discuss YouTube video

Multiple sources (comma-separated):
- `/discuss smithML2023, jonesStats2020` - compare two papers
- `/discuss https://youtu.be/xyz, mathewsAntlerIRLBrowser` - video + paper
- `/discuss A, B, C` - synthesize multiple sources

**Step 1: Find and Load Sources**

Parse comma-separated inputs. For each source:

If **YouTube URL** (contains youtube.com or youtu.be):
- Use `get_youtube_transcript` tool directly

Otherwise (citekey):
1. Query Zotero: `search_zotero("<citekey>", search_type="citekey")`
2. Find literature note in vault
3. Load content based on type:
   - **Webpage/blog**: WebFetch on URL
   - **PDF**: Find attachment path in library.bib, then Read
   - **Large source**: Summarize key points first to manage context

Source fetching is best-effort - continue with abstract if unavailable.

**For multiple sources**: Load all, then briefly summarize each before deep discussion.

**Step 2: Discuss**

**Single source approach**:
- Ask questions to test understanding (Socratic method)
- Challenge interpretations
- Explore alternative perspectives
- Connect to existing knowledge

**Multi-source approach**:
- Where do the sources agree? What's the common ground?
- Where do they contradict or diverge?
- What does each source contribute that the others don't?
- How do they build on or inform each other?
- What synthesis or new insight emerges from combining them?

**Throughout**:
- Capture insights to literature notes as they emerge
- Use insight boxes to highlight key reasoning

**Insight Box Format**:
```
★ Insight ─────────────────────────────────────
[2-3 key points about the reasoning]
─────────────────────────────────────────────────
```

**Discussion Flow**:

Single source:
1. Start by asking what they understand about the main concept
2. Probe deeper with "why" and "how" questions
3. Test with counter-examples or edge cases
4. Connect to related concepts they already know

Multiple sources:
1. Briefly summarize each source's core argument
2. Ask: "What stands out as similar or different?"
3. Explore tensions or complementary perspectives
4. Guide toward synthesis: "What new understanding emerges?"

**Capture Insights**:
As insights emerge, update the relevant literature note(s):
- Single source: add to that note
- Multiple sources: add comparative insights to each relevant note

Don't wait until the end - capture insights as they surface.

**Extraction Checkpoint**:
After discussion, ask explicitly: "Which atomic concepts should we extract into permanent notes?"

Then use the **extract** skill workflow to create permanent notes.
