from __future__ import annotations

import pytest
from dere_graph.models import EntityNode
from dere_graph.reranking import cross_encoder_rerank


class DummyScorer:
    async def score(self, query: str, candidates: list[str]) -> list[float]:
        return [float(len(text)) for text in candidates]


class MismatchScorer:
    async def score(self, query: str, candidates: list[str]) -> list[float]:
        return [1.0]


@pytest.mark.asyncio
async def test_cross_encoder_rerank_orders_by_score() -> None:
    items = [
        EntityNode(uuid="1", name="Alpha", group_id="test", summary="Short"),
        EntityNode(uuid="2", name="Beta", group_id="test", summary="A much longer summary"),
        EntityNode(uuid="3", name="Gamma", group_id="test", summary="Mid"),
    ]

    reranked = await cross_encoder_rerank(items, "query", DummyScorer(), limit=3)

    assert [item.uuid for item in reranked] == ["2", "1", "3"]


@pytest.mark.asyncio
async def test_cross_encoder_rerank_mismatch_falls_back() -> None:
    items = [
        EntityNode(uuid="1", name="Alpha", group_id="test", summary="Short"),
        EntityNode(uuid="2", name="Beta", group_id="test", summary="A much longer summary"),
    ]

    reranked = await cross_encoder_rerank(items, "query", MismatchScorer(), limit=2)

    assert [item.uuid for item in reranked] == ["1", "2"]
