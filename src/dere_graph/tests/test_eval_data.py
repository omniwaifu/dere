from __future__ import annotations

from pathlib import Path

from dere_graph.evals import load_eval_cases
from dere_graph.models import EpisodeType


def test_load_eval_cases_reads_dataset() -> None:
    dataset_path = Path(__file__).parent / "data" / "eval_cases.json"
    cases = load_eval_cases(dataset_path)

    assert len(cases) >= 2
    assert cases[0].episodes
    assert cases[0].queries

    first_episode = cases[0].episodes[0]
    assert first_episode.source == EpisodeType.text


def test_load_eval_cases_reads_min_hits() -> None:
    dataset_path = Path(__file__).parent / "data" / "eval_cases.json"
    cases = load_eval_cases(dataset_path)

    project_case = next(case for case in cases if case.name == "project_state")
    assert project_case.queries[0].min_fact_hits == 1
    assert project_case.queries[0].min_fact_role_hits == 1
    assert project_case.queries[0].expected_fact_roles
