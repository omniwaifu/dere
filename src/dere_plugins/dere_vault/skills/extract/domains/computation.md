# Computation Domain

Software, algorithms, systems, data structures.

## Formalization

Executable code, type signatures, pseudocode, complexity analysis, state machines.

## Thickness Criteria

1. **Runnable representation** - Code, pseudocode, or formal algorithm that could be executed
2. **Edge cases enumerated** - Boundary conditions, empty inputs, overflow, null handling
3. **Complexity characterized** - Time/space complexity, scaling behavior
4. **Failure modes documented** - What breaks it, how it degrades

## Interrogation Questions

- "Show me the code or pseudocode for this"
- "What happens with empty input? Null? Maximum size?"
- "What's the time complexity? Space complexity?"
- "How does this fail? What are the error conditions?"
- "What invariants must hold for this to work?"
- "What are the preconditions and postconditions?"

## Thin vs Thick Examples

**Thin**: "Recursion is when a function calls itself"

**Thick**:
```
Recursion:
- Base case: condition that terminates recursion (required for termination)
- Recursive case: reduces problem toward base case
- Call stack: each call adds frame; stack overflow at ~1000-10000 depth
- Tail recursion: recursive call is last operation; enables tail-call optimization
- Space: O(n) stack frames for naive recursion; O(1) with TCO
- Alternative: can always be converted to iteration with explicit stack
```

## Verification

- Can the code/pseudocode actually run?
- Are types consistent?
- Do edge cases produce defined behavior?
- Is complexity claim justified?
