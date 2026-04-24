from __future__ import annotations

from dataclasses import replace
from typing import Any

from app.contracts.stages import DecisionStage
from app.providers import SemanticLabelResult, SemanticProviderPort, sanitize_semantic_label_result
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
                try:
                    raw_result = self._provider.classify_cta(
                        text=text,
                        scenario_goal=scenario_goal,
                        target_ref=record.ref,
                    )
                    result = sanitize_semantic_label_result(
                        raw_result,
                        target_ref=record.ref,
                        provider_name=type(self._provider).__name__,
                    )
                except Exception:  # Provider failures must not own deterministic judgment.
                    result = SemanticLabelResult(
                        target_observation_ref=record.ref,
                        provider_type="unavailable",
                        provider_name=type(self._provider).__name__,
                        labels={
                            "scenario_relevance_label": "UNKNOWN",
                            "action_specificity_label": "UNKNOWN",
                        },
                        confidence=0.0,
                        provider_error="provider_unavailable",
                    )
                annotations[record.ref] = result.as_observation_data()
            enriched[stage] = replace(context, semantic_annotations=annotations)
        return enriched


def _cta_text(observation: dict[str, Any]) -> str:
    data = observation.get("data") or {}
    for key in ("visible_text", "text", "accessible_name", "target"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""
