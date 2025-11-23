# Example: Creating Literature Note from Zotero Database

User: "I just read Aaronson's complexity paper. Create a literature note."

## Step 1: Query Zotero Database

```bash
cd ~/vault
../path/to/tools/zotlit-create.py --author "Aaronson" --title "Computational Complexity"
```

This queries `~/Zotero/zotero.sqlite` directly and generates a formatted note.

## Step 2: Tool Output

```
Found 1 match:
1. Why Philosophers Should Care About Computational Complexity (2011) - Aaronson, Scott

Created: Sources/Aaronson - Why Philosophers Should Care About Computational C (2011).md
Logged to daily note: Journal/2025-11-23.md
```

## Step 3: Generated Note Structure

The tool creates `Sources/Aaronson - Why Philosophers Should Care About Computational C (2011).md`:

```markdown
---
title: "Why Philosophers Should Care About Computational Complexity"
authors: Aaronson, Scott
year: 2011
url: http://arxiv.org/abs/1108.1791
doi: 10.48550/arXiv.1108.1791
tags:
  - Computer Science - Computational Complexity
  - Quantum Physics
date: 2025-11-23
---

# Why Philosophers Should Care About Computational Complexity

## Metadata
- **Authors**: Aaronson, Scott
- **Year**: 2011
- **URL**: http://arxiv.org/abs/1108.1791
- **DOI**: 10.48550/arXiv.1108.1791

## Abstract
One might think that, once we know something is computable...

## Key Concepts
-

## Quotes & Notes


## Connections
-

## References
**Attachments**:
- storage:Aaronson - 2011 - Why Philosophers Should Care About Computational Complexity.pdf
```

## Step 4: Daily Note Logging

The tool automatically appends to `Journal/2025-11-23.md`:

```markdown
# 2025-11-23

## Reading
- [[Aaronson - Why Philosophers Should Care About Computational C (2011)]]
```

## Alternative Quick Search

For a simple query:

```bash
zotlit-create.py "Computational Complexity"
```

Searches titles only. If multiple matches, presents an interactive picker.

## Comparison to BibTeX Workflow

**Zotero SQLite** (zotlit-create.py):
- Pros: Full metadata, abstracts, attachments, tags from Zotero
- Cons: Requires Zotero installed with database

**BibTeX** (bib-lookup.py):
- Pros: Lightweight, works with exported library.bib
- Cons: Limited metadata, no attachments or abstracts

**Recommendation**: Use zotlit-create.py if Zotero database exists, fallback to bib-lookup.py if only library.bib is available.
