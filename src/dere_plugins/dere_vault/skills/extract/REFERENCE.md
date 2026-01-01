# Extract Skill Reference

Technical specifications for permanent notes with thickness enforcement.

## Frontmatter Schema

```yaml
---
title: string           # Searchable, descriptive title
date: YYYY-MM-DD        # Creation date
tags:                   # Hierarchical tags
  - domain/subdomain/concept
aliases:                # Alternative titles for search
  - "Alias 1"

# Thickness System Fields
domain: string          # Primary domain (see below)
formalization: string   # prose | semi-formal | formal
thickness:
  testable: boolean     # Has falsifiable claims
  productive: boolean   # Can derive non-obvious consequences
  bounded: boolean      # Knows limitations and edge cases

# Derivation Graph
derived_from:           # Notes this synthesizes/builds on
  - "[[Source Note]]"
derivations:            # Notes that build on this one
  - "[[Derived Note]]"
---
```

## Domain Values

| Domain        | Description                                      |
| ------------- | ------------------------------------------------ |
| `computation` | Algorithms, software, data structures, systems   |
| `economics`   | Markets, incentives, mechanisms, institutions    |
| `philosophy`  | Concepts, arguments, definitions, analysis       |
| `mathematics` | Theorems, proofs, formal definitions             |
| `science`     | Empirical claims, evidence, experiments          |
| `strategy`    | Decisions, trade-offs, game theory, planning     |
| `history`     | Causal narratives, counterfactuals, evidence     |
| `practical`   | Procedures, habits, heuristics, personal systems |

## Formalization Levels

| Level         | Description             | Criteria                                                       |
| ------------- | ----------------------- | -------------------------------------------------------------- |
| `prose`       | Natural language only   | Ideas described but not formalized                             |
| `semi-formal` | Mix of prose and formal | Some structure: pseudocode, diagrams, logical arguments        |
| `formal`      | Rigorous representation | Code, proofs, mathematical notation, executable specifications |

## Thickness Criteria

### Universal (All Domains)

1. **testable: true** - Note contains at least one falsifiable claim
   - "What observation would prove this wrong?"
   - Cannot be: tautologies, definitions-only, purely normative

2. **productive: true** - Can derive non-obvious consequences
   - "What follows from this that wasn't explicitly stated?"
   - The note should generate new implications

3. **bounded: true** - Knows its limitations
   - "Where does this break down?"
   - Edge cases, assumptions, scope limits documented

### Domain-Specific

See `domains/*.md` for domain-specific thickness requirements.

## Derivation Graph

### derived_from

- Lists notes that this note synthesizes or builds upon
- Set at creation time
- Claude asks: "What existing notes does this build on?"

### derivations

- Lists notes that build on this one (backlinks)
- Updated when new notes reference this note
- Claude maintains: adds entry when creating derived notes

### Graph Integrity

- If A is in B's `derived_from`, B should be in A's `derivations`
- Claude enforces bidirectional links at creation time

## Tag Conventions

```
domain/subdomain/concept
```

Examples:

- `computation/algorithms/sorting`
- `economics/markets/price-mechanism`
- `philosophy/epistemology/justification`
- `practical/habits/morning-routine`

Use 2-4 tags per note. Match existing taxonomy where possible.

## File Naming

```
[Concept Title].md
```

- Title case
- Spaces allowed (Obsidian handles them)
- Avoid special characters: `/ \ : * ? " < > |`

## Wikilink Requirements

- Minimum 3 wikilinks to other permanent notes
- Use `link_analysis.py --suggest "[title]"` for suggestions
- Link to: related concepts, examples, counterexamples, parent concepts

## Thickness Enforcement

Notes **cannot be finalized** until:

1. All universal thickness criteria pass (testable, productive, bounded)
2. Domain-specific criteria from template are satisfied
3. At least one derived_from link exists (unless this is a root concept)
4. At least 3 wikilinks to related notes

Claude enforces this by refusing to write the final note until criteria met.
