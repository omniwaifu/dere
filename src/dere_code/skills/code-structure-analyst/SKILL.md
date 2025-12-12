---
name: systematic-codebase-explorer
description: Use Serena's onboarding system for systematic codebase exploration. Triggers when analyzing unfamiliar codebases, understanding architecture, or creating project documentation.
---

# Systematic Codebase Explorer

## The Onboarding-First Approach

When encountering a new codebase, use Serena's built-in onboarding workflow instead of ad-hoc exploration:

**1. Run Onboarding**
```
mcp__plugin_workforce-assistant_serena__onboarding()
```

**What it creates:**
- `architecture_overview` - Key components, patterns, entry points
- `code_style` - Conventions, naming patterns, structure
- `suggested_commands` - How to build, test, run

**2. Use Memories for Future Sessions**
```
list_memories()
read_memory("architecture_overview")
```

## Exploration Pattern: Overview → Symbol → Targeted Reading

**Start broad:**
```
list_dir(".", recursive=False)  # See top-level structure
```

**Get symbol overview:**
```
get_symbols_overview("src/main.py")  # See classes/functions
```

**Dive into specifics:**
```
find_symbol("MainClass", depth=1)  # See methods
find_symbol("MainClass/important_method", include_body=True)  # Read implementation
```

## Remember

- Onboarding creates reusable knowledge
- Overview before details
- Symbol tools before full file reads
- Document discoveries with `write_memory()`
