from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, checkpoint_primary_stage, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

STATUS_FEEDBACK_THRESHOLD_MS = 3_000
STATUS_FEEDBACK_STRONG_MS = 5_000
STATUS_FEEDBACK_CRITICAL_MS = 8_000
WAITING_STATUSES = {"pending", "in_progress", "processing", "timeout"}
PROCESSING_ACTION_KINDS = {
    "submit",
    "form_submit",
    "checkout",
    "checkout_submit",
    "payment",
    "payment_submit",
    "booking",
    "save",
}


def evaluate_feedback_system_status(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    if _has_technical_failure(context):
        return None

    for record in observations_of_type(context, "loading_state", "settle_response"):
        data = _status_data(record)
        duration = _duration_ms(context, record)
        settle_status = str(data.get("settle_status") or "").lower()
        if not _is_waiting_context(duration, settle_status):
            continue
        if _has_status_feedback(context, record, data):
            continue

        severity = _severity(context, data, duration, settle_status)
        confidence = _confidence(record)
        return base_hit(
            rule=rule,
            context=context,
            severity=severity,
            confidence=confidence,
            evidence_refs=[record.ref],
            observations=[_observation_text(duration, settle_status)],
            signals=_signals(data, duration, settle_status),
            summary="사용자가 기다리는 동안 처리 중 상태가 화면에 명확히 보이지 않습니다.",
            impact_hypothesis=(
                "사용자는 행동이 동작하지 않았거나 화면이 멈췄다고 생각해 "
                "반복 제출하거나 흐름을 중단할 수 있습니다."
            ),
            recommendations=[
                "행동 이후 스피너, 진행 표시, 상태 메시지, aria-busy 영역처럼 "
                "사용자가 볼 수 있는 처리 중 상태를 표시하기"
            ],
            validation_questions=[
                "행동 처리에 3초 이상 걸릴 때 사용자는 아직 처리 중이라는 점을 바로 알 수 있는가?"
            ],
        )

    return None


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


def _is_waiting_context(duration: int | None, settle_status: str) -> bool:
    if duration is not None and duration >= STATUS_FEEDBACK_THRESHOLD_MS:
        return True
    return duration is None and settle_status in WAITING_STATUSES


def _has_status_feedback(context: StageContext, record: ObservationRecord, data: dict[str, Any]) -> bool:
    if _has_status_feedback_in_data(data):
        return True
    if record.observation.get("type") == "settle_response":
        return _checkpoint_has_loading_feedback(context, record.checkpoint_id)
    return False


def _checkpoint_has_loading_feedback(context: StageContext, checkpoint_id: str) -> bool:
    for checkpoint in context.checkpoints:
        if str(checkpoint.get("checkpoint_id") or "") != checkpoint_id:
            continue
        for observation in checkpoint.get("observations") or []:
            if not isinstance(observation, dict) or observation.get("type") != "loading_state":
                continue
            if _has_status_feedback_in_data(_status_data_from_observation(observation)):
                return True
    return False


def _has_status_feedback_in_data(data: dict[str, Any]) -> bool:
    if _bool_value(data.get("has_spinner")) is True:
        return True
    if _bool_value(data.get("has_progressbar")) is True:
        return True
    if _bool_value(data.get("aria_busy")) is True:
        return True
    if _has_text(data.get("status_text")):
        return True

    loading_visible = _bool_value(data.get("loading_visible")) is True
    has_visible_label = _has_text(data.get("text")) or _has_text(data.get("label")) or _has_text(data.get("loading_role"))
    return loading_visible and has_visible_label


def _severity(context: StageContext, data: dict[str, Any], duration: int | None, settle_status: str) -> int:
    action_kind = str(data.get("action_kind") or "").lower()
    important_action = action_kind in PROCESSING_ACTION_KINDS or _has_important_outcome_hint(data)

    if context.stage == "COMMIT" and (settle_status == "timeout" or (duration is not None and duration >= STATUS_FEEDBACK_CRITICAL_MS)):
        return 3
    if duration is not None and duration >= STATUS_FEEDBACK_STRONG_MS:
        return 2
    if context.stage == "COMMIT" or important_action:
        return 2
    return 1


def _has_important_outcome_hint(data: dict[str, Any]) -> bool:
    hints = data.get("expected_outcome_hint")
    if not isinstance(hints, list):
        return False
    return any(str(hint) in {"form_submit", "checkout_processing"} for hint in hints)


def _confidence(record: ObservationRecord) -> float:
    value = record.observation.get("confidence")
    base = float(value) if isinstance(value, (int, float)) else 0.72
    if record.observation.get("type") == "settle_response":
        return min(max(base, 0.68), 0.78)
    return min(max(base, 0.7), 0.86)


def _duration_ms(context: StageContext, record: ObservationRecord) -> int | None:
    data = _status_data(record)
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


def _observation_text(duration: int | None, settle_status: str) -> str:
    duration_text = f"{duration}ms" if duration is not None else "알 수 없는 시간"
    if settle_status:
        return f"처리가 {duration_text} 동안 지속되고 settle_status={settle_status} 상태였지만 화면에서 상태 피드백은 확인되지 않았습니다."
    return f"처리가 {duration_text} 동안 지속되었지만 화면에서 상태 피드백은 확인되지 않았습니다."


def _signals(data: dict[str, Any], duration: int | None, settle_status: str) -> list[str]:
    signals = [
        f"status_feedback_threshold_ms={STATUS_FEEDBACK_THRESHOLD_MS}",
        "status_feedback=false",
        f"settle_status={settle_status or 'unknown'}",
        f"has_spinner={str(_bool_value(data.get('has_spinner')) is True).lower()}",
        f"has_progressbar={str(_bool_value(data.get('has_progressbar')) is True).lower()}",
        f"aria_busy={str(_bool_value(data.get('aria_busy')) is True).lower()}",
        f"status_text_present={str(_has_text(data.get('status_text'))).lower()}",
    ]
    if duration is not None:
        signals.append(f"duration_ms={duration}")
    action_kind = data.get("action_kind")
    if isinstance(action_kind, str) and action_kind:
        signals.append(f"action_kind={action_kind}")
    clicked_disabled = _bool_value(data.get("clicked_submit_disabled"))
    if clicked_disabled is not None:
        signals.append(f"clicked_submit_disabled={str(clicked_disabled).lower()}")
    return signals


def _checkpoint_by_id(context: StageContext) -> dict[str, dict[str, Any]]:
    return {
        str(checkpoint.get("checkpoint_id")): checkpoint
        for checkpoint in context.checkpoints
        if isinstance(checkpoint, dict) and checkpoint.get("checkpoint_id")
    }


def _status_data(record: ObservationRecord) -> dict[str, Any]:
    return _status_data_from_observation(record.observation)


def _status_data_from_observation(observation: dict[str, Any]) -> dict[str, Any]:
    base = observation.get("data") if isinstance(observation.get("data"), dict) else observation
    result = dict(base)
    nested = result.get("loading_state")
    if isinstance(nested, dict):
        result.update(nested)
    return result


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


def _has_text(value: Any) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(isinstance(item, str) and item.strip() for item in value)
    return False
