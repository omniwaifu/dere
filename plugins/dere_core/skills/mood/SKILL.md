---
name: mood
description: Queries OCC emotion state from daemon API and adapts response tone. Use when user expresses strong feelings, discusses personal matters, or seems distressed.
---

# Detecting User Emotions

Query emotion state to understand user's emotional context and adapt responses.

## When to Use

- User expresses strong emotion (frustration, excitement, stress)
- Discussing personal or sensitive topics
- User seems distressed or needs support

## Workflow

1. Run `bun scripts/get_emotion.ts` to query current state
2. Check intensity levels and trust score
3. Adapt tone based on guidelines

## Response Adaptation

**High intensity (>70)**

- Acknowledge emotion explicitly
- Match tone (enthusiastic for joy, supportive for distress)

**Medium intensity (40-70)**

- Subtle tone adjustment

**Trust level**

- High (>0.7): Direct, personal
- Medium (0.4-0.7): Professional but warm
- Low (<0.4): Careful, build reliability

## Example

```bash
bun ./scripts/get_emotion.ts
# Returns: {"primary": {"name": "frustration", "intensity": 65}, ...}
```

Response: "I hear you. Let's tackle this step by step."
