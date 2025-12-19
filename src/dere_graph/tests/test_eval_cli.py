from __future__ import annotations

from dere_graph.eval_cli import default_dataset_path, filter_cases
from dere_graph.evals import load_eval_cases


def test_default_dataset_path_exists() -> None:
    path = default_dataset_path()
    assert path.exists()


def test_filter_cases_limits_selection() -> None:
    cases = load_eval_cases(default_dataset_path())
    filtered = filter_cases(cases, [cases[0].name])

    assert len(filtered) == 1
    assert filtered[0].name == cases[0].name
