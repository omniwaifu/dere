from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable

from dere_graph.models import EntityEdge, EntityNode, EpisodeType, FactNode, FactRoleDetail


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
    expected_fact_roles: list["EvalFactRoleExpectation"] = field(default_factory=list)
    min_entity_hits: int | None = None
    min_fact_hits: int | None = None
    min_fact_role_hits: int | None = None


@dataclass(frozen=True)
class EvalRoleBinding:
    role: str
    entity: str
    role_aliases: list[str] = field(default_factory=list)
    entity_aliases: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class EvalFactRoleExpectation:
    fact: str
    roles: list[EvalRoleBinding]


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
    fact_role_hits: int
    fact_role_expected: int
    fact_role_recall: float
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


def _role_matches(expected: EvalRoleBinding, actual: FactRoleDetail) -> bool:
    role_candidates = [expected.role, *expected.role_aliases]
    entity_candidates = [expected.entity, *expected.entity_aliases]

    actual_role = _normalize(actual.role)
    actual_entity = _normalize(actual.entity_name)

    role_match = any(
        candidate
        and (
            _normalize(candidate) == actual_role
            or _normalize(candidate) in actual_role
            or actual_role in _normalize(candidate)
        )
        for candidate in role_candidates
    )
    if not role_match:
        return False

    return any(
        candidate and _normalize(candidate) in actual_entity for candidate in entity_candidates
    )


def _fact_role_expectation_met(
    expectation: EvalFactRoleExpectation,
    facts: list[FactNode],
    fact_roles: dict[str, list[FactRoleDetail]] | None,
) -> bool:
    if not fact_roles:
        return False

    expected_fact = _normalize(expectation.fact)
    candidate_facts = [
        fact
        for fact in facts
        if expected_fact and expected_fact in _normalize(fact.fact or fact.name)
    ]

    for fact in candidate_facts:
        roles = fact_roles.get(fact.uuid, [])
        if not roles:
            continue
        if all(
            any(_role_matches(binding, role) for role in roles)
            for binding in expectation.roles
        ):
            return True
    return False


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
        queries = []
        for query in case.get("queries", []):
            expected_fact_roles = []
            for expectation in query.get("expected_fact_roles", []):
                role_bindings = []
                for role in expectation.get("roles", []):
                    role_value = role.get("role", "")
                    role_aliases: list[str] = []
                    if isinstance(role_value, list):
                        role_aliases = [str(item) for item in role_value[1:]]
                        role_value = str(role_value[0]) if role_value else ""
                    role_aliases.extend([str(item) for item in role.get("role_aliases", [])])

                    entity_value = role.get("entity", "")
                    entity_aliases: list[str] = []
                    if isinstance(entity_value, list):
                        entity_aliases = [str(item) for item in entity_value[1:]]
                        entity_value = str(entity_value[0]) if entity_value else ""
                    entity_aliases.extend([str(item) for item in role.get("entity_aliases", [])])

                    role_bindings.append(
                        EvalRoleBinding(
                            role=str(role_value),
                            entity=str(entity_value),
                            role_aliases=role_aliases,
                            entity_aliases=entity_aliases,
                        )
                    )

                expected_fact_roles.append(
                    EvalFactRoleExpectation(
                        fact=str(expectation.get("fact", "")),
                        roles=role_bindings,
                    )
                )

            queries.append(
                EvalQuery(
                    query=query["query"],
                    expected_entities=query.get("expected_entities", []),
                    expected_facts=query.get("expected_facts", []),
                    expected_fact_roles=expected_fact_roles,
                    min_entity_hits=query.get("min_entity_hits"),
                    min_fact_hits=query.get("min_fact_hits"),
                    min_fact_role_hits=query.get("min_fact_role_hits"),
                )
            )
        cases.append(EvalCase(name=case["name"], episodes=episodes, queries=queries))

    return cases


def score_query_results(
    nodes: list[EntityNode],
    edges: list[EntityEdge],
    facts: list[FactNode],
    query: EvalQuery,
    fact_roles: dict[str, list[FactRoleDetail]] | None = None,
) -> EvalQueryScore:
    expected_entities = query.expected_entities or []
    expected_facts = query.expected_facts or []
    expected_fact_roles = query.expected_fact_roles or []

    entity_candidates = [node.name for node in nodes]
    for node in nodes:
        entity_candidates.extend(node.aliases or [])

    fact_candidates = [edge.fact for edge in edges if edge.fact]
    fact_candidates.extend([fact.fact for fact in facts if fact.fact])

    entity_hits = _match_expected(expected_entities, entity_candidates)
    fact_hits = _match_expected(expected_facts, fact_candidates)

    entity_expected = len(expected_entities)
    fact_expected = len(expected_facts)
    entity_recall = 1.0 if entity_expected == 0 else len(entity_hits) / entity_expected
    fact_recall = 1.0 if fact_expected == 0 else len(fact_hits) / fact_expected

    fact_role_hits = 0
    if expected_fact_roles:
        fact_role_hits = sum(
            1
            for expectation in expected_fact_roles
            if _fact_role_expectation_met(expectation, facts, fact_roles)
        )
    fact_role_expected = len(expected_fact_roles)
    fact_role_recall = (
        1.0 if fact_role_expected == 0 else fact_role_hits / fact_role_expected
    )

    required_entity_hits = (
        query.min_entity_hits if query.min_entity_hits is not None else entity_expected
    )
    required_fact_hits = query.min_fact_hits if query.min_fact_hits is not None else fact_expected
    required_fact_role_hits = (
        query.min_fact_role_hits
        if query.min_fact_role_hits is not None
        else fact_role_expected
    )
    required_entity_hits = 0 if entity_expected == 0 else required_entity_hits
    required_fact_hits = 0 if fact_expected == 0 else required_fact_hits
    required_fact_role_hits = 0 if fact_role_expected == 0 else required_fact_role_hits

    passed = (
        len(entity_hits) >= required_entity_hits
        and len(fact_hits) >= required_fact_hits
        and fact_role_hits >= required_fact_role_hits
    )

    return EvalQueryScore(
        query=query.query,
        entity_hits=len(entity_hits),
        entity_expected=entity_expected,
        entity_recall=entity_recall,
        fact_hits=len(fact_hits),
        fact_expected=fact_expected,
        fact_recall=fact_recall,
        fact_role_hits=fact_role_hits,
        fact_role_expected=fact_role_expected,
        fact_role_recall=fact_role_recall,
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
        fact_roles = {}
        if query.expected_fact_roles:
            fact_roles = await graph.get_fact_roles(results.facts, group_id=group_id)
        query_scores.append(
            score_query_results(
                results.nodes,
                results.edges,
                results.facts,
                query,
                fact_roles=fact_roles,
            )
        )

    passed = all(score.passed for score in query_scores)
    return EvalCaseResult(name=case.name, query_scores=query_scores, passed=passed)


def format_eval_report(result: EvalCaseResult) -> str:
    lines = [f"Case: {result.name} - {'PASS' if result.passed else 'FAIL'}"]
    for score in result.query_scores:
        role_summary = ""
        if score.fact_role_expected:
            role_summary = f" roles {score.fact_role_hits}/{score.fact_role_expected}"
        lines.append(
            f"- {score.query}: entities {score.entity_hits}/{score.entity_expected} "
            f"facts {score.fact_hits}/{score.fact_expected}{role_summary} "
            f"{'PASS' if score.passed else 'FAIL'}"
        )
    return "\n".join(lines)
