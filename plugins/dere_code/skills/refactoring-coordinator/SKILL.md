---
name: safe-refactoring-workflow
description: Execute safe refactorings using Serena symbol tools. Enforces Find → Verify → Refactor → Test pattern.
---

# Safe Refactoring

## Pattern: Find → Verify → Refactor → Test

1. `find_symbol("OldName", include_body=False)` - locate target
2. `find_referencing_symbols("OldName", "file.py")` - understand blast radius
3. Execute refactor:
   - `rename_symbol("OldName", "file.py", "NewName")`
   - `replace_symbol_body("Class/method", "file.py", new_body)`
   - `insert_after_symbol("Class", "file.py", new_code)`
4. Run tests to verify

## Rules

- Check references before renaming
- Never refactor without verification
- Symbol tools are reliable - trust them
- Serena refactoring > regex-based Edit for structure changes
