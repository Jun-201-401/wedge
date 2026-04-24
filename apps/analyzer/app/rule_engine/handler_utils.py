from __future__ import annotations

from typing import Any

from app.contracts.stages import DecisionStage
from app.rule_engine.models import RuleHit
from app.rule_engine.scoring import priority_score
from app.stage.stage_context_builder import ObservationRecord, StageContext
from app.stage.stage_resolver import StageResolver

_STAGE_RESOLVER = StageResolver()


def base_hit(
    *,
    rule: dict[str, Any],
    context: StageContext,
    severity: int,
    confidence: float,
    evidence_refs: list[str],
    observations: list[str],
    signals: list[str],
    summary: str,
    impact_hypothesis: str,
    recommendations: list[str],
    validation_questions: list[str],
) -> RuleHit:
    fix_leverage = float(rule.get("fix_leverage_default", 1.0))
    return RuleHit(
        criterion_id=str(rule["criterion_id"]),
        stage=context.stage,
        axis=str(rule["axis"]),
        severity=severity,
        confidence=confidence,
        priority_score=priority_score(
            severity=severity,
            stage=context.stage,
            confidence=confidence,
            fix_leverage=fix_leverage,
        ),
        evidence_level=str(rule["evidence_level"]),
        evidence_refs=evidence_refs,
        observations=observations,
        signals=signals,
        summary=summary,
        impact_hypothesis=impact_hypothesis,
        recommendations=recommendations,
        validation_questions=validation_questions,
    )


def observations_of_type(context: StageContext, *types: str) -> list[ObservationRecord]:
    return [record for record in context.observations if record.observation.get("type") in types]


def checkpoint_primary_stage(checkpoint: dict[str, Any]) -> DecisionStage:
    return _STAGE_RESOLVER.resolve_checkpoint_stage(checkpoint)
