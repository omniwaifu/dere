from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from dere_shared.config import get_config_schema
from dere_shared.llm_schemas import LLM_SCHEMA_REGISTRY


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _to_snake(name: str) -> str:
    step1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    step2 = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", step1)
    return step2.lower()


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )


def export_llm_schemas(base_dir: Path) -> list[Path]:
    output_paths: list[Path] = []
    for name, model in LLM_SCHEMA_REGISTRY.items():
        schema = model.model_json_schema()
        filename = f"{_to_snake(name)}.schema.json"
        path = base_dir / "llm" / filename
        _write_json(path, schema)
        output_paths.append(path)
    return output_paths


def export_config_schema(base_dir: Path) -> Path:
    schema = get_config_schema()
    path = base_dir / "config" / "dere_config.schema.json"
    _write_json(path, schema)
    return path


def main() -> None:
    base_dir = _repo_root() / "schemas"
    llm_outputs = export_llm_schemas(base_dir)
    config_output = export_config_schema(base_dir)

    summary = [
        "Exported schemas:",
        *(f"- {path.relative_to(_repo_root())}" for path in llm_outputs),
        f"- {config_output.relative_to(_repo_root())}",
    ]
    print("\n".join(summary))


if __name__ == "__main__":
    main()
