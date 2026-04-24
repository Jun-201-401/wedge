from __future__ import annotations

from dataclasses import dataclass

from app.rule_engine.semantic_policy import (
    ACTION_SPECIFICITY_SCORES,
    RULE_SEMANTIC_CONFIDENCE_MIN,
    SCENARIO_RELEVANCE_SCORES,
)
from app.stage.stage_context_builder import StageContext


@dataclass(frozen=True)
class CtaSignal:
    observation_ref: str
    visible_text: str
    scenario_relevance_label: str = "UNKNOWN"
    action_specificity_label: str = "UNKNOWN"
    provider_confidence: float = 0.0

    @property
    def scenario_relevance_score(self) -> float | None:
        return SCENARIO_RELEVANCE_SCORES.get(self.scenario_relevance_label)

    @property
    def action_specificity_score(self) -> float | None:
        return ACTION_SPECIFICITY_SCORES.get(self.action_specificity_label)

    @property
    def semantic_confidence_ok(self) -> bool:
        return self.provider_confidence >= RULE_SEMANTIC_CONFIDENCE_MIN

    @property
    def is_goal_relevant_action(self) -> bool:
        return (
            self.semantic_confidence_ok
            and (self.scenario_relevance_score or 0.0) >= 0.60
            and self.action_specificity_label in {"SPECIFIC_ACTION", "GENERIC_BUT_ACTIONABLE"}
        )


def cta_signals(context: StageContext) -> list[CtaSignal]:
    signals: list[CtaSignal] = []
    for record in context.observations:
        if record.observation.get("type") != "cta_candidate":
            continue
        data = record.observation.get("data") or {}
        annotation = context.semantic_annotations.get(record.ref) or {}
        labels = annotation.get("labels") or {}
        signals.append(
            CtaSignal(
                observation_ref=record.ref,
                visible_text=_cta_text(data),
                scenario_relevance_label=str(labels.get("scenario_relevance_label") or "UNKNOWN"),
                action_specificity_label=str(labels.get("action_specificity_label") or "UNKNOWN"),
                provider_confidence=float(annotation.get("confidence") or 0.0),
            )
        )
    return signals


def _cta_text(data: dict[str, object]) -> str:
    for key in ("visible_text", "text", "accessible_name", "target"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""
