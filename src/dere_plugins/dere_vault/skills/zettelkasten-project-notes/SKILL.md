---
name: Zettelkasten Project Notes
description: Create and maintain active project documentation with goals, decisions, and learnings. Use when starting projects, tracking progress, or documenting project work.
---

# Zettelkasten Project Notes

Create living project documentation that tracks goals, decisions, and learnings throughout the project lifecycle.

## When to Use

- User starts new project
- User asks to update project status
- User wants to track project decisions
- User needs to document project learnings
- "Create project note for X"

## Purpose

Project notes serve as:
1. **Central hub** for project information
2. **Task and milestone tracking**
3. **Decision log** and context
4. **Integration point** for research, tech, permanent notes
5. **Living documentation** that evolves

## Frontmatter (Required)

```yaml
---
type: project
status: [planning|active|on-hold|completed|archived]
created: YYYY-MM-DD
updated: YYYY-MM-DD
start_date: YYYY-MM-DD
target_date: YYYY-MM-DD  # optional
completion_date: YYYY-MM-DD  # if done
tags:
  - project
  - [domain]
priority: [high|medium|low]
related:
  - "[[Related Note 1]]"
  - "[[Related Note 2]]"
---
```

## Structure

### Title Format
Clear, descriptive project names:
- Good: "IOIntel - Intelligence Platform"
- Good: "Agent Architecture Prototype"
- Bad: "New Project"

### Overview/Vision (Required)
Answer:
- What is this project?
- What problem does it solve?
- What's the end goal?
- Why am I doing this?

Keep brief (2-3 paragraphs max).

### Status (Living Section)
Current state summary:
- What phase are you in?
- What's working?
- What's blocking?
- Next immediate steps

**Update regularly** - reflect current reality.

### Goals & Success Criteria
Concrete, measurable outcomes:
- [ ] Goal 1: [specific, measurable]
- [ ] Goal 2: [specific, measurable]
- [ ] Goal 3: [specific, measurable]

Not vague ("make it better") but specific ("reduce latency to <100ms").

### Milestones
Major phases or checkpoints:
- [x] Milestone 1: Research complete (YYYY-MM-DD)
- [x] Milestone 2: Prototype working (YYYY-MM-DD)
- [ ] Milestone 3: Production deployment
- [ ] Milestone 4: User feedback incorporated

Track completion dates for reflection.

### Tasks
Actionable next steps:
- [ ] Immediate task 1
- [ ] Immediate task 2
- [ ] Blocked task (waiting on X)

### Technical Stack
What technologies:
- Language/Framework: [[tech-note-link]]
- Infrastructure: [[tech-note-link]]
- Key Libraries: [[tech-note-link]]

Link to tech notes for details.

### Architecture/Design
High-level system design:
- Components and relationships
- Data flow
- Integration points
- Link to detailed architecture docs if needed

### Decisions Log
Critical decisions and rationale:

```markdown
### Decision: [Title] (YYYY-MM-DD)
**Context**: Why this decision needed
**Options Considered**:
1. Option A: pros/cons
2. Option B: pros/cons
**Decision**: Chose [X] because [reasoning]
**Consequences**: Expected outcomes
```

Invaluable for future you or team members.

### Research & References
Related notes and sources:
- [[Literature Note 1]] - key insight
- [[Tech Note 2]] - implementation approach
- [[Permanent Note 3]] - relevant concept
- External: [URL] - useful resource

### Learnings
What you've discovered:
- Technical learnings
- Process improvements
- Mistakes and how to avoid them
- Surprising insights

**Update as you go** - don't wait until end.

### Related Daily Notes
Link to daily notes where work happened:
- [[2025-10-14]] - initial research
- [[2025-10-20]] - breakthrough on architecture

Backlinks help auto-discover these.

### Metrics (Optional)
If relevant:
- Performance metrics
- Usage statistics
- Cost tracking
- Time invested

## Workflow

### Starting New Project
1. Create project folder: `Projects/[project-name]/`
2. Create main project note: `[project-name].md`
3. Set frontmatter with status: planning
4. Define clear goals and success criteria
5. Link related research and tech notes
6. Create initial task list

### Updating Project
1. Update status section (current state)
2. Check off completed tasks/milestones
3. Add new learnings
4. Log important decisions
5. Update related notes if discoveries
6. Link to daily notes where work happened

### Reviewing Project
Help user reflect:
- What's changed since last update?
- What's blocking progress?
- What have you learned?
- What decisions need to be made?
- What research or tech notes are relevant?
- Should any learnings become permanent notes?

### Completing Project
1. Update status to completed
2. Set completion_date in frontmatter
3. Document final outcomes vs goals
4. Extract learnings to permanent notes
5. Archive or document next phase
6. Create retrospective

## Project Folder Structure

Each project can have its own folder:
```
Projects/
├── project-name/
│   ├── project-name.md          # Main note
│   ├── project-architecture.md  # Detailed design
│   ├── project-tasks.md         # Task tracking
│   └── ...
└── CLAUDE.md
```

Or single note if project is small.

## Integration with Vault

### Link to Research
When research informs project:
- Link from project to literature notes
- Note how research applies
- Extract project-specific insights

### Link to Tech Notes
When using technologies:
- Link to tech analysis notes
- Document project-specific configuration
- Update tech notes with real-world experience

### Link to Daily Notes
Mention project in daily notes:
- Daily captures fleeting thoughts
- Project note captures synthesized progress
- Bidirectional linking enables discovery

### Extract Permanent Notes
Projects generate insights:
- Technical patterns discovered
- Problem-solving approaches
- General principles learned

Extract these into permanent notes for reuse.

## Status Lifecycle

Track evolution:
1. **planning** - Defining goals, researching
2. **active** - Actively working, progressing
3. **on-hold** - Paused, waiting, deprioritized
4. **completed** - Goals achieved, done
5. **archived** - Deprecated, abandoned, superseded

Status changes are data points - track when and why.

## Quality Standards

### Good Project Notes
- **Current** - Status reflects reality
- **Actionable** - Clear next steps
- **Connected** - Links to relevant notes
- **Documented** - Decisions and learnings captured
- **Honest** - Includes what's not working

### Red Flags
- Stale status (months old)
- No tasks or next steps
- No links (orphan)
- No learnings section
- Vague goals without success criteria

## Example Decision Log Entry

```markdown
### Decision: Use FastAPI over Flask (2025-10-14)

**Context**: Need async support for WebSocket handling and better performance under load.

**Options Considered**:
1. Flask + async extensions: Mature ecosystem, team familiar, requires extensions for async
2. FastAPI: Built-in async, automatic OpenAPI docs, newer ecosystem

**Decision**: Chose FastAPI because:
- Native async/await support
- Automatic API documentation
- Better type safety with Pydantic
- Modern patterns align with project goals

**Consequences**:
- Team needs to learn FastAPI patterns
- Smaller ecosystem but growing rapidly
- Worth investment for long-term benefits

**Related**: [[fastapi-tech-analysis]], [[async-python-patterns]]
```

Remember: Project notes are living documents. Update regularly to maintain value. They should tell the story of your work.
