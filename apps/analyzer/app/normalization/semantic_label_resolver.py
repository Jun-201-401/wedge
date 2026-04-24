from __future__ import annotations

from dataclasses import replace
from typing import Any

from app.contracts.stages import DecisionStage
from app.providers import SemanticProviderPort
from app.stage.stage_context_builder import StageContext


class SemanticLabelResolver:
    """Attach provider labels as side-channel annotations before rule evaluation.

    The annotations are intentionally not JudgeIssues and do not contain final
    severity/confidence/priority/stage decisions.
    """

    def __init__(self, provider: SemanticProviderPort) -> None:
        self._provider = provider

    def enrich(self, contexts: dict[DecisionStage, StageContext]) -> dict[DecisionStage, StageContext]:
        enriched: dict[DecisionStage, StageContext] = {}
        for stage, context in contexts.items():
            annotations = dict(context.semantic_annotations)
            scenario_goal = str(context.scenario.get("goal") or "")
            for record in context.observations:
                if record.observation.get("type") != "cta_candidate":
                    continue
                text = _cta_text(record.observation)
                annotations[record.ref] = self._provider.classify_cta(
                    text=text,
                    scenario_goal=scenario_goal,
                    target_ref=record.ref,
                ).as_observation_data()
            enriched[stage] = replace(context, semantic_annotations=annotations)
        return enriched


def _cta_text(observation: dict[str, Any]) -> str:
    data = observation.get("data") or {}
    for key in ("visible_text", "text", "accessible_name", "target"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""
