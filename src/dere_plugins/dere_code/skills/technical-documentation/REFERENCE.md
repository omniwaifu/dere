# Technical Documentation Reference

Standards and templates for technical documentation.

## README Template

```markdown
# Project Name

One-sentence description of what it is.

## What it does

- Core functionality 1
- Core functionality 2
- Core functionality 3

## Install

Prerequisites: Language version, required tools with links

```bash
# Exact commands to install
git clone <repo>
cd project
tool install
```

## Usage

```bash
# Basic usage example
command --option value
```

## Configuration

Config file: `path/to/config.ext`

```toml
# Show actual config format
[section]
key = "value"
```

## Development

```bash
# Build/test/lint commands
tool build
tool test
```

## Project Structure

```
src/
├── module1/  # What it does
└── module2/  # What it does
```
```

## API Documentation Template

```markdown
## function_name(param: Type) -> ReturnType

One-sentence description.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| param | Type | What it is |

**Returns:**
Type - What it contains

**Raises:**
- ExceptionType: When it happens

**Example:**
```language
result = function_name(value)
```
```

## Architecture Guide Template

```markdown
# System Architecture

## Overview

What the system is and what it does.

## Components

### Component Name

Purpose: What it does
Location: `src/path/`
Dependencies: What it uses

## Data Flow

```
Input → Component1 → Component2 → Output
```

1. Input arrives from X
2. Component1 processes it
3. Component2 transforms it
4. Output goes to Y

## Key Decisions

### Decision 1
- Problem: What needed solving
- Solution: What was chosen
- Rationale: Why this approach
```

## Anti-Pattern Checklist

### Marketing Language to Avoid

- ❌ "comprehensive"
- ❌ "powerful"
- ❌ "intelligent"
- ❌ "robust"
- ❌ "cutting-edge"
- ❌ "revolutionary"
- ❌ "seamless"
- ❌ "enterprise-grade"
- ❌ "world-class"
- ❌ "best-in-class"
- ❌ "innovative"
- ❌ "next-generation"

### Documentation Smells

- ❌ Starting with "Welcome to..."
- ❌ Vision statements before installation
- ❌ Vague feature lists without code
- ❌ Missing version numbers
- ❌ Non-working installation commands
- ❌ Pseudo-code instead of real examples
- ❌ "Simply" or "just" (minimizing complexity)
- ❌ Walls of text without headings
- ❌ Assuming prior knowledge

## Quality Standards

### Required Elements

**README:**
- [ ] One-sentence "what it is" description
- [ ] What it does (3-5 bullets max)
- [ ] Prerequisites with version numbers
- [ ] Copy-pasteable install commands
- [ ] Basic usage example with real code
- [ ] Configuration file format shown
- [ ] Under 200 lines total

**API Docs:**
- [ ] Function signature at top
- [ ] One-sentence purpose
- [ ] Parameter table with types
- [ ] Return value with type
- [ ] Working code example
- [ ] Exception documentation

**Architecture:**
- [ ] System overview (what, not why)
- [ ] Component descriptions
- [ ] Data flow diagram
- [ ] Key decisions with rationale
- [ ] No buzzwords

## Good Examples

### README: Factual and Clear

```markdown
# tasklib

Python library for Taskwarrior task management.

## What it does

- Read/write Taskwarrior database
- Filter and query tasks
- Modify task attributes
- Hook integration

## Install

Prerequisites: Python 3.7+, Taskwarrior 2.6+

```bash
pip install tasklib
```

## Usage

```python
from tasklib import TaskWarrior

tw = TaskWarrior()
tasks = tw.tasks.pending()
print(tasks[0]['description'])
```

## Configuration

Uses Taskwarrior config at `~/.taskrc`

```python
tw = TaskWarrior(data_location='/custom/path')
```
```

### API Docs: Complete and Concrete

```markdown
## TaskWarrior.tasks.filter(**filters) -> TaskQuerySet

Filter tasks by attributes.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| status | str | Task status ('pending', 'completed', 'deleted') |
| tags | list[str] | Tags to filter by |
| project | str | Project name |

**Returns:**
TaskQuerySet - Filtered task collection

**Example:**
```python
tw = TaskWarrior()
work_tasks = tw.tasks.filter(status='pending', tags=['work'])
for task in work_tasks:
    print(task['description'])
```
```

## Bad Examples

### README: Marketing-Heavy

```markdown
# Amazing Task Manager

Welcome to the revolutionary task management solution! Our comprehensive
platform provides powerful, intelligent task tracking capabilities that
seamlessly integrate with your workflow.

## Why Choose Us?

- Best-in-class architecture
- Enterprise-grade reliability
- Next-generation algorithms
- Robust feature set

[No install instructions, no code examples]
```

**Problems:**
- Marketing language everywhere
- No factual description
- Missing prerequisites
- No code examples
- Vision over functionality

### API Docs: Incomplete

```markdown
## filter_tasks(filters)

Filters tasks based on criteria.

Returns filtered tasks.

Example:
```python
tasks = filter_tasks(some_filter)
```
```

**Problems:**
- No type information
- Vague parameter description
- Return type unclear
- Example doesn't show real usage
- Missing exception information

## Documentation Length Guidelines

- **README**: 100-200 lines max (details go in separate docs)
- **API Reference**: 20-50 lines per function/class
- **Architecture Guide**: 200-400 lines for overview
- **Setup Guide**: 50-100 lines focused on getting started

If documentation exceeds these, split into:
- README (overview + quickstart)
- docs/API.md (detailed API reference)
- docs/ARCHITECTURE.md (system design)
- docs/SETUP.md (detailed installation)
