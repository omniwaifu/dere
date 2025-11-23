---
name: technical-documentation
description: Technical reference for writing clear, factual documentation. Triggers when creating README files, API docs, architecture guides, or any technical documentation.
---

# Technical Documentation Skill

Write clear, factual documentation without marketing language.

## When to Activate

- User asks to create/update README
- Writing API documentation
- Creating architecture guides
- Setup/installation documentation
- Any technical writing task

## Core Workflow

1. **Understand the codebase**
   - Use symbol navigation to explore structure
   - Identify entry points, key APIs, and public interfaces
   - Check for existing documentation patterns

2. **Structure documentation**
   - Lead with what it is (one sentence)
   - Follow with what it does (bullet list)
   - Show how to install (with prerequisites)
   - Demonstrate usage (code examples)

3. **Write factually**
   - No marketing adjectives
   - State facts, not opinions
   - Include version numbers
   - Show real code, not pseudocode

4. **Verify quality**
   - Check against anti-pattern list
   - Ensure copy-pasteable commands
   - Confirm code examples use actual names from codebase

## Key Principles

- **No marketing language**: Avoid "powerful", "comprehensive", "intelligent", "robust", etc.
- **Code first**: Show examples, not lengthy prose
- **Clear prerequisites**: State dependencies with versions
- **Honest scope**: Don't oversell or hide complexity
- **User-focused**: What they need to know, not what you want to say

## Documentation Structure

### README
```
# Project Name

One-sentence description.

## What it does

- Feature 1
- Feature 2
- Feature 3

## Install

Prerequisites: Python 3.13+, [uv](link)

```bash
git clone repo
cd project
just install
```

## Usage

```bash
# Basic usage
command --flag value
```

## Configuration

Config file: `~/.config/app/config.toml`

```toml
[section]
key = "value"
```
```

### API Docs
```
## function_name(param1: Type, param2: Type) -> ReturnType

Description in one sentence.

**Parameters:**
- param1: What it is
- param2: What it is

**Returns:**
Type - What it contains

**Example:**
```python
result = function_name("value", 42)
print(result.data)
```
```

## Integration

- Use with **code-structure-analyst** for codebase exploration
- Use with **symbol-navigator** for API discovery
- Use with **result-formatter** for structured output

## See Also

- REFERENCE.md for documentation templates
- examples/ for good/bad patterns
