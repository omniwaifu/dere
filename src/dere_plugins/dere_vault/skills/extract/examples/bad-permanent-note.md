# Bad Permanent Note Example

This demonstrates common anti-patterns in permanent notes.

```markdown
---
type: permanent
status: growing
created: 2025-01-15 10:00
updated: 2025-01-15 10:00
tags:
  - notes
  - interesting
---

# Notes on Software Development

Some interesting thoughts about software development I've been having.

Copy-pasted from article:
"Software development is both an art and a science. It requires creativity and analytical thinking. Good developers balance technical excellence with practical constraints."

I think this is really important. Also relates to:
- Testing
- Code review
- Documentation
- Architecture
- Team dynamics

Maybe I should write about design patterns too. And also about agile methodologies. Both seem important.

## Questions
- How do you write good code?
- What makes a good developer?
- Is TDD worth it?

## Sources
- Some article I read
- That book about programming
```

## Problems With This Note

### Not Atomic
- Multiple concepts bundled together
- Mixes testing, code review, documentation, architecture, team dynamics
- Should be 5+ separate notes

### Vague Title
- "Notes on Software Development" - too broad
- Not searchable - how would you find this?
- Title doesn't capture any specific concept

### Copy-Pasted Content
- Direct quote without attribution or understanding
- No synthesis or personal interpretation
- Doesn't demonstrate comprehension

### No Concrete Examples
- Abstract platitudes only
- No real-world instances
- No specific scenarios
- Can't apply this to actual decisions

### Poor Linking
- Zero links to other notes
- Bullet list mentions topics but doesn't link them
- Not integrated into knowledge base
- Orphaned note

### Missing Context
- When would you use this?
- What situations does this apply to?
- What scale or domain?

### No Implications
- Doesn't answer "so what?"
- No actionable insights
- No questions worth exploring
- No decisions informed

### Incomplete Sources
- "Some article" - no proper citation
- "That book" - which book?
- Can't verify or return to source
- No literature note reference

## How to Fix This

1. **Split into atomic notes**:
   - "Test Coverage vs Test Quality Trade-off"
   - "Code Review Feedback Patterns"
   - "Documentation as Design Tool"
   - "Architectural Decision Records"
   - "Team Psychological Safety in Code Review"

2. **Write specific titles** that capture exact concepts

3. **Remove quotes**, write in own words

4. **Add 2-3 concrete examples** for each concept

5. **Link to existing notes** on related concepts

6. **Define context** where each concept applies

7. **Explain implications** - what decisions does this inform?

8. **Cite properly** with [[Literature Note]] references
