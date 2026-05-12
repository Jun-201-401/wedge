from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, checkpoint_primary_stage, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

LOADING_WARNING_MS = 8_000
LOADING_CRITICAL_MS = 15_000
LOADING_STUCK_STATUSES = {"timeout", "stuck"}
LOADING_SUCCESS_STATUSES = {"settled", "success", "succeeded", "complete", "completed"}


def evaluate_reliability(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    refs: list[str] = []
    failed_count = 0
    console_count = 0

    for record in observations_of_type(context, "network_failure", "console_error"):
        if record.observation.get("type") == "network_failure":
            failed_count += 1
        if record.observation.get("type") == "console_error":
            console_count += 1
        refs.append(record.ref)

    for checkpoint in context.checkpoints:
        # Checkpoint-level state belongs to the checkpoint primary stage. A
        # checkpoint can appear in additional StageContexts because it contains
        # cross-stage observations; do not treat the same state summary as
        # evidence for those derived observation stages.
        if checkpoint_primary_stage(checkpoint) != context.stage:
            continue
        checkpoint_id = str(checkpoint.get("checkpoint_id") or "unknown_checkpoint")
        state = checkpoint.get("state") or {}
        network = state.get("network_summary") or {}
        console = state.get("console_summary") or {}
        checkpoint_failed = int(network.get("failed_request_count") or 0)
        checkpoint_console = int(console.get("error_count") or 0)
        if checkpoint_failed:
            failed_count += checkpoint_failed
            refs.append(f"{checkpoint_id}.state.network_summary")
        if checkpoint_console:
            console_count += checkpoint_console
            refs.append(f"{checkpoint_id}.state.console_summary")

    # Run-level aggregate reliability counters are not stage-attributed
    # evidence. They remain diagnostic until an upstream producer supplies
    # stage-specific observations or checkpoint state.

    refs = list(dict.fromkeys(refs))
    if failed_count == 0 and console_count == 0:
        return None
    return base_hit(
        rule=rule,
        context=context,
        severity=2,
        confidence=0.86 if any(not ref.startswith("aggregate.") for ref in refs) else 0.72,
        evidence_refs=refs,
        observations=[f"failed request {failed_count}건, console error {console_count}건이 관찰됨"],
        signals=["failed_request_count>0" if failed_count else "console_error_count>0"],
        summary="사용자 행동 직후 기술 오류가 관찰되어 진행 신뢰성이 낮아질 수 있습니다.",
        impact_hypothesis="오류가 행동 결과 피드백을 방해해 사용자가 흐름을 재시도하거나 중단할 수 있습니다.",
        recommendations=["행동 직후 실패 요청과 콘솔 오류를 우선 재현하고 사용자-facing fallback을 제공하기"],
        validation_questions=["오류 상황에서도 사용자는 다음 행동 또는 재시도 방법을 이해하는가?"],
    )


def evaluate_loading_stuck(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    if _has_technical_failure(context):
        return None

    records = _stuck_loading_records(context)
    if not records:
        records = _fallback_settle_records(context)
    if not records:
        return None

    records = [record for record in records if not _checkpoint_has_success_result(context, record.checkpoint_id)]
    if not records:
        return None

    max_duration = max((_duration_ms(context, record) or 0) for record in records)
    severity = 3 if context.stage == "COMMIT" or max_duration >= LOADING_CRITICAL_MS else 2
    confidence = max(_observation_confidence(record) for record in records)
    if not any(record.observation.get("type") == "loading_state" for record in records):
        confidence = min(confidence, 0.7)

    return base_hit(
        rule=rule,
        context=context,
        severity=severity,
        confidence=confidence,
        evidence_refs=[record.ref for record in records],
        observations=["A loading state stayed visible or the action settle result remained stuck without a confirmed result."],
        signals=_loading_signals(context, records),
        summary="The user action appears to remain in a loading or stuck state without a clear result.",
        impact_hypothesis="Users may not know whether the action is still processing, completed, or failed.",
        recommendations=["Resolve the stuck loading path and provide a clear success, failure, or retry state."],
        validation_questions=["After the action, does the interface leave the loading state and show a concrete result?"],
    )


def _stuck_loading_records(context: StageContext) -> list[ObservationRecord]:
    records: list[ObservationRecord] = []
    for record in observations_of_type(context, "loading_state"):
        data = _record_data(record)
        if _bool_value(data.get("loading_visible")) is not True:
            continue
        duration = _duration_ms(context, record)
        if duration is None or duration < LOADING_WARNING_MS:
            continue
        records.append(record)
    return records


def _fallback_settle_records(context: StageContext) -> list[ObservationRecord]:
    records: list[ObservationRecord] = []
    for record in observations_of_type(context, "settle_response"):
        data = _record_data(record)
        status = str(data.get("settle_status") or "").lower()
        duration = _duration_ms(context, record)
        if status in LOADING_STUCK_STATUSES and duration is not None and duration >= LOADING_WARNING_MS:
            records.append(record)
    return records


def _checkpoint_has_success_result(context: StageContext, checkpoint_id: str) -> bool:
    for record in observations_of_type(context, "settle_response", "settle_item_count_change"):
        if record.checkpoint_id != checkpoint_id:
            continue
        data = _record_data(record)
        status = str(data.get("settle_status") or "").lower()
        if status in LOADING_SUCCESS_STATUSES:
            return True
        current_count = _number(data.get("current_count"))
        expected_count = _number(data.get("expected_count"))
        if current_count is not None and expected_count is not None and current_count >= expected_count:
            return True
    return False


def _has_technical_failure(context: StageContext) -> bool:
    if observations_of_type(context, "network_failure", "console_error"):
        return True
    for checkpoint in context.checkpoints:
        if checkpoint_primary_stage(checkpoint) != context.stage:
            continue
        state = checkpoint.get("state") or {}
        network = state.get("network_summary") or {}
        console = state.get("console_summary") or {}
        if int(network.get("failed_request_count") or 0) > 0:
            return True
        if int(console.get("error_count") or 0) > 0:
            return True
    return False


def _duration_ms(context: StageContext, record: ObservationRecord) -> int | None:
    data = _record_data(record)
    for key in ("duration_ms", "visible_duration_ms", "elapsed_ms"):
        value = _number(data.get(key))
        if value is not None:
            return int(value)

    checkpoint = _checkpoint_by_id(context).get(record.checkpoint_id)
    if not checkpoint:
        return None
    settle = checkpoint.get("settle")
    if not isinstance(settle, dict):
        return None
    value = _number(settle.get("duration_ms"))
    return int(value) if value is not None else None


def _loading_signals(context: StageContext, records: list[ObservationRecord]) -> list[str]:
    signals: list[str] = [f"loading_threshold_ms={LOADING_WARNING_MS}"]
    for record in records:
        data = _record_data(record)
        observation_type = str(record.observation.get("type") or "unknown")
        duration = _duration_ms(context, record)
        status = str(data.get("settle_status") or "").lower()
        if duration is not None:
            signals.append(f"{observation_type}.duration_ms={duration}")
        if status:
            signals.append(f"{observation_type}.settle_status={status}")
        loading_visible = _bool_value(data.get("loading_visible"))
        if loading_visible is not None:
            signals.append(f"{observation_type}.loading_visible={str(loading_visible).lower()}")
    return list(dict.fromkeys(signals))


def _checkpoint_by_id(context: StageContext) -> dict[str, dict[str, Any]]:
    return {
        str(checkpoint.get("checkpoint_id")): checkpoint
        for checkpoint in context.checkpoints
        if isinstance(checkpoint, dict) and checkpoint.get("checkpoint_id")
    }


def _record_data(record: ObservationRecord) -> dict[str, Any]:
    data = record.observation.get("data")
    return data if isinstance(data, dict) else record.observation


def _observation_confidence(record: ObservationRecord) -> float:
    value = record.observation.get("confidence")
    return float(value) if isinstance(value, (int, float)) else 0.72


def _bool_value(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes"}:
            return True
        if lowered in {"false", "0", "no"}:
            return False
    return None


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None
