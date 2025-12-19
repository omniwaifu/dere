from __future__ import annotations

from dere_graph.routing import DEFAULT_DOMAIN_ROUTES, select_domain_filters


def test_select_domain_filters_picks_code_route() -> None:
    filters = select_domain_filters("Where is this bug in main.py?", DEFAULT_DOMAIN_ROUTES)

    assert filters
    assert filters[0].node_labels
    assert "File" in filters[0].node_labels


def test_select_domain_filters_picks_people_route() -> None:
    filters = select_domain_filters("How does Alice feel about the plan?", DEFAULT_DOMAIN_ROUTES)

    assert filters
    assert filters[0].node_labels
    assert "Person" in filters[0].node_labels


def test_select_domain_filters_empty_query() -> None:
    filters = select_domain_filters("", DEFAULT_DOMAIN_ROUTES)

    assert filters == []
