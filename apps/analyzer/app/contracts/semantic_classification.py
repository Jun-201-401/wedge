from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[4]
SEMANTIC_CLASSIFICATION_SCHEMA_PATH = REPO_ROOT / "packages/contracts/schemas/semantic-classification.schema.json"


@lru_cache(maxsize=1)
def semantic_classification_schema() -> dict[str, Any]:
    with SEMANTIC_CLASSIFICATION_SCHEMA_PATH.open(encoding="utf-8") as file:
        return json.load(file)


def semantic_schema_version() -> str:
    return str(semantic_classification_schema()["$defs"]["schema_version"]["const"])


def semantic_enum(def_name: str) -> set[str]:
    values = semantic_classification_schema()["$defs"][def_name]["enum"]
    return set(values)


def semantic_label_keys() -> set[str]:
    return set(semantic_classification_schema()["$defs"]["labels"]["properties"].keys())


def semantic_response_properties() -> set[str]:
    return set(semantic_classification_schema()["$defs"]["response"]["properties"].keys())


def semantic_task_types() -> set[str]:
    return semantic_enum("task_type")


def semantic_task_type() -> str:
    task_types = semantic_task_types()
    if len(task_types) != 1:
        raise ValueError("Semantic classification schema must expose exactly one task_type for this analyzer slice")
    return next(iter(task_types))
