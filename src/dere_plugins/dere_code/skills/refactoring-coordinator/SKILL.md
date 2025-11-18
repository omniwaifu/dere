---
name: safe-refactoring-workflow
description: Execute safe, verified refactorings using Serena's symbol tools. Enforces Find → Verify → Refactor → Test pattern. Triggers when renaming symbols, restructuring code, or making breaking changes.
---

# Safe Refactoring Workflow

## The Pattern: Find → Verify → Refactor → Test

**1. Find the Symbol**
```
find_symbol("OldClassName", include_body=False)
# Verify you found the right symbol before proceeding
```

**2. Verify Impact**
```
find_referencing_symbols("OldClassName", "path/to/file.py")
# See ALL places that will be affected
# Understand the blast radius
```

**3. Execute Refactor**
```
# For renames:
rename_symbol("OldClassName", "path/to/file.py", "NewClassName")

# For body changes:
replace_symbol_body("ClassName/method", "path/to/file.py", new_body)

# For insertions:
insert_after_symbol("ClassName", "path/to/file.py", new_method_code)
```

**4. Verify Success**
```
# Run tests if available
# Check that references updated correctly
```

## Available Refactoring Tools

- `rename_symbol` - Renames across entire codebase
- `replace_symbol_body` - Replace method/function/class body
- `insert_after_symbol` - Add new symbol after existing one
- `insert_before_symbol` - Add new symbol before existing one

## Safety Rules

- ALWAYS check references before renaming
- NEVER refactor without verification
- Symbol tools are reliable - trust them
- Test after refactoring when possible

## Remember

Serena's symbolic refactoring is safer than regex-based Edit tool for code structure changes.
