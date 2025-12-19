from __future__ import annotations

from datetime import UTC, datetime

from dere_graph.evals import EvalQuery, score_query_results
from dere_graph.models import EntityEdge, EntityNode, FactNode


def _node(uuid: str, name: str, aliases: list[str] | None = None) -> EntityNode:
    node = EntityNode(uuid=uuid, name=name, group_id="test")
    if aliases:
        node.aliases = aliases
    return node


def _edge(uuid: str, source: str, target: str, fact: str) -> EntityEdge:
    return EntityEdge(
        uuid=uuid,
        name="RELATED",
        fact=fact,
        group_id="test",
        source_node_uuid=source,
        target_node_uuid=target,
        created_at=datetime.now(UTC),
    )


def _fact(uuid: str, fact: str) -> FactNode:
    return FactNode(
        uuid=uuid,
        name=fact,
        fact=fact,
        group_id="test",
        created_at=datetime.now(UTC),
    )


def test_score_query_results_counts_matches() -> None:
    nodes = [
        _node("1", "Alice"),
        _node("2", "Bob", aliases=["Bobby"]),
    ]
    edges = [
        _edge("e1", "1", "2", "Alice works at OpenAI"),
    ]
    facts = []
    query = EvalQuery(
        query="Who works at OpenAI?",
        expected_entities=["Alice", "Bob"],
        expected_facts=["works at OpenAI"],
    )

    score = score_query_results(nodes, edges, facts, query)

    assert score.entity_hits == 2
    assert score.fact_hits == 1
    assert score.passed is True


def test_score_query_results_requires_min_hits() -> None:
    nodes = [_node("1", "Alice")]
    edges = []
    facts = []
    query = EvalQuery(
        query="Who is involved?",
        expected_entities=["Alice", "Bob"],
        min_entity_hits=2,
    )

    score = score_query_results(nodes, edges, facts, query)

    assert score.entity_hits == 1
    assert score.passed is False


def test_score_query_results_counts_fact_nodes() -> None:
    nodes = [_node("1", "Apollo")]
    edges = []
    facts = [_fact("f1", "Apollo milestone is blocked by authentication bug")]
    query = EvalQuery(
        query="What is blocking Apollo?",
        expected_facts=["blocked by authentication bug"],
    )

    score = score_query_results(nodes, edges, facts, query)

    assert score.fact_hits == 1
    assert score.passed is True
