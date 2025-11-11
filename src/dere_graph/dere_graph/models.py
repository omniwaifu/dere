from __future__ import annotations

from abc import ABC
from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(UTC)


class EpisodeType(Enum):
    message = "message"
    json = "json"
    text = "text"

    @staticmethod
    def from_str(episode_type: str) -> EpisodeType:
        match episode_type:
            case "message":
                return EpisodeType.message
            case "json":
                return EpisodeType.json
            case "text":
                return EpisodeType.text
            case _:
                raise ValueError(f"Unknown episode type: {episode_type}")


class Node(BaseModel, ABC):
    uuid: str = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(description="name of the node")
    group_id: str = Field(description="partition of the graph")
    labels: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)

    def __hash__(self) -> int:
        return hash(self.uuid)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Node):
            return self.uuid == other.uuid
        return False


class EntityNode(Node):
    name_embedding: list[float] | None = Field(default=None, description="embedding of the name")
    summary: str = Field(description="regional summary of surrounding edges", default="")
    attributes: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional attributes of the node. Dependent on node labels",
    )
    aliases: list[str] = Field(
        default_factory=list,
        description="Alternative names or references for this entity",
    )
    last_mentioned: datetime | None = Field(
        default=None,
        description="Timestamp of most recent MENTIONS edge (updated automatically)",
    )
    mention_count: int = Field(
        default=1,
        description="Number of times this entity has been mentioned (for episode-mentions reranking)",
    )
    retrieval_count: int = Field(
        default=0,
        description="Number of times this entity has been retrieved in searches",
    )
    citation_count: int = Field(
        default=0,
        description="Number of times this entity was cited/used in responses after retrieval",
    )
    retrieval_quality: float = Field(
        default=1.0,
        description="Success rate of retrieval (citation_count / retrieval_count), used for retrospective reranking",
    )


class EpisodicNode(Node):
    source: EpisodeType = Field(description="source type")
    source_description: str = Field(description="description of the data source")
    content: str = Field(description="raw episode data")
    valid_at: datetime = Field(description="datetime of when the original document was created")
    conversation_id: str = Field(
        description="conversation grouping (e.g., YYYY-MM-DD or channel ID)"
    )
    entity_edges: list[str] = Field(
        description="list of entity edges referenced in this episode",
        default_factory=list,
    )
    speaker_id: str | None = Field(
        default=None,
        description="ID of the speaker (e.g., Discord user ID, system username)",
    )
    speaker_name: str | None = Field(
        default=None,
        description="Display name of the speaker for pronoun resolution",
    )
    personality: str | None = Field(
        default=None,
        description="AI personality name for this conversation (e.g., 'Tsun', 'Kuu')",
    )


class CommunityNode(Node):
    name_embedding: list[float] | None = Field(default=None, description="embedding of the name")
    summary: str = Field(description="region summary of member nodes", default="")


class Edge(BaseModel, ABC):
    uuid: str = Field(default_factory=lambda: str(uuid4()))
    group_id: str = Field(description="partition of the graph")
    source_node_uuid: str
    target_node_uuid: str
    created_at: datetime = Field(default_factory=utc_now)

    def __hash__(self) -> int:
        return hash(self.uuid)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Edge):
            return self.uuid == other.uuid
        return False


class EntityEdge(Edge):
    name: str = Field(description="name of the edge, relation name")
    fact: str = Field(description="fact representing the edge and nodes that it connects")
    fact_embedding: list[float] | None = Field(default=None, description="embedding of the fact")
    episodes: list[str] = Field(
        default_factory=list,
        description="list of episode ids that reference these entity edges",
    )
    expired_at: datetime | None = Field(
        default=None, description="datetime of when the node was invalidated"
    )
    strength: float | None = Field(
        default=None,
        description="Intensity/strength of relationship (0.0-1.0, e.g. 'likes' vs 'really loves')",
    )
    valid_at: datetime | None = Field(
        default=None, description="datetime of when the fact became true"
    )
    invalid_at: datetime | None = Field(
        default=None, description="datetime of when the fact stopped being true"
    )
    attributes: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional attributes of the edge. Dependent on edge name",
    )


class EpisodicEdge(Edge):
    pass


class CommunityEdge(Edge):
    pass


# Entity and Edge Type Schema System

def validate_entity_types(entity_types: dict[str, type[BaseModel]]) -> None:
    """Validate that entity type schemas don't conflict with EntityNode fields.

    Args:
        entity_types: Dictionary mapping type names to Pydantic models

    Raises:
        ValueError: If schema has conflicting field names
    """
    reserved_fields = {"uuid", "name", "group_id", "labels", "created_at", "name_embedding", "summary"}

    for type_name, schema in entity_types.items():
        schema_fields = set(schema.model_fields.keys())
        conflicts = schema_fields & reserved_fields
        if conflicts:
            raise ValueError(
                f"Entity type '{type_name}' has fields that conflict with EntityNode: {conflicts}"
            )


def validate_edge_types(edge_types: dict[str, type[BaseModel]]) -> None:
    """Validate that edge type schemas don't conflict with EntityEdge fields.

    Args:
        edge_types: Dictionary mapping type names to Pydantic models

    Raises:
        ValueError: If schema has conflicting field names
    """
    reserved_fields = {
        "uuid", "group_id", "source_node_uuid", "target_node_uuid",
        "created_at", "name", "fact", "fact_embedding", "episodes",
        "expired_at", "valid_at", "invalid_at"
    }

    for type_name, schema in edge_types.items():
        schema_fields = set(schema.model_fields.keys())
        conflicts = schema_fields & reserved_fields
        if conflicts:
            raise ValueError(
                f"Edge type '{type_name}' has fields that conflict with EntityEdge: {conflicts}"
            )


def apply_entity_schema(
    node: EntityNode,
    entity_types: dict[str, type[BaseModel]],
) -> EntityNode:
    """Apply entity type schema validation and populate attributes.

    Args:
        node: EntityNode to validate
        entity_types: Dictionary of type schemas

    Returns:
        Updated EntityNode with validated attributes

    Raises:
        ValueError: If node type not in schema or validation fails
    """
    # Find matching type from labels
    node_type = None
    for label in node.labels:
        if label in entity_types:
            node_type = label
            break

    if not node_type:
        # No schema for this type, return as-is
        return node

    schema = entity_types[node_type]

    # Validate and parse attributes using schema
    try:
        validated = schema.model_validate(node.attributes)
        node.attributes = validated.model_dump()
    except Exception as e:
        raise ValueError(f"Entity type '{node_type}' validation failed: {e}")

    return node


def apply_edge_schema(
    edge: EntityEdge,
    edge_types: dict[str, type[BaseModel]],
) -> EntityEdge:
    """Apply edge type schema validation and populate attributes.

    Args:
        edge: EntityEdge to validate
        edge_types: Dictionary of type schemas

    Returns:
        Updated EntityEdge with validated attributes

    Raises:
        ValueError: If edge type not in schema or validation fails
    """
    if edge.name not in edge_types:
        # No schema for this type, return as-is
        return edge

    schema = edge_types[edge.name]

    # Validate and parse attributes using schema
    try:
        validated = schema.model_validate(edge.attributes)
        edge.attributes = validated.model_dump()
    except Exception as e:
        raise ValueError(f"Edge type '{edge.name}' validation failed: {e}")

    return edge
