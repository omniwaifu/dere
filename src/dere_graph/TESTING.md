# Testing dere_graph

## Prerequisites

1. **Neo4j**
   ```bash
   # Using Docker
   docker run -d \
     --name neo4j \
     -p 7474:7474 -p 7687:7687 \
     -e NEO4J_AUTH=neo4j/password \
     neo4j:latest
   ```

2. **Environment Variables**
   ```bash
   export OPENAI_API_KEY="your-key-here"
   # Note: Claude Agent SDK uses the local Claude Code session - no API key needed
   ```

3. **Install Dependencies**
   ```bash
   uv sync
   ```

## Quick Test

Run the example:
```bash
uv run python main.py
```

Expected output:
- Database indices created
- Episode ingested
- Entities extracted (Alice, Bob, OpenAI, San Francisco)
- Edges created (Alice WORKS_AT OpenAI, etc.)
- Search results returned

## Manual Testing

### 1. Test Ingestion

```python
import asyncio
from datetime import UTC, datetime
from dere_graph.graph import DereGraph
from dere_graph.models import EpisodeType

async def test_ingestion():
    graph = DereGraph(
        neo4j_uri="bolt://localhost:7687",
        neo4j_user="neo4j",
        neo4j_password="password",
    )

    await graph.build_indices()

    # Add episode
    result = await graph.add_episode(
        name="test",
        episode_body="Alice works at OpenAI. Bob founded Anthropic.",
        source_description="Test",
        reference_time=datetime.now(UTC),
        source=EpisodeType.text,
    )

    print(f"Episode: {result.episode.uuid}")
    await graph.close()

asyncio.run(test_ingestion())
```

### 2. Test Search

```python
async def test_search():
    graph = DereGraph(
        neo4j_uri="bolt://localhost:7687",
        neo4j_user="neo4j",
        neo4j_password="password",
    )

    results = await graph.search("Who works at OpenAI?")

    print(f"Nodes: {len(results.nodes)}")
    for node in results.nodes:
        print(f"  {node.name}: {node.summary}")

    print(f"Edges: {len(results.edges)}")
    for edge in results.edges:
        print(f"  {edge.name}: {edge.fact}")

    await graph.close()

asyncio.run(test_search())
```

### 3. Test Node Retrieval

```python
async def test_get_node():
    graph = DereGraph(
        neo4j_uri="bolt://localhost:7687",
        neo4j_user="neo4j",
        neo4j_password="password",
    )

    # First, search to get a UUID
    results = await graph.search("Alice")
    if results.nodes:
        uuid = results.nodes[0].uuid

        # Then retrieve by UUID
        node = await graph.get_node(uuid)
        print(f"Retrieved: {node.name}")
        print(f"Labels: {node.labels}")
        print(f"Summary: {node.summary}")

    await graph.close()

asyncio.run(test_get_node())
```

## Verify in Neo4j Browser

1. Open http://localhost:7474
2. Login (neo4j/password)
3. Run queries:

```cypher
// View all nodes
MATCH (n) RETURN n LIMIT 25;

// View all relationships
MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 25;

// Check entity nodes
MATCH (n:Entity) RETURN n.name, n.summary, labels(n);

// Check edges with facts
MATCH ()-[r:RELATES_TO]->() RETURN r.name, r.fact, r.valid_at;

// Check episodes
MATCH (e:Episodic) RETURN e.name, e.content, e.valid_at;

// Check episodic edges (episode mentions)
MATCH (e:Episodic)-[m:MENTIONS]->(n:Entity)
RETURN e.name, n.name;
```

## Common Issues

### 1. "No module named 'claude_agent_sdk'"
```bash
uv add claude-agent-sdk
```

### 2. "Connection refused" to Neo4j
Check Docker container is running:
```bash
docker ps | grep neo4j
docker logs neo4j
```

### 3. "OpenAI API key not found"
```bash
export OPENAI_API_KEY="sk-..."
```

### 4. LLM Client Issues
The llm_client.py uses Claude Agent SDK's tool pattern. If it fails:
- Check the SDK is installed correctly
- Ensure you're running inside Claude Code (SDK uses local session)
- Check model name is valid

## Unit Tests

Create `tests/test_basic.py`:

```python
import pytest
from datetime import UTC, datetime
from dere_graph.models import EntityNode, EpisodeType, EpisodicNode

def test_entity_node_creation():
    node = EntityNode(
        name="Alice",
        group_id="test",
        labels=["Entity", "Person"],
        summary="A person",
    )
    assert node.name == "Alice"
    assert "Person" in node.labels

def test_episodic_node_creation():
    episode = EpisodicNode(
        name="test_episode",
        group_id="test",
        source=EpisodeType.text,
        content="Test content",
        source_description="Test",
        valid_at=datetime.now(UTC),
    )
    assert episode.source == EpisodeType.text
    assert episode.content == "Test content"

# Add more tests as needed
```

Run:
```bash
uv run pytest tests/
```

## Performance Testing

Monitor ingestion time:
```python
import time

start = time.time()
await graph.add_episode(...)
duration = time.time() - start
print(f"Ingestion took {duration:.2f}s")
```

Expected times (rough estimates):
- Small episode (<100 words): 5-10s
- Medium episode (100-500 words): 10-20s
- Large episode (>500 words): 20-30s

Most time is spent in LLM calls (entity/edge extraction).
