"""Test temporal-only queries without vector search."""
import asyncio
from datetime import datetime, timedelta

from dere_graph.driver import FalkorDriver
from dere_graph.embeddings import OpenAIEmbedder
from dere_graph.filters import ComparisonOperator, DateFilter, SearchFilters
from dere_graph.search import (
    hybrid_edge_search,
    hybrid_node_search,
)


async def test_empty_query():
    driver = FalkorDriver("127.0.0.1", 6379, "test_graph")
    embedder = OpenAIEmbedder()

    # Build temporal filter (last 24 hours)
    filters = SearchFilters(
        created_at=DateFilter(
            operator=ComparisonOperator.GREATER_THAN,
            value=datetime.now() - timedelta(hours=24)
        )
    )

    # Test empty query with temporal filter
    print("Testing empty query with temporal filter...")
    try:
        nodes = await hybrid_node_search(driver, embedder, "", "default", limit=10, filters=filters)
        print(f"✓ Empty query returned {len(nodes)} nodes (no errors)")
    except Exception as e:
        print(f"✗ Error: {e}")

    # Test empty query on edges
    try:
        edges = await hybrid_edge_search(driver, embedder, "", "default", limit=10, filters=filters)
        print(f"✓ Empty edge query returned {len(edges)} edges (no errors)")
    except Exception as e:
        print(f"✗ Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_empty_query())
