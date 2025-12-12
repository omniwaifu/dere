# Strategy Domain

Decisions, trade-offs, game theory, planning, optimization.

## Formalization

Decision trees, payoff matrices, game-theoretic reasoning, option value analysis, scenario planning.

## Thickness Criteria

1. **Options enumerated** - What are the choices? What's the decision space?
2. **Trade-offs explicit** - What do you give up for each option?
3. **Uncertainty acknowledged** - What don't you know? What's the variance?
4. **Reversibility assessed** - Can you undo this? What's the cost?

## Interrogation Questions

- "What are all the options? Are you sure you've considered alternatives?"
- "What do you give up with each choice? What's the opportunity cost?"
- "What's your uncertainty? What could go wrong?"
- "Is this reversible? What's the cost of being wrong?"
- "What would change your mind? What's your tripwire?"
- "Who are the other players? What are their incentives?"

## Thin vs Thick Examples

**Thin**: "You should diversify your investments"

**Thick**:
```
Portfolio diversification:
- Options: Concentrated (high conviction), diversified (index), barbell (safe + speculative)
- Trade-off: Diversification reduces variance but caps upside; assumes you have no edge
- Decision rule: Diversify unless you have (a) genuine information advantage AND (b) can afford total loss
- Irreversibility: Low - can rebalance; but tax consequences in non-registered accounts
- Uncertainty: Unknown unknowns (black swans) favor diversification; correlation spikes in crises
- Game theory: If everyone diversifies, alpha opportunities exist; if everyone seeks alpha, diversification wins
- Tripwire: If you can articulate specific edge with track record, concentrate; otherwise, diversify
```

## Verification

- Have you actually enumerated alternatives?
- Is the trade-off assessment accurate (not rationalization)?
- What's your track record with similar decisions?
- Would you take this bet at 3x the stakes? 0.3x?
