from __future__ import annotations

import pytest

from dere_graph.search import calculate_cosine_similarity, rrf, sanitize_lucene_query


def test_cosine_similarity():
    vec1 = [1.0, 0.0, 0.0]
    vec2 = [1.0, 0.0, 0.0]

    similarity = calculate_cosine_similarity(vec1, vec2)
    assert similarity == pytest.approx(1.0)


def test_cosine_similarity_orthogonal():
    vec1 = [1.0, 0.0, 0.0]
    vec2 = [0.0, 1.0, 0.0]

    similarity = calculate_cosine_similarity(vec1, vec2)
    assert similarity == pytest.approx(0.0)


def test_cosine_similarity_zero_vector():
    vec1 = [0.0, 0.0, 0.0]
    vec2 = [1.0, 0.0, 0.0]

    similarity = calculate_cosine_similarity(vec1, vec2)
    assert similarity == 0.0


def test_rrf_basic():
    results = [
        ["uuid1", "uuid2", "uuid3"],
        ["uuid2", "uuid1", "uuid4"],
    ]

    uuids, scores = rrf(results)

    # uuid1 and uuid2 should be at top (both appear in both lists)
    assert "uuid1" in uuids[:2]
    assert "uuid2" in uuids[:2]
    assert len(uuids) == 4
    assert len(scores) == 4


def test_rrf_single_list():
    results = [["uuid1", "uuid2", "uuid3"]]

    uuids, scores = rrf(results)

    assert uuids == ["uuid1", "uuid2", "uuid3"]
    assert len(scores) == 3
    assert scores[0] > scores[1] > scores[2]


def test_sanitize_lucene_query():
    query = "Alice + Bob - test"
    sanitized = sanitize_lucene_query(query)
    assert "\\+" in sanitized
    assert "\\-" in sanitized


def test_sanitize_lucene_query_parens():
    query = "test (with) [brackets]"
    sanitized = sanitize_lucene_query(query)
    assert "\\(" in sanitized
    assert "\\)" in sanitized
    assert "\\[" in sanitized
    assert "\\]" in sanitized


def test_sanitize_lucene_query_clean():
    query = "simple test query"
    sanitized = sanitize_lucene_query(query)
    assert sanitized == query
