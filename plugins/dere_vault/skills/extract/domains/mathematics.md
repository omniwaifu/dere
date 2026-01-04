# Mathematics Domain

Theorems, proofs, definitions, constructions, mathematical objects.

## Formalization

Formal definitions, theorem statements, proof sketches, examples and counterexamples, relationships to other results.

## Thickness Criteria

1. **Definitions precise and non-circular** - Each term defined in terms of more primitive concepts
2. **Proof sketched or referenced** - The "why" not just the "what"
3. **Relationship to other theorems noted** - Where this fits in the web of math
4. **Examples and counterexamples** - Concrete instances, edge cases

## Interrogation Questions

- "State the definition formally - what are the necessary and sufficient conditions?"
- "Sketch the proof or identify the key insight"
- "Give an example that satisfies this. Give one that doesn't."
- "What theorem does this depend on? What theorems use this?"
- "What's the most general form? Most special case?"
- "What's the intuition behind this? Why should it be true?"

## Thin vs Thick Examples

**Thin**: "A prime number has exactly two divisors"

**Thick**:

```
Prime number:
- Definition: n ∈ Z⁺ with exactly two positive divisors: 1 and n
- Equivalently: n > 1 and ∀a,b ∈ Z⁺: (ab = n) → (a = 1 ∨ b = 1)
- Examples: 2, 3, 5, 7, 11 (2 is the only even prime)
- Counterexamples: 1 (one divisor), 4 (three: 1,2,4), 0 (infinite divisors)
- Key theorem: Fundamental Theorem of Arithmetic - every n > 1 is unique product of primes
- Proof insight: existence by strong induction; uniqueness by Euclid's lemma
- Related: prime factorization, Sieve of Eratosthenes, Prime Number Theorem
- Open: twin prime conjecture, Goldbach conjecture
```

## Verification

- Do examples satisfy the definition?
- Does the proof sketch actually work?
- Are dependencies correctly stated?
- Is the definition equivalent to standard usage?
