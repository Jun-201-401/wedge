from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.contracts.stages import is_decision_stage

DEFAULT_REGISTRY_PATH = Path(__file__).with_name("registries") / "p0_v0_1.json"

TOP_LEVEL_FIELDS = {"schema_version", "registry_id", "description", "rules"}
RULE_FIELDS = {
    "criterion_id",
    "axis",
    "applicableStages",
    "evidence_level",
    "definition",
    "required_observations",
    "measurement_sources",
    "signal_rule",
    "severity_rules",
    "exceptions",
    "confidence_rule",
    "fix_leverage_default",
    "output_template",
    "source_refs",
    "stages",
}
AXES = {"Clarity", "Path", "Friction", "Trust", "Reliability", "Visual Integrity"}
EVIDENCE_LEVELS = {"Standard", "Research-backed", "Expert Guide", "Operational", "Technical"}
MEASUREMENT_SOURCES = {
    "dom",
    "layout",
    "screenshot",
    "ax",
    "network",
    "console",
    "performance",
    "scenario_log",
}


class RuleRegistryError(ValueError):
    pass


def load_default_registry() -> dict[str, Any]:
    return load_registry(DEFAULT_REGISTRY_PATH)


def load_registry(path: str | Path) -> dict[str, Any]:
    registry_path = Path(path)
    with registry_path.open(encoding="utf-8") as file:
        registry = json.load(file)
    validate_registry(registry)
    return registry


def validate_registry(registry: dict[str, Any]) -> None:
    unknown_top_fields = set(registry) - TOP_LEVEL_FIELDS
    if unknown_top_fields:
        raise RuleRegistryError(f"RuleRegistry has unsupported fields: {sorted(unknown_top_fields)}")

    for field in ("schema_version", "registry_id", "rules"):
        if field not in registry:
            raise RuleRegistryError(f"RuleRegistry missing required field: {field}")
    if registry["schema_version"] != "0.5":
        raise RuleRegistryError("RuleRegistry.schema_version must be 0.5")
    if not isinstance(registry["registry_id"], str) or not registry["registry_id"]:
        raise RuleRegistryError("RuleRegistry.registry_id must be a non-empty string")
    if "description" in registry and not isinstance(registry["description"], str):
        raise RuleRegistryError("RuleRegistry.description must be a string")
    if not isinstance(registry["rules"], list):
        raise RuleRegistryError("RuleRegistry.rules must be a list")

    for index, rule in enumerate(registry["rules"]):
        _validate_rule(rule, index)


def _require_string(rule: dict[str, Any], field: str, criterion_id: str) -> str:
    value = rule.get(field)
    if not isinstance(value, str) or not value:
        raise RuleRegistryError(f"Rule {criterion_id} field {field} must be a non-empty string")
    return value


def _require_string_list(rule: dict[str, Any], field: str, criterion_id: str) -> list[str]:
    value = rule.get(field)
    if not isinstance(value, list) or not value or not all(isinstance(item, str) and item for item in value):
        raise RuleRegistryError(f"Rule {criterion_id} field {field} must be a non-empty string list")
    return value


def _validate_rule(rule: Any, index: int) -> None:
    if not isinstance(rule, dict):
        raise RuleRegistryError(f"Rule at index {index} must be an object")

    unknown_rule_fields = set(rule) - RULE_FIELDS
    if unknown_rule_fields:
        raise RuleRegistryError(
            f"Rule {rule.get('criterion_id', f'index {index}')} has unsupported fields: {sorted(unknown_rule_fields)}"
        )

    for field in (
        "criterion_id",
        "axis",
        "applicableStages",
        "evidence_level",
        "definition",
        "required_observations",
        "measurement_sources",
        "signal_rule",
        "severity_rules",
        "confidence_rule",
        "output_template",
    ):
        if field not in rule:
            criterion = rule.get("criterion_id", f"index {index}")
            raise RuleRegistryError(f"Rule {criterion} missing required field: {field}")

    criterion_id = _require_string(rule, "criterion_id", f"index {index}")
    for field in ("definition", "signal_rule", "confidence_rule", "output_template"):
        _require_string(rule, field, criterion_id)
    _require_string_list(rule, "required_observations", criterion_id)
    if "source_refs" in rule:
        _require_string_list(rule, "source_refs", criterion_id)
    if "exceptions" in rule:
        _require_string_list(rule, "exceptions", criterion_id)
    if "fix_leverage_default" in rule:
        value = rule["fix_leverage_default"]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0 or value > 2:
            raise RuleRegistryError(f"Rule {criterion_id} fix_leverage_default must be a number between 0 and 2")
    if "stages" in rule:
        legacy_stages = rule["stages"]
        if not isinstance(legacy_stages, list) or not legacy_stages:
            raise RuleRegistryError(f"Rule {criterion_id} legacy stages must be a non-empty stage list")
        invalid_legacy = [stage for stage in legacy_stages if not is_decision_stage(stage)]
        if invalid_legacy:
            raise RuleRegistryError(f"Rule {criterion_id} has invalid legacy stages: {invalid_legacy}")

    if rule["axis"] not in AXES:
        raise RuleRegistryError(f"Rule {criterion_id} has invalid axis: {rule['axis']}")
    if rule["evidence_level"] not in EVIDENCE_LEVELS:
        raise RuleRegistryError(f"Rule {criterion_id} has invalid evidence_level: {rule['evidence_level']}")

    stages = rule.get("applicableStages")
    if not isinstance(stages, list) or not stages:
        raise RuleRegistryError(f"Rule {criterion_id} must define non-empty applicableStages")
    invalid_stages = [stage for stage in stages if not is_decision_stage(stage)]
    if invalid_stages:
        raise RuleRegistryError(f"Rule {criterion_id} has invalid stages: {invalid_stages}")

    sources = rule.get("measurement_sources")
    if not isinstance(sources, list) or not sources:
        raise RuleRegistryError(f"Rule {criterion_id} must define non-empty measurement_sources")
    invalid_sources = [source for source in sources if source not in MEASUREMENT_SOURCES]
    if invalid_sources:
        raise RuleRegistryError(f"Rule {criterion_id} has invalid measurement_sources: {invalid_sources}")

    severity_rules = rule.get("severity_rules")
    if not isinstance(severity_rules, list) or not severity_rules:
        raise RuleRegistryError(f"Rule {criterion_id} must define non-empty severity_rules")
    for severity_rule in severity_rules:
        if not isinstance(severity_rule, dict):
            raise RuleRegistryError(f"Rule {criterion_id} has malformed severity_rule")
        if set(severity_rule) != {"severity", "condition"}:
            raise RuleRegistryError(f"Rule {criterion_id} severity_rule must contain severity and condition only")
        severity = severity_rule.get("severity")
        if type(severity) is not int or severity < 0 or severity > 3:
            raise RuleRegistryError(f"Rule {criterion_id} has invalid severity: {severity}")
        if not isinstance(severity_rule.get("condition"), str) or not severity_rule["condition"]:
            raise RuleRegistryError(f"Rule {criterion_id} severity_rule condition must be non-empty string")
