---
name: Zettelkasten Technical Notes
description: Create in-depth technical analysis of frameworks, tools, and systems with honest trade-off evaluation. Use when analyzing technologies, documenting technical decisions, or creating implementation guides.
---

# Zettelkasten Technical Notes

Create honest technical analysis focused on trade-offs and real-world applicability, not marketing claims.

## When to Use

- User asks to analyze a technology or framework
- User needs technical decision-making reference
- Creating implementation guides
- Documenting architecture patterns
- "Evaluate X for Y use case"

## Purpose

Technical notes serve as:
1. **In-depth analysis** of technologies and systems
2. **Architectural documentation** and patterns
3. **Performance benchmarks** and trade-off analysis
4. **Decision-making reference** (build vs buy, tool selection)
5. **Implementation guides** and code examples

## Frontmatter (Required)

```yaml
---
type: technical
status: [draft|active|archived]
created: YYYY-MM-DD HH:MM
updated: YYYY-MM-DD HH:MM
tags:
  - tech/[category]
  - language/[lang]
  - performance  # if relevant
  - architecture  # if relevant
related:
  - "[[Related Tech Note]]"
  - "[[Related Project]]"
version: [version number]  # e.g., "2.0", "v1.21"
last_verified: YYYY-MM-DD
---
```

## Structure

### Title Format
Descriptive, searchable titles:
- Good: "FastAPI Async Performance Patterns"
- Good: "Kubernetes Multi-Tenant Architecture"
- Bad: "Notes on FastAPI"
- Bad: "K8s stuff"

### Overview (Required)
Answer:
- What is this technology?
- What problem does it solve?
- Who should use it?
- One-sentence recommendation

### Technical Details
Core implementation information:
- **Architecture**: How it's built
- **Key Components**: Main pieces and roles
- **Dependencies**: What it relies on
- **Language/Platform**: Runtime requirements

### Code Examples
Include practical, runnable examples:

````markdown
### Basic Usage
```python
# Clear, commented example
import library

# Explain what this does
result = library.function(param="value")
```

### Advanced Patterns
```python
# Complex usage with explanation
async def advanced_pattern():
    # Pattern explanation
    ...
```
````

**Code Guidelines:**
- Include imports
- Add comments explaining WHY, not just WHAT
- Show error handling if relevant
- Indicate if conceptual vs production-ready

### Performance/Trade-offs (Critical)
Don't just list features. Analyze trade-offs:

```markdown
### Performance Characteristics
- **Throughput**: 10k req/s on [hardware spec]
- **Latency**: p50: 10ms, p99: 50ms
- **Memory**: ~500MB base, +10MB per connection
- **Scalability**: Horizontal scaling limited by [X]

### Trade-offs
**Pros:**
- Fast for read-heavy workloads
- Simple deployment model
- Good documentation

**Cons:**
- Limited write throughput
- Complex configuration for advanced features
- Memory usage grows with connection count

### When to Use
- Use when: [specific scenarios]
- Avoid when: [specific scenarios]
```

### Benchmarks (If Available)
Include or link to benchmarks:
- Hardware/environment specs
- Test methodology
- Comparison with alternatives
- Date of testing (tech changes!)

### Use Cases (Practical)
Real-world scenarios:
- Where used in production
- Company examples
- Project applications in this vault

### Alternatives/Comparison
What else could you use?
- Alternative 1: [brief comparison]
- Alternative 2: [brief comparison]
- Decision factors

### Implementation Notes
Practical deployment considerations:
- Installation steps
- Configuration gotchas
- Common pitfalls
- Security considerations
- Monitoring/observability

### Cost Analysis (If Relevant)
For cloud services or paid tools:
- Pricing model
- Cost at scale
- Hidden costs
- Open-source alternatives

### Related Notes
Link to:
- Similar technologies
- Complementary tools
- Projects using this tech
- Permanent notes on concepts

### Version Tracking
Technology evolves. Note:
- Version analyzed
- Last verification date
- Major changes in newer versions

## Workflow

### Creating Technical Analysis
1. Research current version and documentation
2. Find performance benchmarks (official or third-party)
3. Identify trade-offs and limitations
4. Compare with alternatives
5. Provide actionable code examples
6. Link to related technologies

### Analysis Framework
Use this structure:
1. **What**: Technology description
2. **Why**: Problem it solves
3. **How**: Implementation approach
4. **Trade-offs**: Pros/cons/limitations
5. **When**: Use cases and anti-patterns
6. **Alternatives**: What else could work
7. **Verdict**: Recommendation with context

### Style Guidelines
- **Be honest**: Don't repeat marketing claims
- **Be specific**: "2x faster" means nothing without context
- **Be practical**: Focus on real-world usage
- **Be current**: Note versions and dates
- **Be critical**: Analyze trade-offs, not just features

## Quality Standards

### Good Technical Notes
- **Actionable** - Someone could use this tech from your note
- **Honest** - Covers limitations, not just benefits
- **Contextual** - Explains WHEN to use, not just HOW
- **Current** - Version and date tracked
- **Connected** - Links to related tech and concepts

### Red Flags
- Marketing copy without critical analysis
- No version information
- No performance data or trade-offs
- Missing use cases
- No code examples for relevant tech
- Outdated info presented as current

## Technical Note Types

### Framework Analysis
Focus: How it works, when to use, patterns

### Infrastructure/Platform
Focus: Deployment, scalability, operations

### Tool/Library Reviews
Focus: Capabilities, integration, comparison

### System Analysis
Focus: Architecture, technical reality vs marketing

### Performance Studies
Focus: Benchmarks, optimization, bottlenecks

### Integration Guides
Focus: How to connect technologies

## Archival Policy

Mark as `status: archived` when:
- Technology is deprecated
- Major version makes note obsolete
- Superseded by better alternative

Don't delete - keep for historical context. Add note:
```markdown
> **Archive Notice**: This analysis is for [version]. See [[newer-note]] for current version.
```

## Permanent Note Extraction

Technical notes can generate permanent notes:

Example:
- Technical note: Detailed infrastructure analysis
  → Permanent notes:
    - [[marketing-claims-vs-technical-reality]]
    - [[build-vs-buy-decision-framework]]
    - [[proprietary-vs-open-source-optimization]]

Look for generalizable concepts that apply beyond specific technology.

## Integration with Projects

When using tech in projects:
- Link project note to tech note
- Add project to "Use Cases" section
- Document project-specific learnings
- Update tech note with real-world experience

## Example Structure

```markdown
---
type: technical
status: active
created: 2025-10-14
updated: 2025-10-15
tags:
  - tech/frameworks
  - language/python
  - performance
version: "0.115.0"
last_verified: 2025-10-15
---

# FastAPI Async Performance Patterns

## Overview

FastAPI is a modern Python web framework with native async/await support and automatic API documentation. Best for building high-performance async APIs when you need type safety and developer productivity.

**One-liner**: Use FastAPI when you need async Python APIs with excellent DX; stick with Flask if you need mature ecosystem or don't need async.

## Technical Details

### Architecture
- Built on Starlette (ASGI framework)
- Pydantic for data validation
- Automatic OpenAPI schema generation
- Native async/await throughout

### Key Components
- **Router**: Path operation decorators
- **Dependency Injection**: Reusable dependencies
- **Background Tasks**: Fire-and-forget tasks
- **WebSocket**: Native WebSocket support

## Code Examples

### Basic Async Endpoint
```python
from fastapi import FastAPI
import httpx

app = FastAPI()

@app.get("/users/{user_id}")
async def get_user(user_id: int):
    # Async HTTP client for non-blocking I/O
    async with httpx.AsyncClient() as client:
        response = await client.get(f"https://api.example.com/users/{user_id}")
        return response.json()
```

## Performance/Trade-offs

### Performance Characteristics
- **Throughput**: 20k-30k req/s (simple endpoints, single worker)
- **Latency**: p50: 5ms, p95: 15ms, p99: 50ms
- **Memory**: ~50MB base + ~10MB per worker
- **Scalability**: Excellent with async I/O workloads

### Trade-offs

**Pros:**
- Excellent async performance
- Best-in-class developer experience
- Automatic API docs (OpenAPI/Swagger)
- Strong type safety with Pydantic
- Modern Python features (type hints, async/await)

**Cons:**
- Smaller ecosystem than Flask/Django
- Async programming has learning curve
- Less mature for complex auth/admin needs
- Breaking changes between minor versions (pre-1.0)

### When to Use
- **Use when**:
  - Building async APIs with I/O-bound operations
  - Need automatic API documentation
  - Want type safety and validation
  - Team comfortable with async Python

- **Avoid when**:
  - Simple CRUD with no async needs (Flask simpler)
  - Need battle-tested admin interface (Django better)
  - Team unfamiliar with async patterns
  - Require absolute API stability (pre-1.0 has changes)

## Alternatives

### Flask
- Pros: Mature, huge ecosystem, simpler mental model
- Cons: Sync-first, manual API docs, less type safety
- **Decision**: Choose Flask if you don't need async or want maximum ecosystem

### Django + DRF
- Pros: Batteries-included, amazing admin, ORM
- Cons: Heavier, async support still maturing
- **Decision**: Choose Django for full-stack web apps with admin needs

## Implementation Notes

### Installation
```bash
pip install "fastapi[all]"  # includes uvicorn, pydantic, etc.
```

### Common Gotchas
- Don't mix sync and async database clients
- Use async HTTP clients (httpx, aiohttp) not requests
- Beware of blocking operations in async endpoints
- Background tasks run in same process (use Celery for heavy work)

### Security
- Built-in OAuth2/JWT support
- CORS middleware included
- Request validation via Pydantic
- Still need to secure endpoints yourself

## Related
- [[async-python-patterns]]
- [[api-design-principles]]
- [[build-vs-buy-framework]]
- Projects: [[project-api-gateway]]
```

Remember: Technical notes are decision-making tools. Focus on trade-offs and context, not just features. Be honest about limitations.
