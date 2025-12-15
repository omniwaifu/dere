from __future__ import annotations

from datetime import UTC, datetime

from dere_graph.models import EntityEdge, EntityNode, EpisodeType, EpisodicNode


def test_entity_node_creation():
    node = EntityNode(
        name="Alice",
        group_id="test",
        labels=["Entity", "Person"],
        summary="A software engineer",
    )
    assert node.name == "Alice"
    assert "Person" in node.labels
    assert "Entity" in node.labels
    assert node.summary == "A software engineer"
    assert node.uuid is not None


def test_entity_node_with_embedding():
    node = EntityNode(
        name="Bob",
        group_id="test",
        labels=["Entity"],
        summary="",
        name_embedding=[0.1, 0.2, 0.3],
    )
    assert node.name_embedding == [0.1, 0.2, 0.3]


def test_episodic_node_creation():
    now = datetime.now(UTC)
    episode = EpisodicNode(
        name="test_episode",
        group_id="test",
        source=EpisodeType.text,
        content="Alice works at OpenAI",
        source_description="Test conversation",
        valid_at=now,
        conversation_id="2025-01-10",
    )
    assert episode.source == EpisodeType.text
    assert episode.content == "Alice works at OpenAI"
    assert episode.valid_at == now
    assert episode.conversation_id == "2025-01-10"
    assert episode.uuid is not None


def test_entity_edge_creation():
    now = datetime.now(UTC)
    edge = EntityEdge(
        source_node_uuid="uuid1",
        target_node_uuid="uuid2",
        name="WORKS_AT",
        fact="Alice works at OpenAI",
        group_id="test",
        valid_at=now,
    )
    assert edge.name == "WORKS_AT"
    assert edge.fact == "Alice works at OpenAI"
    assert edge.source_node_uuid == "uuid1"
    assert edge.target_node_uuid == "uuid2"
    assert edge.valid_at == now


def test_episode_types():
    assert EpisodeType.text.value == "text"
    assert EpisodeType.message.value == "message"
    assert EpisodeType.json.value == "json"
    assert EpisodeType.code.value == "code"
    assert EpisodeType.doc.value == "doc"
    assert EpisodeType.from_str("text") == EpisodeType.text
    assert EpisodeType.from_str("code") == EpisodeType.code
    assert EpisodeType.from_str("doc") == EpisodeType.doc


def test_node_equality():
    node1 = EntityNode(name="Alice", group_id="test", labels=["Entity"])
    node2 = EntityNode(name="Alice", group_id="test", labels=["Entity"])

    # Different UUIDs, so not equal
    assert node1 != node2

    # Same UUID means equal
    node2.uuid = node1.uuid
    assert node1 == node2


def test_edge_with_temporal_info():
    valid_at = datetime.now(UTC)
    invalid_at = datetime.now(UTC)

    edge = EntityEdge(
        source_node_uuid="uuid1",
        target_node_uuid="uuid2",
        name="WORKED_AT",
        fact="Alice worked at Google",
        group_id="test",
        valid_at=valid_at,
        invalid_at=invalid_at,
    )

    assert edge.valid_at == valid_at
    assert edge.invalid_at == invalid_at
