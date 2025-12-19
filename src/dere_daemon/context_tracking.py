from __future__ import annotations

import re
from typing import Any

from dere_graph.models import EntityEdge, EntityNode


def build_context_metadata(
    nodes: list[EntityNode],
    edges: list[EntityEdge],
) -> dict[str, Any]:
    return {
        "entities": [{"uuid": node.uuid, "name": node.name} for node in nodes],
        "edges": [edge.uuid for edge in edges],
    }


def extract_cited_entity_uuids(
    response_text: str,
    metadata: dict[str, Any] | None,
) -> list[str]:
    if not response_text or not metadata:
        return []

    entities = metadata.get("entities") or []
    if not entities:
        return []

    response_lower = response_text.lower()
    cited: list[str] = []
    seen: set[str] = set()

    for entity in entities:
        uuid = entity.get("uuid")
        name = entity.get("name")
        if not uuid or not name:
            continue
        pattern = r"\b" + re.escape(str(name).lower()) + r"\b"
        if re.search(pattern, response_lower):
            if uuid not in seen:
                cited.append(uuid)
                seen.add(uuid)

    return cited
