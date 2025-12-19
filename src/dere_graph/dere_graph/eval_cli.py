from __future__ import annotations

import argparse
import asyncio
import os
import time
from pathlib import Path

from dere_graph import DereGraph
from dere_graph.evals import EvalCase, format_eval_report, load_eval_cases, run_eval_case


def default_dataset_path() -> Path:
    return Path(__file__).resolve().parents[1] / "tests" / "data" / "eval_cases.json"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run dere_graph evaluation cases.")
    parser.add_argument(
        "--dataset",
        help="Path to eval dataset JSON file",
        default=None,
    )
    parser.add_argument(
        "--case",
        action="append",
        default=[],
        help="Case name to run (repeatable). Runs all if omitted.",
    )
    parser.add_argument(
        "--group-id",
        default=None,
        help="Group ID for eval run (defaults to eval_<timestamp>).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="Search limit per query.",
    )
    parser.add_argument(
        "--openai-key",
        default=None,
        help="Override OPENAI_API_KEY for embeddings.",
    )
    return parser.parse_args(argv)


def filter_cases(cases: list[EvalCase], names: list[str]) -> list[EvalCase]:
    if not names:
        return cases
    name_set = set(names)
    return [case for case in cases if case.name in name_set]


async def run_cli(args: argparse.Namespace) -> int:
    dataset_path = Path(args.dataset) if args.dataset else default_dataset_path()
    cases = load_eval_cases(dataset_path)
    cases = filter_cases(cases, args.case)
    if not cases:
        print("No matching eval cases found.")
        return 1

    group_id = args.group_id or f"eval_{int(time.time())}"
    openai_key = args.openai_key or os.getenv("OPENAI_API_KEY")
    if not openai_key:
        print("OPENAI_API_KEY is required to run evals.")
        return 1

    graph = DereGraph(openai_api_key=openai_key)
    await graph.build_indices()

    try:
        passed = True
        for case in cases:
            result = await run_eval_case(graph, case, group_id=group_id, search_limit=args.limit)
            print(format_eval_report(result))
            passed = passed and result.passed
        return 0 if passed else 1
    finally:
        await graph.close()


def main() -> None:
    args = parse_args()
    raise SystemExit(asyncio.run(run_cli(args)))


if __name__ == "__main__":
    main()
