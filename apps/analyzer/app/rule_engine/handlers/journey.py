from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.rule_engine.signals import cta_signals
from app.stage.stage_context_builder import ObservationRecord, StageContext

FAILED_SETTLE_STATUSES = {"timeout", "failed", "error", "blocked"}
LOW_RELEVANCE_LABELS = {"AUXILIARY_ACTION", "IRRELEVANT_ACTION"}


def evaluate_journey_action_result(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    failed_records = _failed_action_result_records(context)
    if not failed_records:
        return None

    confidence = max(_observation_confidence(record) for record in failed_records)
    severity = _action_result_severity(context, failed_records)
    refs = [record.ref for record in failed_records]
    signals = [_settle_signal(record) for record in failed_records]

    return base_hit(
        rule=rule,
        context=context,
        severity=severity,
        confidence=confidence,
        evidence_refs=refs,
        observations=["A clicked goal action did not produce the expected settled result."],
        signals=signals,
        summary="The goal action was attempted, but the expected result was not confirmed.",
        impact_hypothesis="Users may feel that the action did nothing or failed silently.",
        recommendations=["Provide a clear success, error, loading, or retry state after the action."],
        validation_questions=["After clicking the target action, can users clearly tell what changed?"],
    )


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
            observations=[f"CTA semantic label is {signal.scenario_relevance_label}."],
            signals=[f"cta_text={signal.visible_text}", "scenario_relevance_low"],
            summary="The selected CTA appears weakly related to the scenario goal.",
            impact_hypothesis="Users may follow an action path that does not advance the intended goal.",
            recommendations=["Align the primary CTA copy and destination with the scenario goal."],
            validation_questions=["Does this CTA directly move users toward the selected goal?"],
        )
    return None


def _clicked_cta_refs(context: StageContext) -> set[str]:
    click_checkpoints = _click_checkpoint_ids(context)
    return {
        record.ref
        for record in observations_of_type(context, "cta_candidate")
        if record.checkpoint_id in click_checkpoints
    }


def _failed_action_result_records(context: StageContext) -> list[ObservationRecord]:
    click_checkpoints = _click_checkpoint_ids(context)
    return [
        record
        for record in observations_of_type(context, "settle_response", "settle_item_count_change")
        if record.checkpoint_id in click_checkpoints and _is_failed_settle(record)
    ]


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


def _is_failed_settle(record: ObservationRecord) -> bool:
    data = record.observation.get("data")
    if not isinstance(data, dict):
        data = record.observation
    status = str(data.get("settle_status") or "").lower()
    if status in FAILED_SETTLE_STATUSES:
        return True
    return _response_failed(data)


def _response_failed(data: dict[str, Any]) -> bool:
    status_code = data.get("status_code")
    return isinstance(status_code, int) and status_code >= 400


def _action_result_severity(context: StageContext, records: list[ObservationRecord]) -> int:
    if context.stage == "COMMIT":
        return 3
    return 3 if any(_settle_status(record) in {"failed", "error", "blocked"} for record in records) else 2


def _settle_signal(record: ObservationRecord) -> str:
    status = _settle_status(record) or "unknown"
    return f"{record.observation.get('type')}:{status}"


def _settle_status(record: ObservationRecord) -> str:
    data = record.observation.get("data")
    if not isinstance(data, dict):
        data = record.observation
    return str(data.get("settle_status") or "").lower()


def _observation_confidence(record: ObservationRecord) -> float:
    value = record.observation.get("confidence")
    return float(value) if isinstance(value, (int, float)) else 0.72
