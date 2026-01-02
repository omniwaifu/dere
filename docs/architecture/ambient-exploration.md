# Ambient Exploration Architecture

## Executive Summary

This document describes the architecture for **ambient exploration** - the ability for dere to productively use idle periods for autonomous learning and research.

Instead of passively waiting for user interaction, dere maintains a **curiosity backlog** of topics to explore, researches them during downtime, and stores findings that surface naturally in future conversations.

**Core principle:** Silence is default. Ambient work produces knowledge, not notifications.

---

## 1. Curiosity Model

### 1.1 Data Model

Reuse existing `ProjectTask` infrastructure with `task_type="curiosity"`:

```python
# No new tables - extend ProjectTask.extra JSONB
class CuriosityExtra(TypedDict):
    curiosity_type: Literal[
        "unfamiliar_entity",   # User mentioned something unknown
        "correction",          # User corrected AI
        "emotional_peak",      # High user engagement on topic
        "unfinished_thread",   # Conversation pivoted without resolution
        "knowledge_gap",       # AI noticed own uncertainty
        "research_chain",      # Follow-up from prior exploration
    ]
    source_context: str        # Conversation snippet that triggered
    trigger_reason: str        # Why this became a curiosity
    priority_factors: dict     # Breakdown of score components
    exploration_count: int     # Times explored
    last_explored_at: str | None
    findings: list[str]        # What we learned
    satisfaction_level: float  # 0-1, how well-explored
```

### 1.2 Trigger Detection

Curiosity items are created by analyzing conversation turns:

| Trigger Type        | Detection Method                       | Example                                    |
| ------------------- | -------------------------------------- | ------------------------------------------ |
| `unfamiliar_entity` | NER + low KG confidence                | "I've been playing Balatro" → unknown game |
| `correction`        | Pattern match + semantic contradiction | "No, it's actually X"                      |
| `emotional_peak`    | Emotion intensity > threshold          | User very excited about topic              |
| `unfinished_thread` | Topic embedding jump + open question   | Conversation pivoted mid-discussion        |
| `knowledge_gap`     | AI hedging / low confidence markers    | "I think..." / "I believe..."              |
| `research_chain`    | Prior exploration spawned new question | Learning about X revealed Y                |

### 1.3 Priority Calculation

```python
def compute_curiosity_priority(item: CuriosityExtra) -> float:
    weights = {
        "user_interest": 0.30,      # How engaged was user
        "knowledge_gap": 0.25,      # How uncertain was AI
        "type_weight": 0.20,        # correction > emotional > unfamiliar
        "recency": 0.15,            # Newer items preferred
        "exploration_count": 0.10,  # Unexplored items boosted
    }
    # Corrections get highest type weight (0.9)
    # Emotional peaks get 0.7
    # Others get 0.5
    ...
```

### 1.4 Backlog Management

| Constraint        | Value        | Rationale                      |
| ----------------- | ------------ | ------------------------------ |
| Max pending items | 100          | Prevent unbounded growth       |
| Max per type      | 25           | No single type dominates       |
| Default TTL       | 14 days      | Stale items expire             |
| Correction TTL    | 7 days       | Corrections are urgent         |
| Prune threshold   | < 0.15 score | Very low priority auto-expires |

Deduplication: Normalize topic text, boost priority on repeat triggers.

---

## 2. FSM Integration

### 2.1 New State: EXPLORING

Add to existing `AmbientState` enum:

```python
class AmbientState(Enum):
    IDLE = "idle"              # User recently engaged, long wait
    MONITORING = "monitoring"  # Actively watching for opportunity
    ENGAGED = "engaged"        # Just sent notification
    COOLDOWN = "cooldown"      # User ignored, backing off
    ESCALATING = "escalating"  # Critical unacknowledged tasks
    SUPPRESSED = "suppressed"  # User busy/focused
    EXPLORING = "exploring"    # NEW: Doing autonomous work
```

### 2.2 State Transitions

```
IDLE ──(user away >30 min AND backlog has items)──> EXPLORING
EXPLORING ──(user becomes active)──> MONITORING
EXPLORING ──(backlog empty OR budget exhausted)──> IDLE
EXPLORING ──(finding worth sharing)──> ENGAGED (optional)
```

### 2.3 Interval Configuration

```python
@dataclass
class ExploringConfig:
    min_idle_before_exploring: int = 1800  # 30 min
    exploration_interval: tuple[int, int] = (300, 600)  # 5-10 min between items
    max_explorations_per_day: int = 20
    max_daily_cost_usd: float = 0.50  # Budget cap
```

---

## 3. Exploration Execution

### 3.1 Work Selection

```python
async def select_curiosity_to_explore(
    db: AsyncSession,
    user_id: str,
) -> ProjectTask | None:
    """Get highest priority unexplored curiosity."""
    return await db.execute(
        select(ProjectTask)
        .where(
            ProjectTask.task_type == "curiosity",
            ProjectTask.status == "ready",
            ProjectTask.user_id == user_id,
        )
        .order_by(
            ProjectTask.priority.desc(),
            ProjectTask.created_at.asc(),
        )
        .limit(1)
    ).scalar_one_or_none()
```

### 3.2 Exploration Mission

Execute via existing `MissionExecutor`:

```python
EXPLORATION_PROMPT = """
You are exploring a topic the user mentioned: {topic}

Context from conversation:
{source_context}

Your task:
1. Research this topic using available tools (web search, knowledge lookup)
2. Gather key facts that would be useful for future conversations
3. Note any follow-up questions worth exploring

Output JSON:
{
    "findings": ["fact 1", "fact 2", ...],
    "confidence": 0.0-1.0,
    "follow_up_questions": ["question 1", ...],
    "worth_sharing": true/false,
    "share_message": "optional message if worth sharing"
}
"""
```

### 3.3 Silence-as-Default Logic

```python
async def handle_exploration_result(result: ExplorationResult):
    # Always store findings
    await store_findings(result.findings)

    # Only notify if explicitly worth sharing AND high confidence
    if result.worth_sharing and result.confidence > 0.8:
        # Queue for next natural conversation touchpoint
        await queue_finding_for_surfacing(result)

    # Spawn follow-up curiosities
    for question in result.follow_up_questions:
        await create_curiosity_item(
            topic=question,
            curiosity_type="research_chain",
            priority=0.5,  # Lower than direct triggers
        )
```

---

## 4. Memory Integration

### 4.1 Storage Tiers

```
┌─────────────────────────────────────────────────────────┐
│  EPHEMERAL: Swarm Scratchpad                            │
│  - Working notes during active exploration              │
│  - Discarded after exploration completes                │
├─────────────────────────────────────────────────────────┤
│  DURABLE: ProjectTask.extra["findings"]                 │
│  - Persisted exploration results                        │
│  - Searchable via work queue queries                    │
├─────────────────────────────────────────────────────────┤
│  INDEXED: Knowledge Graph FactNode                      │
│  - High-confidence verified facts                       │
│  - Hybrid searchable (vector + BM25)                    │
│  - Temporal validity (valid_at, invalid_at)             │
├─────────────────────────────────────────────────────────┤
│  CORE: Human Memory Block                               │
│  - User preferences discovered                          │
│  - Relationship-building insights                       │
│  - Always in context                                    │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Finding → Fact Promotion

```python
async def promote_finding_to_fact(
    finding: str,
    source_curiosity_id: int,
    confidence: float,
) -> FactNode | None:
    """Promote high-confidence finding to KG fact."""
    if confidence < 0.7:
        return None  # Keep in task extra only

    fact = await create_fact(
        text=finding,
        fact_type="exploration_finding",
        source=f"curiosity:{source_curiosity_id}",
        confidence=confidence,
    )
    return fact
```

### 4.3 Surfacing in Conversation

Extend existing recall search:

```python
async def gather_relevant_context(
    query: str,
    user_id: str,
    session_id: int,
) -> list[str]:
    # Standard recall
    recall_results = await recall_search(query, user_id)

    # Add exploration findings
    exploration_results = await search_exploration_findings(
        query=query,
        user_id=user_id,
        exclude_surfaced_in_session=session_id,
    )

    return merge_with_rrf(recall_results, exploration_results)
```

### 4.4 Repetition Avoidance

```python
async def mark_finding_surfaced(
    finding_id: int,
    session_id: int,
):
    """Track that we've shared this finding."""
    await db.execute(
        insert(SurfacedFinding).values(
            finding_id=finding_id,
            session_id=session_id,
            surfaced_at=datetime.now(UTC),
        )
    )

# Query filter: exclude if surfaced in last 7 days
.where(
    ~exists(
        select(SurfacedFinding)
        .where(
            SurfacedFinding.finding_id == Finding.id,
            SurfacedFinding.surfaced_at > datetime.now(UTC) - timedelta(days=7),
        )
    )
)
```

---

## 5. Implementation Roadmap

### Phase 1: MVP

**Goal:** Basic exploration during idle time

| Task                                    | Files                                     | Effort |
| --------------------------------------- | ----------------------------------------- | ------ |
| Add `EXPLORING` state to FSM            | `packages/daemon/src/ambient-fsm.ts`      | S      |
| Add state transition logic              | `packages/daemon/src/ambient-fsm.ts`      | S      |
| Add `ExploringConfig`                   | `packages/daemon/src/ambient-config.ts`   | S      |
| Create exploration work selection       | `packages/daemon/src/ambient-explorer.ts` | M      |
| Add `_do_exploration_work()` to monitor | `packages/daemon/src/ambient-monitor.ts`  | M      |
| Create curiosity task type handling     | `packages/daemon/src/work-queue.ts`       | S      |

**Deliverable:** Can manually add curiosity tasks, dere explores them during idle.

### Phase 2: Automatic Curiosity Detection

**Goal:** Detect curiosity triggers from conversations

| Task                       | Files                                                 | Effort |
| -------------------------- | ----------------------------------------------------- | ------ |
| Unfamiliar entity detector | `packages/daemon/src/ambient-triggers/entities.ts`    | M      |
| Correction detector        | `packages/daemon/src/ambient-triggers/corrections.ts` | M      |
| Emotional peak detector    | `packages/daemon/src/ambient-triggers/emotions.ts`    | S      |
| Post-conversation hook     | `packages/daemon/src/conversations.ts`                | S      |
| Priority calculation       | `packages/daemon/src/ambient-triggers/priority.ts`    | S      |

**Deliverable:** Curiosity items auto-created from conversation analysis.

### Phase 3: Finding Integration

**Goal:** Findings surface naturally in future conversations

| Task                    | Files                                     | Effort |
| ----------------------- | ----------------------------------------- | ------ |
| Finding storage model   | `packages/daemon/src/db-types.ts`         | S      |
| Finding → KG promotion  | `packages/daemon/src/ambient-explorer.ts` | M      |
| Extended recall search  | `packages/daemon/src/recall.ts`           | M      |
| Surfacing deduplication | `packages/daemon/src/recall.ts`           | S      |

**Deliverable:** "While you were away, I learned X" appears naturally.

### Phase 4: Polish

**Goal:** Belief revision, metrics, tuning

| Task                              | Files                                     | Effort |
| --------------------------------- | ----------------------------------------- | ------ |
| Contradicting fact detection      | `packages/dere-graph/src/graph-dedup.ts`  | M      |
| Supersedes/superseded_by tracking | `packages/dere-graph/src/graph-models.ts` | S      |
| Exploration metrics dashboard     | `packages/daemon/src/metrics.ts`          | M      |
| Cost tracking                     | `packages/daemon/src/ambient-explorer.ts` | S      |

---

## 6. Open Questions

| Question                  | Options                       | Recommendation                          |
| ------------------------- | ----------------------------- | --------------------------------------- |
| Exploration working_dir?  | User home vs project-specific | User home (curiosity is cross-project)  |
| Concurrent session limit? | 1 vs allow parallel           | 1 (avoid resource contention)           |
| Tool write access?        | Read-only vs full             | Read-only for MVP (safer)               |
| Daily cost budget?        | Fixed vs user-configurable    | User-configurable with sensible default |
| Notification of findings? | Never vs high-confidence only | High-confidence only, natural insertion |

---

## 7. Example Flow

```
1. User: "Been playing a lot of Balatro lately"

2. [Post-conversation hook detects "Balatro" - low KG confidence]
   → Creates curiosity item:
     topic: "Balatro"
     type: unfamiliar_entity
     context: "User mentioned playing Balatro"
     priority: 0.6

3. [30 minutes later, user idle]
   → FSM: IDLE → EXPLORING
   → Selects "Balatro" curiosity (highest priority)

4. [Exploration mission runs]
   → Web search: "Balatro game"
   → Findings: ["Roguelike deckbuilder", "Poker mechanics", "Released 2024", "Very positive reviews"]
   → confidence: 0.85
   → worth_sharing: false (not urgent)

5. [Findings stored]
   → ProjectTask.extra.findings updated
   → High-confidence facts promoted to KG

6. [Next day, user mentions cards]
   → Recall search includes: "Balatro is a roguelike deckbuilder with poker mechanics"
   → Assistant naturally references: "Speaking of cards, you mentioned playing Balatro - how's that going?"
```

---

## References

- Strix: https://timkellogg.me/blog/2025/12/15/strix
- MemGPT/Letta: https://docs.letta.com/concepts/memgpt/
- ProactiveAgent: https://github.com/leomariga/ProactiveAgent
- Existing AmbientFSM: `packages/daemon/src/ambient-fsm.ts`
- Existing MissionExecutor: `packages/daemon/src/mission-executor.ts`
- Existing WorkQueue: `packages/daemon/src/work-queue.ts`
