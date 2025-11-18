---
name: serena-symbol-navigator
description: Use Serena's symbol-aware tools (get_symbols_overview, find_symbol) instead of Read/Grep when exploring code. Triggers when user asks about code structure, classes, functions, or implementations.
---

# Serena Symbol Navigator

## When to Use Symbol Tools

**Instead of Read:** Use `get_symbols_overview(file_path)` first
- See class/function structure without reading entire file
- Returns symbol hierarchy (classes → methods → nested symbols)
- Much faster for understanding "what's in this file"

**Instead of Grep:** Use `find_symbol(name_path, relative_path)`
- Language-aware search for classes/functions/methods
- Returns precise locations + can include body
- Supports substring matching and depth traversal

## Common Patterns

**Exploring a new file:**
```
1. get_symbols_overview("path/to/file.py")  # See structure
2. find_symbol("ClassName", "path/to/file.py", depth=1)  # Get class methods
3. find_symbol("ClassName/method_name", include_body=True)  # Read specific method
```

**Finding symbol across codebase:**
```
find_symbol("FunctionName", substring_matching=True)  # Search all files
```

**Understanding usage:**
```
find_referencing_symbols("ClassName/method", "path/to/file.py")  # Who calls this?
```

## Key Advantages

- Token-efficient (don't read entire files)
- Language-aware (understands code structure)
- Precise refactoring (rename_symbol, replace_symbol_body)
- Cross-file navigation (find references)

## Remember

Only fall back to Read when:
- Reading non-code files
- Need to see full file context
- Symbol tools don't provide enough detail
