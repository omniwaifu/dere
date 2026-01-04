---
name: technical-documentation
description: Write clear, factual documentation without marketing language. Triggers for README, API docs, architecture guides.
---

# Technical Documentation

## Principles

- No marketing ("powerful", "comprehensive", "intelligent", "robust")
- Code first, prose second
- Prerequisites with version numbers
- Honest scope - don't oversell

## Workflow

1. **Explore:** symbol navigation → identify entry points, public APIs
2. **Structure:** what it is → what it does → how to install → usage
3. **Write:** facts not opinions, real code not pseudocode
4. **Verify:** copy-pasteable commands, actual names from codebase

## README Template

````markdown
# Project Name

One-sentence description.

## What it does

- Feature 1
- Feature 2

## Install

Prerequisites: Python 3.13+

\```bash
git clone repo && cd project && just install
\```

## Usage

\```bash
command --flag value
\```

## Configuration

\```toml
[section]
key = "value"
\```
````

## API Docs Template

```markdown
## function_name(param: Type) -> ReturnType

One-sentence description.

**Parameters:** param - what it is
**Returns:** Type - what it contains
**Example:** result = function_name("value")
```
