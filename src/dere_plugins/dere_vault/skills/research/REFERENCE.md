# Research Reference

Technical specifications for cross-vault research, Hubs, and synthesis.

## Search Techniques

### Tag-Based Search
```
tag:#concept
tag:#source/paper
tag:#project/dere
```

### Link-Based Search
Find notes linking to concept:
```
[[Concept Name]]
```

### Content Search
Full-text search for phrases, use with caution (links > search).

### Orphan Detection
Notes with few or no links:
- Check backlinks
- Review outgoing links
- Target: minimum 3 links per note

## Hub Structure

### When to Create Hub
- 10+ notes on same topic
- Dense connection cluster
- Recurring research area

### Hub Frontmatter
```yaml
---
type: hub
created: YYYY-MM-DD HH:MM
updated: YYYY-MM-DD HH:MM
tags:
  - hub
  - topic-area
---
```

### Hub Template

```markdown
# Hub: [Topic Area]

## Overview
2-3 paragraph introduction to topic area and why it matters.

## Core Concepts
Key permanent notes that define this area:
- [[Fundamental Concept 1]]
- [[Fundamental Concept 2]]

## Related Concepts
Supporting or adjacent ideas:
- [[Related Concept A]]
- [[Related Concept B]]

## Applications
Real-world uses and examples:
- [[Application Example 1]]
- [[Application Example 2]]

## Sources
Key literature notes:
- [[Source - Title (Year)]]
- [[Source - Title (Year)]]

## Open Questions
What's not yet understood:
- Question 1
- Question 2

## Related Hubs
- [[Hub/Adjacent-Topic]]
- [[Hub/Broader-Topic]]
```

## Project Note Structure

### Frontmatter
```yaml
---
type: project
status: [planning|active|paused|complete|archived]
created: YYYY-MM-DD HH:MM
updated: YYYY-MM-DD HH:MM
tags:
  - project
  - domain-tag
---
```

### Template

```markdown
# Project: [Name]

## Status
Current state and next steps.

## Scope
What this project includes and excludes.

## Technical Decisions
Key choices and rationale:

### Decision: [Choice Made]
- **Context**: Why this decision was needed
- **Options Considered**: Alternatives evaluated
- **Choice**: What was decided
- **Rationale**: Why this choice
- **Trade-offs**: What was sacrificed
- **See**: [[Related Concept]] for framework

## Implementation Notes
Technical details, code references, configurations.

## Related Notes
- Concepts applied: [[Concept 1]], [[Concept 2]]
- Sources referenced: [[Source Note]]
- Related projects: [[Project/Other]]

## Learnings
What was discovered during this project (extract to permanent notes):
- Insight 1
- Insight 2

## Blockers
Current obstacles and dependencies.
```

## Tech Note Structure

### Frontmatter
```yaml
---
type: technical
created: YYYY-MM-DD HH:MM
updated: YYYY-MM-DD HH:MM
tags:
  - language/framework
---
```

### Template

```markdown
# Tech: [Technology Name]

## Summary
1-2 sentence description of what this is.

## Use Cases
When to use this technology:
- Scenario 1
- Scenario 2

## Avoid When
When NOT to use this:
- Anti-pattern 1
- Anti-pattern 2

## Trade-offs

### Strengths
- Advantage 1
- Advantage 2

### Weaknesses
- Limitation 1
- Limitation 2

### Alternatives
- [[Tech/Alternative-A]]: Better for X
- [[Tech/Alternative-B]]: Better for Y

## Implementation Notes
Practical details:
- Setup
- Configuration
- Gotchas

## Related Concepts
Links to permanent notes:
- [[Build vs Buy Decision Framework]]
- [[Trade-offs Between X and Y]]

## Sources
- [[Source - Title (Year)]]
- Official docs: [URL]

## Decision
If evaluating: record decision and rationale.

## Experience Notes
Lessons from actual use (extract to permanent notes if generalizable).
```

## Synthesis Note Structure

When combining insights from multiple sources:

```markdown
# [Synthesized Concept]

## Synthesis
How different sources contribute to understanding:

**From [[Source A]]:**
- Key idea 1

**From [[Source B]]:**
- Key idea 2

**From [[Daily Note]]:**
- Personal insight

**Combined Understanding:**
Novel insight from synthesis.

[Continue with standard permanent note structure]
```

## Gap Analysis

When researching topic and finding gaps:

```markdown
## Coverage Analysis
- What vault contains: [summary]
- What's well-developed: [[Hub/Area]]
- What's missing:
  - Gap 1
  - Gap 2
- Suggested actions:
  - [ ] Research [topic]
  - [ ] Read [[Source]]
  - [ ] Create note on [concept]
```
