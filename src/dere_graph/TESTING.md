# Testing `dere_graph`

`dere_graph` is an async library that expects:

- FalkorDB reachable (RedisGraph-compatible)
- `OPENAI_API_KEY` available for embeddings

Note: the LLM client uses Claude Agent SDK patterns and is intended to run inside a Claude Code session.

## Prereqs

1. **FalkorDB**

From repo root:

```bash
just falkordb
```

2. **Environment variables**

```bash
export OPENAI_API_KEY="sk-..."
```

3. **Install deps**

From repo root:

```bash
uv sync --extra dev
```

Or graph-only:

```bash
cd src/dere_graph
uv sync
```

## Run tests

From repo root (note: root `pytest` doesn’t include these by default):

```bash
uv run pytest -q src/dere_graph/tests
```

From `src/dere_graph`:

```bash
uv run pytest -q tests
```

## Common issues

### FalkorDB connection errors

```bash
docker ps | grep falkordb
docker logs falkordb
```

### Missing OpenAI key

```bash
export OPENAI_API_KEY="sk-..."
```
