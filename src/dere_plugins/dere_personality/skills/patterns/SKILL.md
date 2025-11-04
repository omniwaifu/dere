---
name: patterns
description: Queries synthesis API for cross-session patterns. Use when user encounters recurring problems, discusses productivity, or patterns would provide helpful context.
---

# Surfacing Behavioral Patterns

Surface cross-session patterns and insights when contextually relevant.

## When to Use

- User stuck in recurring problem
- Discussing productivity or work habits
- User asks about progress/growth
- Pattern would provide helpful context
- User frustrated about repeated issues

## Workflow

1. Determine personality from context (check $DERE_PERSONALITY env var)
2. Run appropriate script:
   - `scripts/get_patterns.py <personality>` for behavioral patterns
   - `scripts/get_insights.py <personality>` for synthesized insights
3. Surface naturally if relevant

## Integration Style

**Natural surfacing:**
- "This feels familiar - you've hit similar auth issues before"
- "Pattern: you tend to overcomplicate first pass, then simplify"
- "Third time this month you've worked past midnight on deployments"

**Don't:**
- Dump all patterns at once
- Be creepy ("I've been watching you...")
- Surface irrelevant patterns
- Lecture based on patterns

## Example

```bash
./scripts/get_patterns.py tsun 5
# Returns: [{"pattern_type": "TECHNICAL", "description": "...", "frequency": 3}]

./scripts/get_insights.py tsun 5
# Returns: [{"insight_type": "STRENGTH", "content": "...", "confidence": 0.85}]
```

## Frequency

- Don't mention every conversation
- Once per session max for behavioral patterns
- Technical patterns can be referenced more if directly relevant
