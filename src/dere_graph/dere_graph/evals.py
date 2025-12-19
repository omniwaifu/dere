from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable

from dere_graph.models import EntityEdge, EntityNode, EpisodeType


@dataclass(frozen=True)
class EvalEpisode:
    body: str
    source_description: str
    reference_time: datetime
    source: EpisodeType = EpisodeType.text


@dataclass(frozen=True)
class EvalQuery:
    query: str
    expected_entities: list[str] = field(default_factory=list)
    expected_facts: list[str] = field(default_factory=list)
    min_entity_hits: int | None = None
    min_fact_hits: int | None = None


@dataclass(frozen=True)
class EvalCase:
    name: str
    episodes: list[EvalEpisode]
    queries: list[EvalQuery]


@dataclass(frozen=True)
class EvalQueryScore:
    query: str
    entity_hits: int
    entity_expected: int
    entity_recall: float
    fact_hits: int
    fact_expected: int
    fact_recall: float
    passed: bool


@dataclass(frozen=True)
class EvalCaseResult:
    name: str
    query_scores: list[EvalQueryScore]
    passed: bool


def _normalize(text: str) -> str:
    return " ".join(text.lower().split())


def _match_expected(expected: Iterable[str], candidates: Iterable[str]) -> list[str]:
    normalized_candidates = [_normalize(candidate) for candidate in candidates if candidate]
    hits = []
    for item in expected:
        normalized_item = _normalize(item)
        if any(normalized_item in candidate for candidate in normalized_candidates):
            hits.append(item)
    return hits


def _parse_reference_time(value: str) -> datetime:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


def load_eval_cases(path: str | Path) -> list[EvalCase]:
    dataset_path = Path(path)
    data = json.loads(dataset_path.read_text(encoding="utf-8"))
    cases_data = data.get("cases", []) if isinstance(data, dict) else data

    cases: list[EvalCase] = []
    for case in cases_data:
        episodes = [
            EvalEpisode(
                body=episode["body"],
                source_description=episode.get("source_description", "eval"),
                reference_time=_parse_reference_time(episode["reference_time"]),
                source=EpisodeType.from_str(episode.get("source", "text")),
            )
            for episode in case.get("episodes", [])
        ]
        queries = [
            EvalQuery(
                query=query["query"],
                expected_entities=query.get("expected_entities", []),
                expected_facts=query.get("expected_facts", []),
                min_entity_hits=query.get("min_entity_hits"),
                min_fact_hits=query.get("min_fact_hits"),
            )
            for query in case.get("queries", [])
        ]
        cases.append(EvalCase(name=case["name"], episodes=episodes, queries=queries))

    return cases


def score_query_results(
    nodes: list[EntityNode],
    edges: list[EntityEdge],
    query: EvalQuery,
) -> EvalQueryScore:
    expected_entities = query.expected_entities or []
    expected_facts = query.expected_facts or []

    entity_candidates = [node.name for node in nodes]
    for node in nodes:
        entity_candidates.extend(node.aliases or [])

    fact_candidates = [edge.fact for edge in edges if edge.fact]

    entity_hits = _match_expected(expected_entities, entity_candidates)
    fact_hits = _match_expected(expected_facts, fact_candidates)

    entity_expected = len(expected_entities)
    fact_expected = len(expected_facts)
    entity_recall = 1.0 if entity_expected == 0 else len(entity_hits) / entity_expected
    fact_recall = 1.0 if fact_expected == 0 else len(fact_hits) / fact_expected

    required_entity_hits = (
        query.min_entity_hits if query.min_entity_hits is not None else entity_expected
    )
    required_fact_hits = query.min_fact_hits if query.min_fact_hits is not None else fact_expected
    required_entity_hits = 0 if entity_expected == 0 else required_entity_hits
    required_fact_hits = 0 if fact_expected == 0 else required_fact_hits

    passed = len(entity_hits) >= required_entity_hits and len(fact_hits) >= required_fact_hits

    return EvalQueryScore(
        query=query.query,
        entity_hits=len(entity_hits),
        entity_expected=entity_expected,
        entity_recall=entity_recall,
        fact_hits=len(fact_hits),
        fact_expected=fact_expected,
        fact_recall=fact_recall,
        passed=passed,
    )


async def run_eval_case(
    graph,
    case: EvalCase,
    group_id: str,
    search_limit: int = 20,
) -> EvalCaseResult:
    for episode in case.episodes:
        await graph.add_episode(
            episode_body=episode.body,
            source_description=episode.source_description,
            reference_time=episode.reference_time,
            source=episode.source,
            group_id=group_id,
        )

    query_scores = []
    for query in case.queries:
        results = await graph.search(
            query=query.query,
            group_id=group_id,
            limit=search_limit,
        )
        query_scores.append(score_query_results(results.nodes, results.edges, query))

    passed = all(score.passed for score in query_scores)
    return EvalCaseResult(name=case.name, query_scores=query_scores, passed=passed)


def format_eval_report(result: EvalCaseResult) -> str:
    lines = [f"Case: {result.name} - {'PASS' if result.passed else 'FAIL'}"]
    for score in result.query_scores:
        lines.append(
            f"- {score.query}: entities {score.entity_hits}/{score.entity_expected} "
            f"facts {score.fact_hits}/{score.fact_expected} "
            f"{'PASS' if score.passed else 'FAIL'}"
        )
    return "\n".join(lines)
