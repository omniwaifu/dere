from __future__ import annotations

from dataclasses import dataclass

from dere_graph.filters import SearchFilters


@dataclass(frozen=True)
class DomainRoute:
    name: str
    keywords: tuple[str, ...]
    node_labels: tuple[str, ...] = ()
    edge_types: tuple[str, ...] = ()

    def to_filters(self) -> SearchFilters:
        return SearchFilters(
            node_labels=list(self.node_labels) if self.node_labels else None,
            edge_types=list(self.edge_types) if self.edge_types else None,
        )


DEFAULT_DOMAIN_ROUTES = [
    DomainRoute(
        name="code",
        keywords=(
            "bug",
            "error",
            "stacktrace",
            "traceback",
            "function",
            "method",
            "class",
            "module",
            "package",
            "file",
            "repo",
            "repository",
            "commit",
            "branch",
            "pr",
            "issue",
            "test",
            "build",
            "deploy",
        ),
        node_labels=(
            "Repo",
            "File",
            "Symbol",
            "Function",
            "Class",
            "Method",
            "Module",
            "Package",
            "Commit",
            "Issue",
            "PullRequest",
            "Branch",
            "Test",
        ),
    ),
    DomainRoute(
        name="people",
        keywords=(
            "who",
            "person",
            "people",
            "team",
            "user",
            "feel",
            "feeling",
            "prefer",
            "preference",
            "likes",
            "dislikes",
            "relationship",
        ),
        node_labels=(
            "Person",
            "User",
            "Team",
            "Organization",
            "Preference",
        ),
    ),
    DomainRoute(
        name="work",
        keywords=(
            "project",
            "task",
            "todo",
            "deadline",
            "milestone",
            "plan",
            "goal",
            "roadmap",
            "deliverable",
            "status",
        ),
        node_labels=(
            "Project",
            "Task",
            "Milestone",
            "Goal",
        ),
    ),
    DomainRoute(
        name="docs",
        keywords=("doc", "docs", "document", "spec", "design", "readme"),
        node_labels=("Doc", "Document", "Spec", "Note"),
    ),
]


def _score_route(query: str, keywords: tuple[str, ...]) -> int:
    return sum(1 for keyword in keywords if keyword in query)


def select_domain_filters(
    query: str,
    routes: list[DomainRoute],
    max_routes: int = 2,
) -> list[SearchFilters]:
    if not query or not query.strip() or max_routes <= 0:
        return []

    query_lower = query.lower()
    scored: list[tuple[int, DomainRoute]] = []
    for route in routes:
        score = _score_route(query_lower, route.keywords)
        if score:
            scored.append((score, route))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [route.to_filters() for _, route in scored[:max_routes]]


def merge_filters(
    base: SearchFilters | None,
    extra: SearchFilters | None,
) -> SearchFilters | None:
    if base is None:
        return extra
    if extra is None:
        return base

    merged = base.model_copy(deep=True)

    if extra.node_labels:
        merged.node_labels = list(dict.fromkeys((merged.node_labels or []) + extra.node_labels))
    if extra.edge_types:
        merged.edge_types = list(dict.fromkeys((merged.edge_types or []) + extra.edge_types))

    return merged
