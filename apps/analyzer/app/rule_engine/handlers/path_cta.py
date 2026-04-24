from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.rule_engine.signals import cta_signals
from app.stage.stage_context_builder import StageContext


def primary_cta_count(context: StageContext) -> tuple[int | None, float, list[str]]:
    cluster_records = observations_of_type(context, "cta_cluster")
    best_count: int | None = None
    confidence = 0.75
    refs: list[str] = []

    for record in cluster_records:
        data = record.observation.get("data") or {}
        count = data.get("primary_like_cta_count")
        if isinstance(count, int) and (best_count is None or count > best_count):
            best_count = count
            confidence = float(record.observation.get("confidence", confidence))
            refs = [record.ref]

    if best_count is not None:
        return best_count, confidence, refs

    semantic_goal_ctas = [signal for signal in cta_signals(context) if signal.is_goal_relevant_action]
    if semantic_goal_ctas:
        best_signal = max(semantic_goal_ctas, key=lambda signal: signal.provider_confidence)
        return 1, best_signal.provider_confidence, [best_signal.observation_ref]

    # FIRST_VIEW contexts can contain CTA observations whose own stage is CTA.
    # Scan raw checkpoint observations as a fallback so PATH-CTA-001 does not
    # report a missing first-view CTA when the CTA candidate was correctly
    # assigned to the CTA StageContext from the same checkpoint.
    for checkpoint in context.checkpoints:
        checkpoint_id = str(checkpoint.get("checkpoint_id") or "unknown_checkpoint")
        for observation in checkpoint.get("observations", []):
            if not isinstance(observation, dict) or observation.get("type") != "cta_cluster":
                continue
            data = observation.get("data") or {}
            count = data.get("primary_like_cta_count")
            if isinstance(count, int) and (best_count is None or count > best_count):
                best_count = count
                confidence = float(observation.get("confidence", confidence))
                observation_id = observation.get("observation_id") or "unknown"
                refs = [f"{checkpoint_id}.{observation_id}"]
    if best_count is not None:
        return best_count, confidence, refs

    aggregate = context.aggregate_signals.get("primary_cta_count_by_stage")
    if isinstance(aggregate, dict):
        count = aggregate.get(context.stage)
        if isinstance(count, int):
            return count, 0.72, [f"aggregate.primary_cta_count_by_stage.{context.stage}"]

    return None, confidence, refs


def evaluate_path_cta_presence(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    if context.scenario_fit and context.scenario_fit.get("scenario_fit_status") == "NOT_APPLICABLE":
        return None
    if not context.observed:
        return None

    primary_count, count_confidence, count_refs = primary_cta_count(context)
    if primary_count and primary_count > 0:
        return None

    if context.stage == "FIRST_VIEW" and not observations_of_type(context, "cta_cluster"):
        return None
    if primary_count == 0:
        if not count_refs or all(ref.startswith("aggregate.") for ref in count_refs):
            return None
        severity = 2 if context.stage == "CTA" else 1
        return base_hit(
            rule=rule,
            context=context,
            severity=severity,
            confidence=count_confidence,
            evidence_refs=count_refs,
            observations=["CTA cluster evidence에서 primary-like CTA가 0개로 확인됨"],
            signals=["primary_like_cta_count=0"],
            summary="핵심 행동을 시작할 primary CTA가 충분히 드러나지 않아 다음 행동 선택이 어려울 수 있습니다.",
            impact_hypothesis="사용자는 다음에 눌러야 할 핵심 행동을 바로 식별하지 못해 전환 시작이 지연될 수 있습니다.",
            recommendations=["핵심 CTA를 decision area 안에 하나의 primary 스타일로 노출하기"],
            validation_questions=["사용자는 첫 화면 또는 CTA 영역에서 3초 안에 핵심 CTA를 식별하는가?"],
        )

    # Missing or weak CTA-specific evidence is NOT_EVALUABLE internally in
    # this first slice. Do not create a user-facing PATH-CTA-001 issue from
    # a lone candidate without the required cluster/layout/readiness signal.
    return None


def evaluate_path_cta_competition(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    count, confidence, refs = primary_cta_count(context)
    if count is None or count < 3 or not refs:
        return None
    return base_hit(
        rule=rule,
        context=context,
        severity=2,
        confidence=confidence,
        evidence_refs=refs,
        observations=[f"같은 decision stage에서 primary급 CTA {count}개가 동시에 노출됨"],
        signals=["primary_like_cta_count>=3", "행동 경로 분산"],
        summary="같은 결정 순간에서 여러 primary급 CTA가 경쟁해 사용자가 첫 행동을 고르기 어려울 수 있습니다.",
        impact_hypothesis="무료 시작 또는 문의 같은 핵심 전환 행동의 시작률이 낮아질 수 있습니다.",
        recommendations=[
            "핵심 CTA를 1개로 정하고 보조 CTA는 secondary 스타일로 낮추기",
            "CTA 주변 카피에서 각 행동의 차이를 명확히 설명하기",
        ],
        validation_questions=["사용자는 첫 화면에서 어떤 버튼을 눌러야 하는지 바로 이해했는가?"],
    )
