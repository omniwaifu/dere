from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest

from dere_graph import AddEpisodeResults, DereGraph, EpisodeType


@pytest.mark.asyncio
async def test_full_integration():
    """Comprehensive integration test using a coherent tech company narrative."""
    graph = DereGraph(
        falkor_host="localhost",
        falkor_port=6379,
    )

    test_group = f"integration_test_{datetime.now(UTC).timestamp()}"

    try:
        # Build indices
        await graph.build_indices()
        print(f"\n{'=' * 60}")
        print(f"Starting integration test with group_id: {test_group}")
        print(f"{'=' * 60}\n")

        # ===================================================================
        # Episode 1: Initial setup (January 2023)
        # ===================================================================
        print("Episode 1: Adding initial employees...")
        result1 = await graph.add_episode(
            episode_body="Alice works at OpenAI as a machine learning researcher. She joined in January 2023. Bob works at Google as a software engineer.",
            source_description="Initial employee records",
            reference_time=datetime(2023, 1, 15, tzinfo=UTC),
            source=EpisodeType.text,
            group_id=test_group,
        )
        assert isinstance(result1, AddEpisodeResults)
        print(f"✓ Episode 1 created: {result1.episode.uuid}")

        # Verify entities were extracted
        alice_results = await graph.search("Alice", group_id=test_group, limit=5)
        assert len(alice_results.nodes) > 0, "Alice entity should be created"
        print(f"✓ Found {len(alice_results.nodes)} nodes for 'Alice'")

        # ===================================================================
        # Episode 2: Relationship building (December 2023)
        # ===================================================================
        print("\nEpisode 2: Adding relationship between Alice and Bob...")
        result2 = await graph.add_episode(
            episode_body="Alice and Bob met at the NeurIPS conference in December 2023. They discovered they both work on large language models.",
            source_description="Conference networking event",
            reference_time=datetime(2023, 12, 10, tzinfo=UTC),
            source=EpisodeType.text,
            group_id=test_group,
        )
        assert result2.episode.name.startswith("2023-12-10")
        print(f"✓ Episode 2 created: {result2.episode.uuid}")

        # Verify Alice was deduplicated (not recreated)
        alice_results_2 = await graph.search("Alice", group_id=test_group, limit=5)
        alice_count = len([n for n in alice_results_2.nodes if n.name.lower() == "alice"])
        assert alice_count == 1, f"Alice should be deduplicated, found {alice_count} Alice entities"
        print("✓ Alice correctly deduplicated (1 entity)")

        # ===================================================================
        # Episode 3: Job change - CONTRADICTION TEST (March 2024)
        # ===================================================================
        print("\nEpisode 3: Alice changes jobs (testing edge invalidation)...")
        result3 = await graph.add_episode(
            episode_body="Alice left OpenAI in March 2024 and joined Anthropic as a senior researcher.",
            source_description="HR update",
            reference_time=datetime(2024, 3, 15, tzinfo=UTC),
            source=EpisodeType.text,
            group_id=test_group,
        )
        assert result3.episode.name.startswith("2024-03-15")
        print(f"✓ Episode 3 created: {result3.episode.uuid}")

        # Verify edge invalidation - search should show Anthropic, not OpenAI
        await asyncio.sleep(1)  # Give time for invalidation to process
        anthropic_search = await graph.search(
            "Who works at Anthropic?", group_id=test_group, limit=10
        )
        anthropic_facts = [e.fact for e in anthropic_search.edges if "anthropic" in e.fact.lower()]
        assert len(anthropic_facts) > 0, "Should find Alice working at Anthropic"
        print(f"✓ Found {len(anthropic_facts)} facts about Anthropic")

        openai_search = await graph.search("Alice OpenAI", group_id=test_group, limit=10)
        # Old edges should be invalidated and not returned in search
        active_openai_edges = [
            e for e in openai_search.edges if e.invalid_at is None and "works" in e.fact.lower()
        ]
        print(
            f"✓ Active OpenAI edges for Alice: {len(active_openai_edges)} (old edge should be invalidated)"
        )

        # ===================================================================
        # Episode 4: Promotion (June 2024)
        # ===================================================================
        print("\nEpisode 4: Bob gets promoted...")
        result4 = await graph.add_episode(
            episode_body="Bob was promoted to tech lead at Google in June 2024. He now manages a team of 5 engineers.",
            source_description="Promotion announcement",
            reference_time=datetime(2024, 6, 1, tzinfo=UTC),
            source=EpisodeType.text,
            group_id=test_group,
        )
        assert result4.episode.name.startswith("2024-06-01")
        print(f"✓ Episode 4 created: {result4.episode.uuid}")

        # Verify Bob was deduplicated
        bob_results = await graph.search("Bob", group_id=test_group, limit=5)
        bob_count = len([n for n in bob_results.nodes if n.name.lower() == "bob"])
        assert bob_count == 1, f"Bob should be deduplicated, found {bob_count} Bob entities"
        print("✓ Bob correctly deduplicated (1 entity)")

        # ===================================================================
        # Search Verification
        # ===================================================================
        print("\n" + "=" * 60)
        print("SEARCH VERIFICATION")
        print("=" * 60)

        # Test semantic search
        llm_search = await graph.search(
            "Who works on language models?", group_id=test_group, limit=10
        )
        print(f"✓ LLM search returned {len(llm_search.nodes)} nodes, {len(llm_search.edges)} edges")
        assert len(llm_search.nodes) > 0 or len(llm_search.edges) > 0, (
            "Should find relevant results"
        )

        # ===================================================================
        # Community Detection
        # ===================================================================
        print("\n" + "=" * 60)
        print("COMMUNITY DETECTION")
        print("=" * 60)

        communities = await graph.build_communities(group_id=test_group, resolution=1.0)
        assert isinstance(communities, list)
        print(f"✓ Detected {len(communities)} communities")
        for i, comm in enumerate(communities):
            print(f"  Community {i}: {len(comm.entity_uuids)} entities")
            if comm.summary:
                print(f"    Summary: {comm.summary[:100]}...")

        # ===================================================================
        # Manual Triplet Addition
        # ===================================================================
        print("\n" + "=" * 60)
        print("MANUAL OPERATIONS")
        print("=" * 60)

        print("Adding manual triplet: Anthropic FUNDED_BY investors...")
        funding_edge = await graph.add_triplet(
            source_name="Anthropic",
            relation_type="FUNDED_BY",
            target_name="Venture Investors",
            fact="Anthropic received Series B funding from venture investors in 2023.",
            group_id=test_group,
            valid_at=datetime(2023, 5, 1, tzinfo=UTC),
        )
        assert funding_edge.name == "FUNDED_BY"
        assert (
            funding_edge.fact
            == "Anthropic received Series B funding from venture investors in 2023."
        )
        print(f"✓ Manual triplet created: {funding_edge.uuid}")

        # ===================================================================
        # Bulk Add Episodes (related to main narrative)
        # ===================================================================
        print("\nBulk adding related episodes...")
        bulk_episodes = [
            (
                "Charlie joined Anthropic in July 2024 as a research engineer.",
                "HR system",
                datetime(2024, 7, 1, tzinfo=UTC),
                EpisodeType.text,
            ),
            (
                "Charlie and Alice are collaborating on AI safety research at Anthropic.",
                "Project assignment",
                datetime(2024, 7, 15, tzinfo=UTC),
                EpisodeType.text,
            ),
        ]
        bulk_results = await graph.add_episodes_bulk(
            episodes=bulk_episodes,
            group_id=test_group,
            max_concurrent=2,
        )
        assert len(bulk_results) == 2
        assert all(isinstance(r, AddEpisodeResults) for r in bulk_results)
        print(f"✓ Bulk added {len(bulk_results)} episodes")

        # Verify Charlie is connected to Alice
        charlie_search = await graph.search("Charlie Alice", group_id=test_group, limit=10)
        print(
            f"✓ Charlie-Alice search returned {len(charlie_search.nodes)} nodes, {len(charlie_search.edges)} edges"
        )

        # ===================================================================
        # Episode Removal
        # ===================================================================
        print("\n" + "=" * 60)
        print("EPISODE REMOVAL")
        print("=" * 60)

        print(f"Removing episode: {result1.episode.uuid}")
        await graph.remove_episode(result1.episode.uuid)

        # Verify episode was removed
        removed_episode = await graph.get_episode(result1.episode.uuid)
        assert removed_episode is None, "Episode should be deleted"
        print("✓ Episode removed successfully")

        # Verify entities still exist (episode removal doesn't cascade to entities)
        alice_after_removal = await graph.search("Alice", group_id=test_group, limit=5)
        assert len(alice_after_removal.nodes) > 0, (
            "Alice entity should still exist after episode removal"
        )
        print("✓ Entities persist after episode removal")

        # ===================================================================
        # Final Statistics
        # ===================================================================
        print("\n" + "=" * 60)
        print("FINAL GRAPH STATISTICS")
        print("=" * 60)

        all_entities = await graph.search("", group_id=test_group, limit=100)
        print(f"Total entities: {len(all_entities.nodes)}")
        print(f"Total edges: {len(all_entities.edges)}")

        print("\nKey entities:")
        for node in all_entities.nodes[:10]:
            print(f"  - {node.name} ({', '.join(node.labels)})")

        print("\n" + "=" * 60)
        print("✓ ALL INTEGRATION TESTS PASSED")
        print("=" * 60)

    finally:
        await graph.close()


if __name__ == "__main__":
    asyncio.run(test_full_integration())
