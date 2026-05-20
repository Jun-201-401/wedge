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
    fix_leverage: float | None = None,
) -> RuleHit:
    hit_fix_leverage = float(fix_leverage if fix_leverage is not None else rule.get("fix_leverage_default", 1.0))
    references = rule.get("references", [])
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
            fix_leverage=hit_fix_leverage,
        ),
        evidence_level=str(rule["evidence_level"]),
        evidence_refs=evidence_refs,
        references=[dict(reference) for reference in references],
        observations=observations,
        signals=signals,
        fix_leverage=hit_fix_leverage,
        summary=summary,
        impact_hypothesis=impact_hypothesis,
        recommendations=recommendations,
        validation_questions=validation_questions,
    )


def observations_of_type(context: StageContext, *types: str) -> list[ObservationRecord]:
    if not types:
        return []

    requested_types = set(types)
    if context.observation_type_index:
        if len(requested_types) == 1:
            observation_type = next(iter(requested_types))
            return [record for _, record in context.observation_type_index.get(observation_type, ())]

        indexed_records = [
            indexed_record
            for observation_type in requested_types
            for indexed_record in context.observation_type_index.get(observation_type, ())
        ]
        return [record for _, record in sorted(indexed_records, key=lambda item: item[0])]

    return [record for record in context.observations if record.observation.get("type") in requested_types]


def checkpoint_primary_stage(checkpoint: dict[str, Any]) -> DecisionStage:
    return _STAGE_RESOLVER.resolve_checkpoint_stage(checkpoint)
