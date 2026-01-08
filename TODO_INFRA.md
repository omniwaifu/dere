# Infrastructure Hardening TODO

## Tier 1: High Impact, Low Effort

### 1. OpenTelemetry (CNCF)
Unified tracing, metrics, logs. See request flow across Temporal → daemon → Claude API → knowledge graph.

**Effort**: 2-4 hours

**Source**: https://opentelemetry.io/docs/languages/js/

### 2. NATS (Synadia/CNCF)
Lightweight pub/sub. Sub-millisecond latency. Single binary.

Replace polling with events:
- UI real-time updates when agent completes
- Discord notifications without daemon coupling
- Swarm inter-agent communication

**Effort**: 4-8 hours

**Source**: https://docs.nats.io/nats-concepts/overview/compare-nats

### 3. Automerge 3.0 (Ink & Switch)
CRDT with JSON data model. Swarm scratchpad concurrent writes merge automatically.

**Effort**: 4-8 hours

**Source**: https://automerge.org/blog/automerge-2/

## Tier 2: Medium Impact

### 4. Qdrant (Vector DB)
Rust vector search with advanced metadata filtering. Better hybrid search than FalkorDB. Keep FalkorDB for graph, add Qdrant for vectors.

**Effort**: 1-2 days

**Source**: https://qdrant.tech/benchmarks/

### 5. Dragonfly (Redis upgrade)
Redis-compatible, 25x faster, multi-threaded. FalkorDB sits on Redis - swap for free perf.

**Effort**: 2-4 hours

**Source**: https://www.dragonflydb.io

### 6. Feast (Feature Store)
Pre-compute engagement kickoff signals instead of ad-hoc.

**Effort**: 1-2 days

**Source**: https://feast.dev/

## Not Recommended

- **Ray** - Temporal already handles orchestration
- **Turso/libSQL** - Big migration for questionable benefit
