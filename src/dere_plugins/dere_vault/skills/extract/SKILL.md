---
name: extract
description: Extract atomic concepts with thickness enforcement
---

# Extract Skill

Create permanent notes with **thickness enforcement** - notes must be testable, productive, and bounded before finalization.

## Workflow

### Phase 0: Transformation Check

Before extracting, answer the gate question:

> "What does this change about how I see something else?"

If you can't answer this, you're collecting, not learning. The concept isn't ready for permanent note status.

**Outcomes:**

- **Clear transformation** → Proceed to Phase 1
- **Vague or nothing** → Either:
  - Return to source for deeper processing
  - Keep as fleeting note for later
  - Acknowledge it's reference material, not insight

This filters out "interesting facts" that don't actually rewire understanding.

### Phase 1: Source Review

1. Review source material (daily note, literature note, conversation)
2. Identify candidate concept for extraction
3. **Search for duplicates** - Use `bun scripts/concept_search.ts [concept]` to check if similar note exists

### Phase 2: Domain Detection

Identify the domain(s) this concept belongs to. Ask the user if unclear:

```
"This concept touches on [detected areas]. Which domain should we use?"
```

**Available domains** (templates in `domains/`):

- **computation** - algorithms, software, data structures
- **economics** - markets, incentives, mechanisms
- **philosophy** - concepts, arguments, definitions
- **mathematics** - theorems, proofs, formal objects
- **science** - empirical claims, evidence, experiments
- **strategy** - decisions, trade-offs, game theory
- **history** - causal narratives, counterfactuals
- **practical** - procedures, habits, personal systems

For cross-domain concepts: Apply universal criteria + primary domain's specific requirements.

### Phase 3: Initial Extraction

**Target: 150-300 words** (not counting frontmatter/wikilinks)

Structure:

1. **Core claim** - 1 sentence, max 30 words
2. **Why it matters** - 1-2 sentences connecting to other concepts
3. **Boundaries** - when this doesn't apply
4. **Example** - 1 concrete instance (not a restatement of the claim)

**DO NOT:**

- Restate the claim in different words
- Use "In other words..." or "Put simply..."
- List obvious implications
- Define terms already clear from context
- Pad with hedge words or qualifications

### Phase 4: Thickness Interrogation

Load the domain template from `domains/[domain].md`. Apply both:

**Universal Thickness Criteria** (all domains):

1. **Testable** - At least one falsifiable claim. Ask: "What would prove this wrong?"
2. **Productive** - Can derive non-obvious consequences. Ask: "What follows from this that you didn't put in?"
3. **Bounded** - Knows where it breaks. Ask: "What are the edge cases and limitations?"

**Domain-Specific Criteria** from the loaded template.

**Interrogation Protocol**:

- Ask domain-specific questions from the template
- Push back on vague claims: "What exactly do you mean by [term]?"
- Demand concrete examples: "Give me a specific instance"
- Test boundaries: "What happens at the edge?"

### Phase 5: Thickness Assessment

Evaluate against criteria. Either:

**PASS** - All criteria satisfied:

- Proceed to finalization
- Mark formalization level (`semi-formal` or `formal`)

**FAIL** - Criteria not met:

```
"This note is still at prose level. The claim '[X]' isn't testable yet -
what observation would prove it wrong? And the term '[Y]' needs a precise
definition. Let's work on those before finalizing."
```

Return to Phase 4 until criteria met.

### Phase 6: Derivation Linking

Before finalizing, ask:

- "What existing notes does this build on?" → Set `derived_from`
- "What notes should this link to?" → Use `bun scripts/link_analysis.ts --suggest "[title]"`

Update source notes' `derivations` field with backlink to this new note.

### Phase 7: Finalization

Create the note with:

- Complete frontmatter (see REFERENCE.md)
- Thickness metadata filled
- Derivation links set
- 3+ wikilinks to related concepts

## Frontmatter Template

```yaml
---
title: "[Searchable Title]"
date: YYYY-MM-DD
tags:
  - domain/subdomain/concept
domain: computation | economics | philosophy | mathematics | science | strategy | history | practical
formalization: prose | semi-formal | formal
thickness:
  testable: true
  productive: true
  bounded: true
derived_from:
  - "[[Source Note 1]]"
derivations: []
---
```

## Helper Tools

- `bun scripts/concept_search.ts [query]` - Search for similar permanent notes
- `bun scripts/link_analysis.ts --suggest [title]` - Connection suggestions
- `domains/*.md` - Domain-specific thickness templates

## Examples

See domain templates for thin vs thick examples in each domain.
