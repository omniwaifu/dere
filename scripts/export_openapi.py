from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from dere_daemon.main import app


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    schema = app.openapi()
    output_path = _repo_root() / "schemas" / "openapi" / "dere_daemon.openapi.json"
    _write_json(output_path, schema)
    print(f"Exported OpenAPI schema: {output_path.relative_to(_repo_root())}")


if __name__ == "__main__":
    main()
