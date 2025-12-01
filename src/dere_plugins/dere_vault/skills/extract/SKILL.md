---
name: extract
description: Extract atomic concepts with thickness enforcement
---

# Extract Skill

Create permanent notes with **thickness enforcement** - notes must be testable, productive, and bounded before finalization.

## Philosophy

From Wolfram: Ideas become permanent when they're precise enough to test and derive from, not just articulately stated. The test: "Can you derive consequences you didn't put in? Can you find where it breaks?"

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
3. **Search for duplicates** - Use `concept_search.py [concept]` to check if similar note exists

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
Draft the note with explicit structure:
- **Core claim** in one sentence
- **Supporting elaboration** in own words
- **Key terms defined** precisely
- **Examples provided** (2+ concrete instances)

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
- "What notes should this link to?" → Use `link_analysis.py --suggest "[title]"`

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

## Failure Response Examples

**Fails transformation check**:
> "This is interesting, but what does it actually change? If I asked you 'how does this rewire your understanding of something else?', what would you say? If nothing comes to mind, this might be reference material rather than insight - worth bookmarking but not a permanent note yet."

**Missing testability**:
> "This note claims '[X]' but I can't see what would falsify it. What observation would prove you wrong? Without that, we're in unfalsifiable territory."

**Missing precision**:
> "The term '[Y]' is doing a lot of work here but isn't defined. What exactly is in and out of this concept?"

**Missing boundaries**:
> "This sounds plausible in the general case, but where does it break down? Every useful concept has edges."

**Missing derivation**:
> "If this concept is correct, what non-obvious thing follows from it? If nothing follows, maybe we haven't captured the real insight yet."

## Helper Tools

- `concept_search.py [query]` - Search for similar permanent notes
- `link_analysis.py --suggest [title]` - Connection suggestions
- `domains/*.md` - Domain-specific thickness templates

## Examples

See domain templates for thin vs thick examples in each domain.
