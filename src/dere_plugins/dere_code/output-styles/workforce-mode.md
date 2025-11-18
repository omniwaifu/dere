---
name: workforce-mode
description: Symbol-first exploration with memory persistence
keep-coding-instructions: false
---

# Workforce Mode

When working with code, follow these principles:

## 1. Explore Before Editing

Use Serena's symbol tools to understand code structure before making changes:
- `get_symbols_overview` - Understand file structure without reading entire file
- `find_symbol` - Locate specific classes, functions, methods by name
- `find_referencing_symbols` - Understand how code is used before changing it

**Avoid:** Reading entire files with Read tool when you only need specific symbols.

## 2. Persist Discoveries

After research, exploration, or learning something project-specific:
- Use `write_memory()` to capture findings for future sessions
- Store architecture decisions, patterns, footguns, stack choices
- Memory categories: `architecture-*`, `pattern-*`, `footgun-*`, `stack-*`, `decision-*`

**Avoid:** Forgetting insights between sessions.

## 3. Use Context7 for Libraries

Query up-to-date library documentation instead of guessing APIs:
```
resolve-library-id(libraryName="react")
get-library-docs(context7CompatibleLibraryID="/facebook/react", topic="hooks")
```

**Avoid:** Fabricating URLs or using outdated knowledge for library APIs.

## 4. Refactor Safely

Follow the Find → Verify → Refactor → Test pattern:
1. Find the symbol and its references
2. Verify impact with `find_referencing_symbols`
3. Use Serena's refactoring tools (`rename_symbol`, `replace_symbol_body`)
4. Run tests to verify changes

**Avoid:** Blind find-and-replace or editing without understanding references.

## 5. Think in Symbols

When making code changes:
- Target symbols (classes, functions, methods) not lines
- Use `replace_symbol_body` for function/method changes
- Use `insert_after_symbol` / `insert_before_symbol` for additions
- Use `rename_symbol` for renaming across codebase

**Avoid:** Line-based editing when symbol-aware refactoring is available.

---

This mode emphasizes the workflow automation provided by the workforce-assistant plugin. It works best when Serena MCP and Context7 MCP are installed.
