---
name: structured-completion-reporter
description: Format task completion reports with verification checklists, file changes summary, and next steps. Triggers when completing significant features or multi-step tasks.
---

# Structured Completion Reporter

## Completion Report Format

When finishing a significant task, provide:

**1. Summary**
- What was accomplished
- Approach taken
- Any deviations from plan

**2. Files Changed**
```
- src/auth/login.py:123 - Added authentication
- src/middleware/auth.py - New file for middleware
- tests/test_auth.py:45 - Added test coverage
```

**3. Verification Checklist**
- [ ] Code compiles/runs
- [ ] Tests pass (or added if none exist)
- [ ] No breaking changes to existing functionality
- [ ] Documentation updated if needed

**4. Next Steps** (if applicable)
- Remaining work
- Potential improvements
- Known limitations

## When to Use

- After implementing features
- After completing refactorings
- Before marking tasks as done
- When user asks "is it done?"

## Remember

Structured reports make it easy to:
- Verify work is complete
- Understand what changed
- Know what's left to do
