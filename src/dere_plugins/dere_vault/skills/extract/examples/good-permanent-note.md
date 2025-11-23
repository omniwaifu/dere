# Good Permanent Note Example

This demonstrates a well-structured evergreen note with proper atomicity, linking, and examples.

```markdown
---
type: permanent
status: mature
created: 2025-01-10 14:30
updated: 2025-01-15 09:15
tags:
  - concept
  - software-design
  - decision-making
related:
  - "[[Trade-offs Between Control and Adaptation]]"
  - "[[Minimal Predefinition Maximal Self-Evolution]]"
  - "[[Emergence vs Engineered Capabilities]]"
sources:
  - "[[Ahrens - How to Take Smart Notes (2017)]]"
  - "[[Daily Note 2025-01-10]]"
---

# Build vs Buy Decision Framework

The choice between building custom solutions and buying existing ones depends on three factors: strategic differentiation, resource capacity, and integration complexity.

**Strategic differentiation** determines whether custom implementation provides competitive advantage. If the capability is core to your value proposition, build. If it's commodity functionality competitors also have, buy.

**Resource capacity** considers not just initial development but ongoing maintenance, updates, and expertise retention. Built solutions require sustained investment; bought solutions trade recurring costs for reduced maintenance burden.

**Integration complexity** evaluates how well off-the-shelf solutions fit existing architecture. High integration costs can negate purchasing advantages, especially when extensive customization is needed.

## Context

This framework applies when:
- Evaluating technology decisions for software projects
- Architecting new systems or features
- Reviewing existing tool choices
- Budget and roadmap planning

Does NOT apply to:
- Commodity utilities (logging, monitoring) - always buy
- Regulated requirements with certified solutions - must buy
- Experimental prototypes - build fast, decide later

## Examples

**Example 1: Authentication System**
- Strategic differentiation: Low (commodity feature)
- Resource capacity: Auth requires deep security expertise
- Integration: Standard protocols (OAuth, SAML)
- **Decision**: Buy (Auth0, Okta) - not core differentiator, high expertise requirement

**Example 2: ML Model Training Pipeline**
- Strategic differentiation: High (core to ML product value)
- Resource capacity: Have ML team, need custom workflows
- Integration: Complex data sources, specific requirements
- **Decision**: Build - provides competitive advantage, existing expertise

**Example 3: Error Tracking**
- Strategic differentiation: Low (all products need this)
- Resource capacity: Small team, limited monitoring expertise
- Integration: Standard SDKs available
- **Decision**: Buy (Sentry) - commodity feature, low integration cost

## Connections

This framework builds on [[Trade-offs Between Control and Adaptation]]: building provides control but reduces adaptation speed; buying enables faster adaptation but reduces control over capabilities.

Contrasts with [[Minimal Predefinition Maximal Self-Evolution]] in interesting way: that principle argues for emergent systems, but this framework acknowledges when predefined (bought) solutions are pragmatic.

Related to [[Emergence vs Engineered Capabilities]]: bought solutions are engineered by vendors; built solutions can be emergent (evolved) or engineered (planned).

See [[Hub/Software Architecture]] for broader context.

## Implications

This framework suggests:
1. Regularly review build/buy decisions as strategic position changes
2. Commodity features should be bought unless integration costs prohibitive
3. Core differentiators should be built even if more expensive
4. Resource capacity is often underestimated - maintenance burden grows

Questions this raises:
- How do you identify true strategic differentiators vs perceived ones?
- When does bought solution become strategic liability (vendor lock-in)?
- How to handle middle cases (somewhat strategic, moderate resources)?

## Sources

Framework synthesized from multiple sources:
- [[Ahrens - How to Take Smart Notes (2017)]]: principle of focusing effort on value-adding work
- [[Daily Note 2025-01-10]]: reflection on error handling PR review
- Personal experience across multiple build/buy decisions

## Related Notes

- [[Strategic vs Tactical Technical Decisions]]
- [[Total Cost of Ownership Calculation]]
- [[Vendor Lock-in Risk Assessment]]
- [[Hub/Software Architecture]]
- [[Hub/Decision-Making Frameworks]]
```

## Why This Is Good

### Atomicity
- Single focused concept (build vs buy framework)
- Fully self-contained explanation
- Doesn't bundle multiple frameworks

### Linking
- 3 outgoing links in header (related concepts)
- Multiple inline links (7+ connections)
- Links to both concepts and hubs
- Bidirectional relationships explained

### Examples
- 3 concrete examples
- Different domains (auth, ML, monitoring)
- Shows framework application
- Specific enough to be useful

### Structure
- Clear core idea (3 paragraphs)
- Context (when/when not to apply)
- Rich connections section
- Implications and questions
- Proper attribution

### Writing Quality
- Own words, not copy-pasted
- Explains "why" not just "what"
- Shows understanding
- Future-you can understand it
