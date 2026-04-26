from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[4]
RULE_REGISTRY_SCHEMA_PATH = REPO_ROOT / "packages/contracts/schemas/rule-registry.schema.json"


@lru_cache(maxsize=1)
def rule_registry_schema() -> dict[str, Any]:
    with RULE_REGISTRY_SCHEMA_PATH.open(encoding="utf-8") as file:
        return json.load(file)


def schema_properties(path: tuple[str, ...]) -> set[str]:
    node: dict[str, Any] = rule_registry_schema()
    for item in path:
        node = node[item]
    return set((node.get("properties") or {}).keys())


def schema_required(path: tuple[str, ...]) -> tuple[str, ...]:
    node: dict[str, Any] = rule_registry_schema()
    for item in path:
        node = node[item]
    return tuple(node.get("required") or ())


def schema_enum(def_name: str) -> set[str]:
    values = rule_registry_schema()["$defs"][def_name]["enum"]
    return set(values)
