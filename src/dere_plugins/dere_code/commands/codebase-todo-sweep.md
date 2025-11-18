---
description: Analyze codebase and insert TODO comments for code issues
allowed-tools: mcp__plugin_workforce-assistant_serena__*, Read, Edit, Grep, Glob, Bash
argument-hint: [scan|apply|clean] [path]
---

# Codebase TODO Sweep

Perform systematic code quality analysis to identify issues and optionally insert TODO comments.

## Arguments

- **Mode**: `$1` (required) - One of: `scan`, `apply`, `clean`
- **Path**: `$2` (optional) - Specific file or directory to analyze
- **Full args**: `$ARGUMENTS`

## Execution

### Mode: scan

If `$1` is "scan":

1. **Determine scope:**
   - If `$2` provided: analyze that path only
   - If no `$2`: analyze entire codebase
   - Skip: node_modules/, .git/, __pycache__/, venv/, dist/, build/

2. **Read stack information:**
   - Call `read_memory('project_overview')` to get project context including tech stack
   - Parse stack entries to extract libraries/frameworks (e.g., "react", "fastapi", "tailwind")
   - Store library list for stack-aware analysis
   - If no project_overview memory exists, skip stack-specific checks (continue with generic checks only)

3. **Query library best practices:**
   - For each library in stack:
     - Use `resolve-library-id(libraryName="<library>")` to get Context7 library ID
     - Query `get-library-docs` for topics: "best practices", "common mistakes", "security", "performance"
     - Cache results to avoid redundant queries
   - Skip this step if stack memory was not found

4. **Use Serena for efficient analysis:**
   - Call `get_symbols_overview` for each file to understand structure
   - Use `find_symbol` with `include_body=true` for detailed analysis
   - Apply heuristics to detect issues

5. **Issues to detect:**

   **Generic code quality:**
   - **Code smells**: Functions >50 lines, deep nesting (>4 levels), high complexity
   - **Missing docs**: Undocumented public functions/classes
   - **Stubs**: Functions with only `pass`, `...`, or `return None`
   - **Bad naming**: Single-letter variables (except i,j,k,x,y), unclear names
   - **Unimplemented**: Empty functions, `NotImplementedError`
   - **Contextual issues**: Patterns inconsistent with codebase

   **Stack-specific best practices** (if stack memory exists):
   - **Framework patterns**:
     - React: Missing dependencies in useEffect/useCallback/useMemo hooks
     - React: Missing key props in mapped components
     - Python: Missing async/await in async functions, improper coroutine usage
     - TypeScript: Missing return type annotations on functions
     - Go: Missing error handling checks, unused context.Context
   - **Library antipatterns**:
     - Deprecated API usage (check against library docs)
     - Inefficient patterns (e.g., N+1 queries in ORMs, unnecessary re-renders)
     - Misuse of library features (e.g., improper state management, wrong lifecycle)
   - **Security best practices**:
     - XSS vulnerabilities (unescaped user input in templates)
     - SQL injection risks (string concatenation in queries)
     - Auth bypass patterns (missing auth checks, insecure tokens)
     - CSRF vulnerabilities (missing tokens in forms)
     - Insecure crypto usage (weak algorithms, hardcoded keys)
   - **Performance optimizations**:
     - Blocking I/O in async code
     - Missing database indexes (for ORM models)
     - Unnecessary component re-renders (React)
     - Memory leaks (event listeners not cleaned up)
     - Inefficient algorithms (O(n²) where O(n log n) possible)

   **Moderate strictness**: Flag common pitfalls and clear violations; skip minor style issues

6. **Generate report:**
   ```
   # Code Quality Sweep Report

   Scope: [path or "entire codebase"]
   Stack: [libraries if stack memory exists, else "not configured"]
   Files analyzed: [count]
   Total issues: [count]

   ## Summary by Type

   **Generic Quality Issues:**
   - Code Smells: [count]
   - Missing Documentation: [count]
   - Stubs/Unimplemented: [count]
   - Confusing Code: [count]
   - Bad Naming: [count]

   **Stack-Specific Issues** (if stack memory exists):
   - Framework Patterns: [count]
   - Library Antipatterns: [count]
   - Security Best Practices: [count]
   - Performance Optimizations: [count]

   ## Stack-Specific Best Practices (if applicable)

   ### React ([count] issues)
   - Missing hook dependencies: [count]
   - Missing key props: [count]

   ### FastAPI ([count] issues)
   - Blocking I/O in async routes: [count]
   - Missing dependency injection: [count]

   [... repeat for each library in stack ...]

   ## Issues by File

   ### path/to/file.py ([count] issues)

   **[Type]** Line [num] - [symbol]
   - Issue: [description]
   - Would insert: `TODO(sweep): [comment]` or `TODO(sweep:stack): [Library] - [comment]`
   ```

7. **Save findings:**
   - Use `write_memory` with filename `todo-sweep-[timestamp].md`

### Mode: apply

If `$1` is "apply":

1. **Perform analysis** (same as scan mode steps 1-5)

2. **For each issue found:**
   - Determine comment type:
     - **Generic issues:**
       - `TODO(sweep):` - General improvements
       - `FIXME(sweep):` - Critical issues/broken functionality
       - `HACK(sweep):` - Code smells needing refactoring
       - `NOTE(sweep):` - Missing documentation
     - **Stack-specific issues:**
       - `TODO(sweep:stack):` - Framework patterns, library best practices
       - `FIXME(sweep:stack):` - Security vulnerabilities, critical antipatterns
       - `PERF(sweep:stack):` - Performance optimizations
       - Format: `TODO(sweep:stack): [Library] - [specific issue]`
       - Example: `TODO(sweep:stack): React - Missing dependency 'userId' in useEffect hook`

   - Determine insertion point:
     - Function issues: line before function definition
     - Code block issues: line before problematic block
     - Variable issues: line where variable defined

   - Format comment with language-appropriate syntax:
     - Python: `#`
     - JavaScript/TypeScript/C/C++/Rust/Go: `//`
     - HTML/XML: `<!-- -->`
     - CSS: `/* */`

   - Use `Edit` tool to insert comment
   - Check if `(sweep)` tag already exists at location (avoid duplicates)

3. **Generate summary:**
   ```
   # TODO Comments Applied

   Files modified: [count]
   Comments inserted: [count]

   ## Modified Files
   - path/to/file1.py: [count] comments
   - path/to/file2.py: [count] comments

   ## By Type

   **Generic:**
   - TODO(sweep): [count]
   - FIXME(sweep): [count]
   - HACK(sweep): [count]
   - NOTE(sweep): [count]

   **Stack-specific:**
   - TODO(sweep:stack): [count]
   - FIXME(sweep:stack): [count]
   - PERF(sweep:stack): [count]

   Search for "(sweep)" to find all marked issues.
   Search for "(sweep:stack)" to find stack-specific issues.
   ```

### Mode: clean

If `$1` is "clean":

1. **Find all sweep comments:**
   - Use `search_for_pattern` with regex: `(TODO|FIXME|HACK|NOTE|PERF)\(sweep(:[a-z]+)?\)`
   - This matches both `(sweep)` and `(sweep:stack)` tags
   - Search entire codebase (or `$2` if provided)

2. **Remove comments:**
   - For each match, use `Edit` tool to remove the entire comment line
   - Match exact indentation and whitespace

3. **Generate summary:**
   ```
   # Sweep Comments Removed

   Files cleaned: [count]
   Comments removed: [count]

   ## Cleaned Files
   - path/to/file1.py: [count] removed
   - path/to/file2.py: [count] removed
   ```

### Invalid mode or no arguments

If `$1` is not one of the valid modes or is empty:

```
Usage: /codebase-todo-sweep <mode> [path]

Modes:
  scan   - Analyze and report issues without modifying files
  apply  - Analyze and insert TODO comments into files
  clean  - Remove all sweep-generated TODO comments

Examples:
  /codebase-todo-sweep scan
  /codebase-todo-sweep apply src/
  /codebase-todo-sweep clean
```

## Detection Heuristics

### Function Length
```
Count non-empty, non-comment lines in function body
If > 50 lines:
  Flag as TODO(sweep): "Function too long, break into smaller functions"
```

### Missing Documentation
```
For each public function/class (not starting with _):
  If no docstring/comment before definition:
    Flag as NOTE(sweep): "Add docstring explaining purpose, params, return value"
```

### Stub Detection
```
If function body contains ONLY: pass, ..., or return None:
  Flag as FIXME(sweep): "Implement function logic or remove if not needed"
```

### Bad Naming
```
For variable names:
  If single letter (except i,j,k in loops, x,y for coordinates):
    Flag as TODO(sweep): "Rename to descriptive name"

For function names:
  If no verb in name:
    Flag as NOTE(sweep): "Function name should describe action (get_*, calculate_*, etc.)"
```

### Complexity
```
Count nesting depth of if/for/while/try blocks
If depth > 4:
  Flag as HACK(sweep): "Reduce nesting complexity, extract logic to functions"
```

## Stack-Aware Detection Heuristics

These heuristics are applied when `.serena/memories/project_overview` exists and contains stack information:

### React Patterns

```
Missing Hook Dependencies:
  For useEffect/useCallback/useMemo hooks:
    - Parse dependency array
    - Identify variables/props used in callback
    - Flag missing dependencies
    - Example: TODO(sweep:stack): React - Missing dependency 'userId' in useEffect hook

Missing Key Props:
  For .map() rendering arrays of components:
    - Check if key prop is present
    - Flag if missing or using index
    - Example: TODO(sweep:stack): React - Add unique key prop to mapped component
```

### Python Async Patterns

```
Improper Async/Await:
  For async def functions:
    - Check for blocking calls (time.sleep, requests.get, etc.)
    - Should use await asyncio.sleep(), await aiohttp...
    - Example: FIXME(sweep:stack): Python - Use 'await asyncio.sleep()' instead of 'time.sleep()'

Missing Await:
  For calls to async functions without await
    - Example: FIXME(sweep:stack): Python - Missing 'await' on async function call
```

### TypeScript Type Safety

```
Missing Return Types:
  For exported/public functions without return type annotation:
    - Flag as TODO(sweep:stack): TypeScript - Add explicit return type annotation

Any Type Usage:
  For variables/params typed as 'any':
    - Flag as TODO(sweep:stack): TypeScript - Replace 'any' with specific type
```

### SQL Injection Risks

```
String Concatenation in Queries:
  For SQL query construction:
    - Detect f-strings, + concatenation with variables
    - Flag as FIXME(sweep:stack): [Library] - SQL injection risk, use parameterized queries
    - Applies to: SQLAlchemy, Django ORM, raw SQL
```

### Performance Patterns

```
N+1 Query Detection:
  For ORM usage in loops:
    - Detect queries inside for/while loops
    - Flag as PERF(sweep:stack): [ORM] - N+1 query, use select_related/prefetch_related

Blocking I/O in Async:
  For async functions with blocking calls:
    - Detect time.sleep, requests.*, synchronous file I/O
    - Flag as PERF(sweep:stack): [Framework] - Blocking I/O in async function, use async alternative
```

### Security Patterns

```
XSS Vulnerabilities:
  For template rendering with user input:
    - Check for unescaped variables in HTML
    - React: dangerouslySetInnerHTML without sanitization
    - Example: FIXME(sweep:stack): React - XSS risk, sanitize user input before dangerouslySetInnerHTML

Weak Crypto:
  For cryptographic operations:
    - MD5/SHA1 for passwords → Flag as FIXME
    - Hardcoded secrets → Flag as FIXME
    - Example: FIXME(sweep:stack): [Library] - Use bcrypt/argon2 instead of MD5 for password hashing
```

## Important Notes

- Be conservative: only flag genuine issues
- Context matters: long test functions may be acceptable
- Avoid noise: skip autogenerated code, vendored dependencies
- Preserve formatting: match file's existing comment style and indentation
- Safety: verify Edit operations succeed before proceeding
- **Stack-aware checks**: Only run when `.serena/memories/project_overview` exists
- **Moderate strictness**: Flag common pitfalls, not minor style preferences
- **Context7 integration**: Use library docs to verify best practices before flagging
