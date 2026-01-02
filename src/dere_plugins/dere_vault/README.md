# dere-vault Plugin

Zettelkasten knowledge vault skills with **thickness enforcement** - permanent notes must be testable, productive, and bounded before finalization.

## Philosophy

From Wolfram: Ideas become permanent when they're precise enough to test and derive from, not just articulately stated. Standard Zettelkasten emphasizes atomicity and linking, but that's not enough - you can have thousands of atomic notes that are sophisticated summarization without real understanding.

The missing piece is **formalization pressure**: forcing ideas to become precise enough to:

- **Test** - What would prove this wrong?
- **Derive** - What non-obvious thing follows from this?
- **Bound** - Where does this break down?

## Skills

### capture

Quick capture of thoughts, tasks, and daily reflections for later processing.

**Use when:**

- Creating daily notes
- Journaling
- Tracking daily work
- Morning/evening planning

### source

Summarize articles, papers, books, and videos in your own words with proper citations.

**Use when:**

- Processing URLs or external content
- Creating literature notes
- Building research bibliography

### extract

Extract atomic concepts with **thickness enforcement** - LLM pushes back until notes meet quality criteria.

**Use when:**

- Creating permanent notes from source material
- Formalizing ideas across any domain
- Building the derivation graph

**Thickness workflow:**

1. Domain detection (computation, economics, philosophy, etc.)
2. Initial extraction with structure
3. Socratic interrogation against domain template
4. Thickness assessment (pass/fail)
5. Derivation linking
6. Finalization only when criteria met

### research

Search vault, synthesize findings, analyze technologies, track projects, and create Hubs.

**Use when:**

- Researching topics across vault
- Creating Hubs (overview notes)
- Documenting technical decisions
- Finding connections between notes

## Thickness System

### Universal Criteria (All Domains)

Every permanent note must satisfy:

1. **Testable** - At least one falsifiable claim
2. **Productive** - Can derive non-obvious consequences
3. **Bounded** - Knows its limitations and edge cases

### Domain Templates

Located in `skills/extract/domains/`:

| Domain        | Focus                                              |
| ------------- | -------------------------------------------------- |
| `computation` | Algorithms, code, complexity, edge cases           |
| `economics`   | Causation, equilibrium, incentives, predictions    |
| `philosophy`  | Definitions, arguments, counterarguments, scope    |
| `mathematics` | Proofs, examples, counterexamples, relationships   |
| `science`     | Falsifiability, evidence quality, effect sizes     |
| `strategy`    | Options, trade-offs, uncertainty, reversibility    |
| `history`     | Causation vs correlation, counterfactuals, sources |
| `practical`   | Triggers, actionability, failure modes, review     |

### Formalization Levels

| Level         | Description                                   |
| ------------- | --------------------------------------------- |
| `prose`       | Natural language only                         |
| `semi-formal` | Mix: pseudocode, diagrams, logical structure  |
| `formal`      | Rigorous: code, proofs, mathematical notation |

### Derivation Graph

Notes track their intellectual lineage:

- `derived_from`: Notes this builds on
- `derivations`: Notes that build on this (backlinks)

Claude maintains bidirectional links at creation time.

## Workflow

1. **Capture** → Quick daily notes (fleeting thoughts)
2. **Source** → Literature notes from external content
3. **Extract** → Permanent notes with thickness enforcement
4. **Research** → Cross-vault synthesis and Hubs

Process fleeting notes within 1-2 days to maintain flow.

## Configuration

Vault detection is automatic via `bun scripts/detect_vault.ts`. Override in `~/.config/dere/config.toml`:

```toml
[vault]
path = "/path/to/your/vault"
```

## Tools

### link_analysis.ts

Analyze knowledge graph health:

```bash
bun ./scripts/link_analysis.ts --stats        # Vault statistics
bun ./scripts/link_analysis.ts --orphans      # Notes with < 3 links
bun ./scripts/link_analysis.ts --suggest "X"  # Connection suggestions
```

### concept_search.ts

Search for similar permanent notes before creating duplicates:

```bash
bun ./scripts/concept_search.ts "concept name"
```

## Example: Thin vs Thick

**Thin**: "Supply and demand determine price"

**Thick**:

```
Price mechanism:
- Equilibrium: P* where Qd(P*) = Qs(P*)
- Adjustment: excess demand → price rises → Qd falls, Qs rises → convergence
- Conditions: perfect information, no transaction costs, homogeneous goods
- Breaks when: externalities, information asymmetry, market power
- Prediction: price controls below P* → shortage of (Qd - Qs)
```

The thick version is testable (make predictions), productive (derive shortage from price control), and bounded (knows its failure modes).

## References

- Wolfram, Stephen. "I Have a Theory Too: The Challenge and Opportunity of Avocational Science" (2025)
- Ahrens, Sönke. _How to Take Smart Notes_ (2017)
- [Zettelkasten Method](https://zettelkasten.de/)
