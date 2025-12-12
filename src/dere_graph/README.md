# dere-graph

Knowledge graph library used by `dere` (primarily the daemon) for entity/relationship extraction, retrieval, and “memory” recall.

Current storage + services:
- Graph DB: FalkorDB (RedisGraph-compatible)
- Embeddings: OpenAI (`OPENAI_API_KEY`)
- Optional metadata store: Postgres (used by the daemon for richer context)

## How it’s used in dere

The daemon initializes `dere_graph.DereGraph` when:
- `[dere_graph].enabled = true` (default in `config.toml.example`)
- `OPENAI_API_KEY` is set

If `OPENAI_API_KEY` is missing, dere will run but knowledge graph features will be disabled.

## Development

From repo root:

```bash
just falkordb
just test
```

Graph-only tests (these are not part of the root `pytest` default testpaths):

```bash
uv run pytest -q src/dere_graph/tests
```

More notes: `src/dere_graph/TESTING.md`
