from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.rule_engine.signals import cta_signals
from app.stage.stage_context_builder import StageContext

LOW_RELEVANCE_LABELS = {"AUXILIARY_ACTION", "IRRELEVANT_ACTION"}


def evaluate_journey_goal_cta_mismatch(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    clicked_cta_refs = _clicked_cta_refs(context)
    for signal in cta_signals(context):
        if signal.observation_ref not in clicked_cta_refs:
            continue
        if not signal.semantic_confidence_ok:
            continue
        if signal.scenario_relevance_label not in LOW_RELEVANCE_LABELS:
            continue

        severity = 2 if signal.scenario_relevance_label == "IRRELEVANT_ACTION" else 1
        return base_hit(
            rule=rule,
            context=context,
            severity=severity,
            confidence=signal.provider_confidence,
            evidence_refs=[signal.observation_ref],
            observations=["선택된 행동이 사용자가 고른 점검 목표와 직접 연결되지 않는 신호가 관찰됨"],
            signals=[f"cta_text={signal.visible_text}", "scenario_relevance_low"],
            summary="선택된 버튼이 사용자가 의도한 목표와 직접 연결되지 않아 다음 행동 흐름이 약해질 수 있습니다.",
            impact_hypothesis="사용자가 버튼을 눌러도 원하는 목표로 이어지지 않으면 흐름을 다시 찾거나 중단할 수 있습니다.",
            recommendations=["가장 중요한 버튼의 문구와 이동 대상을 사용자가 선택한 목표에 맞게 정리하기"],
            validation_questions=["사용자는 이 버튼을 눌렀을 때 목표한 행동으로 이동한다고 바로 이해할 수 있는가?"],
        )
    return None


def _clicked_cta_refs(context: StageContext) -> set[str]:
    click_checkpoints = _click_checkpoint_ids(context)
    return {
        record.ref
        for record in observations_of_type(context, "cta_candidate")
        if record.checkpoint_id in click_checkpoints
    }


def _click_checkpoint_ids(context: StageContext) -> set[str]:
    ids: set[str] = set()
    for checkpoint in context.checkpoints:
        trigger = checkpoint.get("trigger") if isinstance(checkpoint, dict) else {}
        if not isinstance(trigger, dict):
            continue
        action = trigger.get("type") or trigger.get("actionType")
        if action == "click":
            checkpoint_id = str(checkpoint.get("checkpoint_id") or "")
            if checkpoint_id:
                ids.add(checkpoint_id)
    return ids
