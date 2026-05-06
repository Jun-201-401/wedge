from __future__ import annotations

from typing import Any

from app.contracts.stages import DecisionStage
from app.rule_engine.observation_priority import (
    OBSERVATION_PRIORITY_POLICY_ID,
    legacy_component_priorities,
    stage_observation_priorities,
)
from app.stage.stage_context_builder import StageContext

COMPONENT_PRIORITY_POLICY_ID = "component_priority_policy_v0_1"


def stage_component_priorities(
    contexts: dict[DecisionStage, StageContext],
    issues: list[dict[str, Any]],
) -> dict[str, Any]:
    return legacy_component_priorities(stage_observation_priorities(contexts, issues))


__all__ = [
    "COMPONENT_PRIORITY_POLICY_ID",
    "OBSERVATION_PRIORITY_POLICY_ID",
    "stage_component_priorities",
    "stage_observation_priorities",
]
