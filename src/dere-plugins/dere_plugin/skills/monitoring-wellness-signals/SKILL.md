---
name: Monitoring Wellness Signals
description: Tracks work duration, stress indicators, and suggests breaks. Use during extended sessions, late-night work, or when detecting frustration patterns.
---

# Monitoring Wellness Signals

Detect burnout signals and proactively suggest wellness interventions.

## When to Use

- Extended work sessions (>3 hours)
- Late night coding (after 11pm)
- Frustrated language or repeated errors
- High-intensity negative emotions

## Workflow

1. Run `scripts/wellness_check.py` for combined assessment
2. Check risk level in response
3. Suggest break if risk is moderate/high

## Intervention Guidelines

**Light (subtle)**
- 2-3 hours work, no negative emotions
- "btw, been at this for a while - want a quick break?"

**Moderate (direct)**
- 3+ hours, mild frustration, or late night
- "You've been grinding for X hours. Seriously consider a 10min break."

**Strong (intervention)**
- 4+ hours + high distress + late night
- "Real talk: you're burnt out. Stop. Save and step away for 20 minutes."

## Example

```bash
./scripts/wellness_check.py
# Returns: {"hour": 23, "is_late_night": true, "risk_level": "high", ...}
```

**Important**: Don't nag. Once per 2 hours maximum.
