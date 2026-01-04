---
name: discuss
description: Discuss paper/concept with Socratic questioning
---

Engage in active learning discussion about sources.

**Usage**: `/discuss <sources> [optional scope]`

Examples:

- `/discuss smithML2023` - whole paper
- `/discuss smithML2023 "chapter 4"` - specific section
- `/discuss https://youtube.com/watch?v=xyz` - video
- `/discuss A, B, C` - compare multiple sources

## Step 1: Load Sources

For each comma-separated source:

- **YouTube URL**: Use `get_youtube_transcript` tool
- **Citekey**: `search_zotero("<citekey>", search_type="citekey")` → find literature note → load content (WebFetch for URL, Read for PDF)

Best-effort: continue with abstract if full content unavailable.

## Step 2: Discuss

**Single source:**

1. Ask what they understand about main concept
2. Probe with "why" and "how" questions
3. Test with counter-examples or edge cases
4. Connect to related concepts

**Multiple sources:**

1. Briefly summarize each source's core argument
2. Where do they agree/diverge?
3. What does each uniquely contribute?
4. What synthesis emerges?

**Throughout:**

- Capture insights to literature notes as they emerge
- Use insight boxes for key reasoning:

```
★ Insight ─────────────────────────────────────
[2-3 key points]
─────────────────────────────────────────────────
```

## Step 3: Extract

After discussion: "Which atomic concepts should we extract into permanent notes?"

Then use **extract** skill workflow.
