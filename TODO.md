# TODO — `dere_graph` “Brain” Roadmap (Graphiti/Zep Parity + Extensions)

This repo’s `src/dere_graph` is a minimal Graphiti-like “agent memory” graph:
- Storage: FalkorDB
- Embeddings: OpenAI
- Extraction/Resolution: Claude via `claude-agent-sdk` structured output (`src/dere_shared/llm_client.py`)

Reference architecture: “Zep: A Temporal Knowledge Graph Architecture for Agent Memory” (arXiv:2501.13956) and the
Graphiti OSS implementation (`/mnt/data/Code/graphiti`).

The checklist below captures what we *haven’t* implemented (or only partially implemented) relative to the paper/Graphiti,
in a logical build order with the “why”.

---

## Guiding Architecture (code + relationships + everything)

Recommendation: **one graph, multiple domains**, not totally separate “brains”.
- Use a single backing graph DB (so entities can connect across domains), but **tag everything**:
  - `group_id` for tenant/workspace/user partitioning
  - labels / types for domain: `Person`, `Repo`, `File`, `Symbol`, `Project`, `Task`, `Preference`, etc.
  - episode/source metadata: conversational vs code-ingestion vs docs vs web vs tools
- Run **different ingestion pipelines per domain**, but write into the same graph (so “Justin works on dere” can connect to
  actual repo/file/symbol nodes).

When to split:
- If code memory is rebuilt from source-of-truth (git) and conversational memory is append-only, you *can* split graphs for
  ops/perf; but you still need a unifying layer (shared IDs or cross-graph links). Prefer “one DB, multiple subgraphs” first.

---

## Phase 0 — Correctness + “parity-critical” fundamentals

These unlock everything else; do them first.

- [x] **Make the temporal model internally consistent (bi-temporal fields + queries)**
  - Why: point-in-time queries and contradiction invalidation only work if timestamps are correct and consistently stored.
  - Paper/Graphiti: transactional timeline (`t'created`, `t'expired`) + event timeline (`t_valid`, `t_invalid`).
  - Current state: edges and nodes carry consistent ISO timestamps; temporal filters and point-in-time queries compare the
    same representation, and nodes now support `expired_at`.
  - Files: `src/dere_graph/dere_graph/models.py`, `src/dere_graph/dere_graph/driver.py`

- [x] **Persist and maintain “bidirectional indices” between episodes and facts**
  - Why: citation/quotation and provenance; fast traversal from an edge back to its source episode(s).
  - Paper/Graphiti: episodic edges + semantic edges store pointers to episodes.
  - Current state: we write `MENTIONS` edges (episode → entity), store `EntityEdge.episodes`, and persist
    `EpisodicNode.entity_edges` for reverse lookup.
  - Files: `src/dere_graph/dere_graph/operations.py`, `src/dere_graph/dere_graph/models.py`, `src/dere_graph/dere_graph/driver.py`

- [x] **Include short conversational context during entity extraction + require speaker entity**
  - Why: pronoun resolution (“I”, “you”), disambiguation, better recall; the paper explicitly uses the last *n* messages.
  - Current state: initial extraction includes recent context (previous messages) and we deterministically ensure the speaker
    entity exists and is first.
  - Files: `src/dere_graph/dere_graph/operations.py`, `src/dere_graph/dere_graph/prompts.py`

- [x] **Generate and store entity summaries (and update canonical name/summary during resolution)**
  - Why: (1) improves dedupe, (2) improves BM25 retrieval, (3) enables stable canonicalization over time.
  - Current state: extracted entities get a concise per-entity summary pass; dedupe applies canonical names and will
    propagate summaries into existing entities when missing.
  - Files: `src/dere_graph/dere_graph/models.py`, `src/dere_graph/dere_graph/prompts.py`, `src/dere_graph/dere_graph/operations.py`

---

## Phase 1 — Ingestion richness (make the graph worth retrieving)

- [x] **Add explicit “node attribute extraction / hydration”**
  - Why: Graphiti extracts richer structured attributes beyond just type/name, improving retrieval and future reasoning.
  - Current state: optional dedicated hydration pass (`enable_attribute_hydration`) runs post-dedup to enrich/normalize
    `EntityNode.attributes` (best-effort + schema validation when ontology is provided).
  - Files: `src/dere_graph/dere_graph/prompts.py`, `src/dere_graph/dere_graph/operations.py`, `src/dere_graph/dere_graph/graph.py`, `src/dere_daemon/main.py`, `config.toml.example`

- [x] **Implement typed ontologies (custom entity types + edge types) end-to-end**
  - Why: “all-encompassing brain” needs different schemas for code vs people vs tasks; reduces ambiguity and dedupe errors.
  - Current state: `DereGraph.add_episode()` accepts `entity_types`/`edge_types` (schema dicts), passes allowlists into
    extraction prompts, best-effort validates attributes via `apply_*_schema`, and persists edge attributes.
  - Files: `src/dere_graph/dere_graph/models.py`, `src/dere_graph/dere_graph/prompts.py`, `src/dere_graph/dere_graph/operations.py`, `src/dere_graph/dere_graph/driver.py`, `src/dere_graph/dere_graph/graph.py`

- [x] **Episode-type specific ingestion (message vs text vs JSON vs code/doc)**
  - Why: code and JSON need different prompts and pre-processing; “one prompt” will underperform or hallucinate structure.
  - Current state: `EpisodeType` supports `code`/`doc`; ingestion adjusts prompts + pre-processing (JSON pretty-printing;
    code/doc extraction instructions) based on episode type.
  - Files: `src/dere_graph/dere_graph/models.py`, `src/dere_graph/dere_graph/operations.py`, `src/dere_graph/dere_graph/prompts.py`

- [ ] **Decide and implement temporal extraction strategy**
  - Why: paper describes a dedicated temporal extraction step; we currently request timestamps inline during fact extraction.
  - Options:
    - Keep “timestamps inline” but make prompts + parsing robust, or
    - Add a second pass per edge using an `extract_edge_dates`-style prompt.
  - Files: `src/dere_graph/dere_graph/prompts.py`, `src/dere_graph/dere_graph/operations.py`

- [ ] **Support “hyper-edge” / n-ary fact representation (optional, but paper calls it out)**
  - Why: a single fact can involve >2 entities (meeting, project, decision); forcing it into pairwise edges loses structure.
  - Possible approach: represent Facts as nodes and connect entities via roles (reification), while still keeping pairwise
    shortcuts for retrieval.

---

## Phase 2 — Retrieval parity (make it easy to get the right context)

- [ ] **Integrate BFS expansion into the default search path**
  - Why: paper uses cosine + BM25 + BFS for recall; our BFS utilities exist but aren’t part of `DereGraph.search()`.
  - Files: `src/dere_graph/dere_graph/graph.py`, `src/dere_graph/dere_graph/traversal.py`

- [ ] **Seed BFS from “recent / conversation-relevant episodes”**
  - Why: the paper highlights using recent episodes to pull in recently-mentioned entities/edges that match current context.
  - Current state: we fetch previous episodes for ingestion, but retrieval doesn’t use them as BFS seeds.

- [ ] **Community subgraph parity (persisted communities + searchable community names)**
  - Why: communities can summarize large regions and provide higher-level retrieval anchors.
  - Paper/Graphiti: label propagation + dynamic extension + periodic refresh + embedded community names.
  - Current state: we can detect/summarize communities, but don’t persist them as first-class retrievable objects.
  - Files: `src/dere_graph/dere_graph/communities.py`

- [ ] **Cross-encoder reranker (optional / feature-flagged)**
  - Why: highest precision; most expensive. Use only when you can afford latency/cost.
  - Current state: not implemented.

- [ ] **Domain-aware query routing (“brain views”)**
  - Why: a user asking “Where is this bug?” should hit code+git+issues; “How does Alice feel?” should hit relationship memory.
  - Approach: classify query intent → choose subgraphs (by labels/types) → run searches → merge with RRF/MMR.

- [ ] **Context assembly + citations back to episodes**
  - Why: “brain” is only useful if the agent can quote/prove where facts came from (and avoid stale/invalid facts).
  - Current state: we store `EntityEdge.episodes` but don’t expose a robust “cite this fact” retrieval path.

---

## Phase 3 — Feedback loops, evals, and ops

- [ ] **Wire retrospective signals into the agent runtime**
  - Why: we added `retrieval_count` / `citation_count` / `retrieval_quality`, but they must be updated from real agent usage.
  - Files: `src/dere_graph/dere_graph/operations.py` (tracking helpers exist), dere daemon/agent integration needed.

- [ ] **Add ingestion/retrieval evaluation harness**
  - Why: regression prevention; prompts will drift. Need a repeatable suite of “known conversations → expected facts”.
  - Suggested: small golden datasets for (a) relationships, (b) code changes, (c) long-running project state.

- [ ] **Optional: reduce dependency costs**
  - Why: current design still pays OpenAI for embeddings; consider local embeddings or a cheaper provider if needed.
  - Files: `src/dere_graph/dere_graph/embeddings.py`
