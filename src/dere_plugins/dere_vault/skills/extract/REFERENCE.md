# Extract Reference

Technical specifications for permanent (evergreen) notes and concept extraction.

## Frontmatter Schema

```yaml
---
type: permanent
status: [growing|mature|stable]
created: YYYY-MM-DD HH:MM
updated: YYYY-MM-DD HH:MM
tags:
  - concept
  - domain-tag
related:
  - "[[Related Concept 1]]"
  - "[[Related Concept 2]]"
sources:
  - "[[Source Note]]"
  - "[[Daily Note YYYY-MM-DD]]"
---
```

### Status Levels
- **growing** - New note, actively developing
- **mature** - Established, occasionally updated
- **stable** - Well-established, infrequently changed

## Title Guidelines

Title IS the concept. Use clear, specific phrases.

### Good Titles
- "Emergence vs Engineered Capabilities"
- "Build vs Buy Decision Framework"
- "Minimal Predefinition Maximal Self-Evolution"
- "Trade-offs Between Control and Adaptation"

### Bad Titles
- "Thoughts on AI" (too vague)
- "Notes on Decision Making" (not a concept)
- "Interesting Pattern" (meaningless)

**Test**: When you think about this concept, do you think these exact words?

## Note Structure

### Core Idea (Required)
1-3 paragraphs explaining concept in YOUR words.

Must be:
- Clear enough to understand in 6 months
- Standalone (doesn't require reading source)
- Specific (not generic truisms)

### Context (Where This Applies)
When is this relevant?
- What domains?
- What situations?
- What problems?
- What scale?

### Examples (Concrete)
Abstract concepts need concrete examples:
- Real-world instances
- Your experiences
- Historical examples
- Hypothetical but specific scenarios

**Minimum 2 examples**. More is better.

### Connections (How This Relates)
Zettelkasten magic happens here:
- What concepts does this build on?
- What concepts build on this?
- What contrasts with this?
- What tensions or trade-offs?

Write in prose, not just bullets. Explain relationships.

### Implications (So What?)
Why does this matter?
- What does this help you understand?
- What decisions does this inform?
- What actions does this suggest?
- What questions does this raise?

### Sources (Attribution)
Where did this idea originate?
- [[Literature Notes]] you extracted from
- [[Daily Notes]] where you developed it
- Your synthesis if combining sources

### Related Notes (Links)
Explicit links to:
- Similar concepts
- Contrasting concepts
- Applications
- Examples
- Hubs this belongs in

## Linking Types

### Build-On Links
`This concept builds on [[foundation-concept]]`

### Contrast Links
`Contrasts with [[opposing-concept]] by...`

### Application Links
`Applied in [[domain]] for [[purpose]]`

### Example Links
`See [[concrete-example]] for instance`

### Hub Links
`Part of [[Hub/Topic-Area]]`

## Atomicity Test

**Ask**: "If I had to delete all notes except one, would this make sense?"

If no → not atomic. Split or add context.

Note should be **standalone** - gains value from connections but doesn't require them.

## Quality Checklist

**Good permanent note:**
- [ ] Single focused concept
- [ ] Standalone understanding
- [ ] 3+ links to other notes
- [ ] 2+ concrete examples
- [ ] Written in own words
- [ ] Clear, searchable title
- [ ] Explains implications
- [ ] Cites sources

**Bad permanent note:**
- [ ] Multiple concepts bundled
- [ ] Requires source to understand
- [ ] Orphaned (no links)
- [ ] Abstract without examples
- [ ] Copy-pasted content
- [ ] Vague title
- [ ] No "so what?"
- [ ] No attribution

## Link Density Guidelines

- **Minimum**: 3 outgoing links
- **Healthy**: 5-10 outgoing links
- **Rich**: 10+ outgoing links

Low link density = concept not integrated into knowledge base.
