# Zotero BibTeX Lookup Example

Example workflow for creating literature notes with automatic metadata from Zotero's library.bib file.

## Scenario

User wants to create a literature note for Scott Aaronson's paper "Why Philosophers Should Care About Computational Complexity" already in their Zotero library.

## Workflow

### Step 1: Search library.bib

```bash
grep -i -A 20 "title = {.*Philosophers.*Complexity" library.bib
```

### Step 2: Extract BibTeX Entry

```bibtex
@misc{aaronsonWhyPhilosophersShould2011,
  title = {Why {{Philosophers Should Care About Computational Complexity}}},
  author = {Aaronson, Scott},
  year = 2011,
  month = aug,
  doi = {10.48550/arXiv.1108.1791},
  urldate = {2025-06-06},
  abstract = {One might think that, once we know something is computable, how efficiently it can be computed is a practical question with little further philosophical importance. In this essay, I offer a detailed case that one would be wrong. In particular, I argue that computational complexity theory -- the field that studies the resources (such as time, space, and randomness) needed to solve computational problems -- leads to new perspectives on the nature of mathematical knowledge, the strong AI debate, computationalism, the problem of logical omniscience, Hume's problem of induction, Goodman's grue riddle, the foundations of quantum mechanics, economic rationality, closed timelike curves, and several other topics of philosophical interest.},
  keywords = {Computer Science - Computational Complexity,Quantum Physics}
}
```

### Step 3: Create Literature Note with Auto-Populated Frontmatter

```markdown
---
type: literature
status: draft
created: 2025-11-23 05:30
updated: 2025-11-23 05:30
source: https://arxiv.org/abs/1108.1791
author: Scott Aaronson
title: Why Philosophers Should Care About Computational Complexity
date_published: 2011-08
date_accessed: 2025-11-23
citekey: aaronsonWhyPhilosophersShould2011
doi: 10.48550/arXiv.1108.1791
tags:
  - source/paper
  - complexity-theory
  - philosophy
related:
  - "[[Computational Complexity Theory]]"
  - "[[Philosophy of Computation]]"
---

# Why Philosophers Should Care About Computational Complexity (2011)

## Summary

Aaronson argues that computational complexity theory has profound philosophical implications beyond mere efficiency questions. The paper demonstrates how complexity theory provides new perspectives on mathematical knowledge, AI capabilities, computationalism, logical omniscience, induction problems, quantum mechanics foundations, and economic rationality.

## Key Ideas

1. **Complexity as Philosophical Tool**
   - Computational complexity isn't just engineering - it illuminates fundamental questions
   - Resources (time, space, randomness) matter philosophically, not just practically
   - Efficiency bounds reveal what's possible vs impossible for bounded agents

2. **Knowledge and Omniscience**
   - Logical omniscience problem: agents can't instantaneously derive all implications
   - Complexity theory formalizes bounded rationality
   - P vs NP captures difficulty of verification vs discovery

3. **Strong AI and Computationalism**
   - Complexity considerations affect what "computation" means for mind
   - Not just "is mind computational?" but "what complexity class?"
   - Quantum computation opens new possibilities

## My Thoughts

This bridges computer science and philosophy elegantly. The logical omniscience point is particularly compelling - traditional epistemology assumes agents can instantly derive consequences, but complexity theory shows why this is unrealistic. The connection to quantum mechanics through computational complexity is unexpected and worth exploring further.

## Applications

- Understanding limits of AI systems (complexity bounds)
- Formal models of bounded rationality in economics
- Philosophy of mind (computational theories)
- Epistemology (realistic models of knowledge)

## Follow-up

- [ ] Create permanent note on [[Logical Omniscience Problem]]
- [ ] Extract concept: [[P vs NP as Philosophical Question]]
- [ ] Link to existing [[Computationalism]] note
- [ ] Explore quantum complexity connection
```

## Benefits of This Workflow

1. **No manual metadata entry** - extracted from library.bib
2. **Consistent citekeys** - matches Zotero
3. **Access to abstract** - helps with summary writing
4. **Keywords available** - suggests tags
5. **DOI included** - proper academic citation

## Fallback

If entry not in library.bib:
- Create note with manual metadata
- Add TODO to import into Zotero
- Continue with standard workflow
