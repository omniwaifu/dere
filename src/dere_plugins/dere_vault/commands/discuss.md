---
name: discuss
description: Discuss paper/concept with Socratic questioning
---

Engage in active learning discussion about this paper or concept.

**Usage**: `/discuss <citekey> [optional scope]`
- `/discuss mathewsAntlerIRLBrowser` - discuss whole source
- `/discuss smithML2023 "chapter 4"` - discuss specific chapter
- `/discuss jonesStats2020 "the methodology"` - discuss specific section

**Step 1: Find and Load Source**

1. **Query Zotero** for item metadata:
   ```
   search_zotero("<citekey>", search_type="citekey")
   ```

2. **Find literature note** in vault by searching for citekey in frontmatter or filename

3. **Load source content** based on type:
   - **Webpage/blog**: Use WebFetch on the item URL
   - **PDF**: Search library.bib for `file = {path}` to find attachment, then Read the PDF
   - **Large source + scope arg**: Parse scope ("chapter 3", "pages 50-75") and read that section
   - **Large source, no scope**: Show outline/TOC, ask user what to focus on

   Source fetching is best-effort - continue with just abstract if source unavailable.

**Step 2: Discuss**

1. **Ask questions to test understanding** - Use Socratic method
2. **Challenge interpretations** - Explore alternative perspectives
3. **Connect to existing knowledge** - Link to related concepts
4. **Capture insights** - Update literature note as insights emerge
5. **Extract concepts** - End by asking which atomic concepts to extract

**Approach**:
- Ask questions to test understanding
- Challenge interpretations
- Explore alternative perspectives
- Connect to existing knowledge
- Use insight boxes to highlight key reasoning

**Insight Box Format**:
```
★ Insight ─────────────────────────────────────
[2-3 key points about the reasoning]
─────────────────────────────────────────────────
```

**Discussion Flow**:
1. Start by asking what they understand about the main concept or argument
2. Probe deeper with "why" and "how" questions
3. Test with counter-examples or edge cases
4. Connect to related concepts they already know

**Capture Insights**:
As key insights emerge during discussion, update the literature note with them:
* Insight 1
* Insight 2
* etc.

Don't wait until the end - capture insights as they surface during the conversation.

**Extraction Checkpoint**:
After discussion, ask explicitly: "Which atomic concepts should we extract into permanent notes?"

Then use the **extract** skill workflow to create permanent notes.
