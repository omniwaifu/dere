---
name: Zettelkasten Permanent Notes
description: Create atomic, evergreen ideas that form the core knowledge graph. Use when extracting concepts from literature/daily notes or synthesizing original insights.
---

# Zettelkasten Permanent Notes

Create atomic permanent notes - one clear concept per note, densely linked, written in your own voice.

## When to Use

- User asks to "extract permanent notes" from literature/daily notes
- User wants to capture an insight or concept
- Synthesizing ideas from multiple sources
- Creating reusable knowledge from experience

## Purpose

Permanent notes are:
1. **Atomic** - One clear concept per note
2. **Autonomous** - Understandable without reading source
3. **Your thinking** - Written in your words
4. **Densely linked** - Connected to many concepts
5. **Evergreen** - Continuously refined

These represent YOUR understanding, not someone else's.

## Frontmatter (Required)

```yaml
---
type: permanent
status: [growing|mature|stable]
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags:
  - concept/[domain]
related:
  - "[[Closely Related Note 1]]"
  - "[[Closely Related Note 2]]"
sources:
  - "[[Literature Note 1]]"
  - "[[Daily Note YYYY-MM-DD]]"
---
```

### Status Definitions
- **growing** - New note, still developing
- **mature** - Well-developed, actively used
- **stable** - Well-established, infrequently changed

## Title (Critical)

The title IS the concept. Use clear, specific phrases:

**Good Titles:**
- "Emergence vs Engineered Capabilities"
- "Build vs Buy Decision Framework"
- "Minimal Predefinition Maximal Self-Evolution"
- "Trade-offs Between Control and Adaptation"

**Bad Titles:**
- "Thoughts on AI"
- "Notes on Decision Making"
- "Interesting Pattern"

Title should be **searchable** - when you think about this concept, you think these words.

## Structure

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

## The Atomicity Test

Ask: "If I had to delete all notes except one, would this make sense?"

If no → not atomic. Split or add context.

Note should be **standalone** - gains value from connections but doesn't require them.

## Workflow

### Extraction from Literature Notes
When user says "extract permanent notes from [[literature-note]]":

1. **Identify atomic concepts** - What are separable ideas?
2. **For each concept:**
   - Propose clear title (concept phrase)
   - Write core idea in user's voice
   - Find 2-3 concrete examples
   - Identify connections to existing notes
   - Explain implications

3. **Present proposal:**
   ```markdown
   From [[literature-note]], I identified:

   1. [[Proposed Title 1]]
      Core: [1-2 sentence summary]
      Connects to: [[note-1]], [[note-2]]

   2. [[Proposed Title 2]]
      Core: [1-2 sentence summary]
      Connects to: [[note-3]], [[note-4]]

   Should I create these?
   ```

4. **After approval, create with full structure**

### Extraction from Daily Notes
When reviewing daily notes:
1. Look for insights, realizations, connections
2. Ask: "Is this reusable beyond today?"
3. If yes → propose permanent note
4. Link daily note to permanent note

### Synthesis of Multiple Sources
Sometimes permanent notes combine ideas:

```markdown
## Sources
This synthesizes ideas from:
- [[Literature Note 1]] - contributed [aspect]
- [[Literature Note 2]] - contributed [aspect]
- [[Daily Note YYYY-MM-DD]] - my insight connecting them
```

### Refinement
When user references permanent note:
1. Read current version
2. Suggest improvements:
   - Missing examples
   - Unclear explanations
   - New connections
   - Better title if vague

Notes evolve as understanding deepens.

## Linking Strategies

### Types of Links

**"Builds On":**
Note A is foundational to Note B
Example: [[agent-architectures]] ← [[minimal-predefinition-maximal-self-evolution]]

**"Contrasts With":**
Opposing or complementary concepts
Example: [[emergence-vs-engineering]] ↔ [[control-vs-adaptation]]

**"Example Of":**
Note A illustrates concept in Note B
Example: [[alita-architecture]] → [[minimal-predefinition-maximal-self-evolution]]

**"Applies To":**
Note A useful in context of Note B
Example: [[build-vs-buy-framework]] → [[infrastructure-decisions]]

### Link Density
Aim for 5-10 links per note:
- Too few (<3) → orphaned
- Just right (5-10) → well-integrated
- Many (10+) → hub concept (consider creating overview note)

### Bidirectional Linking
When creating permanent note:
1. Link from new note to related notes
2. Update related notes to link back
3. Explicit links help navigation

## Note Evolution

### Growing → Mature
- Add examples as you encounter them
- Refine explanation as understanding deepens
- Add connections as you read more
- Clarify context as you apply idea

### Mature → Stable
- Well-established understanding
- Rich example set
- Many connections
- Infrequently needs updates

### Splitting Notes
If note grows too large or has multiple concepts:
1. Identify atomic concepts within
2. Create separate notes for each
3. Create hub note to link them
4. Update all related links

### Merging Notes
If two notes are same concept:
1. Combine into single note with better title
2. Redirect old note → new note
3. Update all linking notes

## Writing Style

### Voice
Explain to yourself in 6 months:
- Conversational but precise
- Assume intelligence, not memory
- Clear without condescending

### Length
Typically:
- Core idea: 1-3 paragraphs
- Total: 200-500 words
- If longer, consider splitting

### Formatting
- Use headings for structure
- **Bold** for key terms
- Bullet points for lists
- > blockquotes for important statements
- `code` for technical terms

## Quality Standards

### Good Permanent Notes
- **One clear concept** - Not a collection
- **Your voice** - Like explaining to friend
- **Specific enough to be useful**
- **General enough to be reusable**
- **Densely linked** - 5-10+ other notes
- **Example-rich** - Multiple concrete instances

### Red Flags
- Multiple unrelated concepts → split
- Copy-paste from source → rewrite
- Too abstract without examples → add specifics
- No links → find connections
- Reads like lecture → make conversational
- Vague title → make concept-specific

## Example Structure

```markdown
---
type: permanent
status: mature
created: 2025-10-14
tags:
  - concept/design-philosophy
  - ai/agents
---

# Minimal Predefinition Maximal Self-Evolution

The principle that systems should start with minimal built-in capabilities and develop most functionality through self-generated tools and adaptations.

## Core Idea

Traditional systems: design everything upfront → limited to designer's imagination
This approach: provide core capabilities → system creates what it needs → unbounded potential

Trade-off is control (predefined) vs creativity (evolved).

## Context

Applies to:
- AI agent architectures
- Software frameworks
- Organizational structures

Particularly valuable when:
- Problem space is large/unknown
- Requirements evolve frequently
- Creativity matters more than consistency

## Examples

1. **Alita Agent**: Core reasoning + tool generation vs pre-built toolkit
2. **Unix Philosophy**: Simple tools + composition vs monolithic apps
3. **Startup Methodologies**: Lean startup vs waterfall planning

## Connections

Relates to [[emergence-vs-engineering]] - specific application of that principle.
Contrasts with [[zero-trust-security]] - where you DO want everything predefined.
Trade-offs in [[control-vs-adaptation-spectrum]].

## Implications

When designing systems, ask:
- What MUST be predefined?
- What SHOULD emerge?
- What's the cost of getting this wrong?

## Sources
- [[alita-paper-literature-note]]
- [[daily-2025-10-14]] - my synthesis

## Related
- [[emergence-vs-engineering]]
- [[unix-philosophy]]
- [[agent-architectures-moc]]
```

Remember: The goal is not collecting notes, but developing YOUR thinking. Every permanent note should be a reusable piece of your intellectual toolkit.
