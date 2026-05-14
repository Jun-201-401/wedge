from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, checkpoint_primary_stage, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

VISIBLE_SUCCESS_EVIDENCE = {"cart_count_increased", "toast_present", "url_changed", "dom_changed"}
VISIBLE_RESULT_KEYS = ("toast_present", "url_changed", "dom_changed")
SETTLE_FAILURE_STATUSES = {"timeout", "failed"}


def evaluate_feedback_action_result(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    if _has_technical_failure(context):
        return None

    for record in observations_of_type(context, "goal_action_result"):
        data = _record_data(record)
        result = data.get("result") if isinstance(data.get("result"), dict) else {}
        if not _is_meaningful_action(data, result):
            continue
        if _has_visible_result_confirmation(context, record, data, result):
            continue

        settle_status = str(result.get("settle_status") or data.get("settle_status") or "").lower()
        network_only = _network_success_only(data, result)
        severity = _severity(context, settle_status, network_only)
        confidence = _confidence(record, network_only)

        return base_hit(
            rule=rule,
            context=context,
            severity=severity,
            confidence=confidence,
            evidence_refs=[record.ref],
            observations=[_observation_text(data, settle_status, network_only)],
            signals=_signals(data, result, settle_status, network_only),
            summary="사용자 행동 이후 결과가 화면에서 명확히 확인되지 않습니다.",
            impact_hypothesis=(
                "사용자는 행동이 성공했는지, 실패했는지, 아직 처리 중인지 알기 어려워 "
                "반복 클릭하거나 흐름을 중단할 수 있습니다."
            ),
            recommendations=[
                "행동 이후 성공 또는 실패 메시지, 변경된 개수, 화면 상태 변화, 명확한 다음 단계 안내처럼 "
                "사용자가 볼 수 있는 결과 상태를 표시하기"
            ],
            validation_questions=[
                "사용자는 행동을 실행한 뒤 무엇이 바뀌었고 성공했는지 바로 알 수 있는가?"
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


def _is_meaningful_action(data: dict[str, Any], result: dict[str, Any]) -> bool:
    if _bool_value(result.get("action_attempted")) is False:
        return False
    if _bool_value(data.get("goal_action_like")) is True:
        return True
    if _bool_value(result.get("add_to_cart_like_button")) is True:
        return True
    action_type = str(data.get("action_type") or "").lower()
    return action_type in {"submit", "click"}


def _has_visible_result_confirmation(
    context: StageContext,
    record: ObservationRecord,
    data: dict[str, Any],
    result: dict[str, Any],
) -> bool:
    success_evidence = {str(item) for item in data.get("success_evidence") or []}
    if success_evidence & VISIBLE_SUCCESS_EVIDENCE:
        return True

    if (number := _number(result.get("cart_count_delta"))) is not None and number > 0:
        return True
    if any(_bool_value(result.get(key)) is True for key in VISIBLE_RESULT_KEYS):
        return True

    return _has_settle_item_count_change(context, record.checkpoint_id)


def _has_settle_item_count_change(context: StageContext, checkpoint_id: str) -> bool:
    for checkpoint in context.checkpoints:
        if str(checkpoint.get("checkpoint_id") or "") != checkpoint_id:
            continue
        for observation in checkpoint.get("observations") or []:
            if not isinstance(observation, dict) or observation.get("type") != "settle_item_count_change":
                continue
            data = observation.get("data") if isinstance(observation.get("data"), dict) else observation
            count_delta = _number(data.get("count_delta"))
            if count_delta is not None and count_delta != 0:
                return True
    return False


def _network_success_only(data: dict[str, Any], result: dict[str, Any]) -> bool:
    success_evidence = {str(item) for item in data.get("success_evidence") or []}
    return _bool_value(result.get("network_success")) is True or success_evidence == {"network_success"}


def _severity(context: StageContext, settle_status: str, network_only: bool) -> int:
    if settle_status in SETTLE_FAILURE_STATUSES:
        return 3 if context.stage == "COMMIT" else 2
    if network_only:
        return 2 if context.stage == "COMMIT" else 1
    return 2 if context.stage != "COMMIT" else 3


def _confidence(record: ObservationRecord, network_only: bool) -> float:
    raw = record.observation.get("confidence")
    base = float(raw) if isinstance(raw, (int, float)) else 0.72
    if network_only:
        return min(base, 0.76)
    return min(max(base, 0.72), 0.88)


def _observation_text(data: dict[str, Any], settle_status: str, network_only: bool) -> str:
    label = data.get("clicked_text") or data.get("clicked_selector") or "해당 행동"
    if network_only:
        return f"{label} 실행 후 네트워크 성공 신호만 있고 화면에서 확인 가능한 결과 안내는 없습니다."
    if settle_status in SETTLE_FAILURE_STATUSES:
        return f"{label} 실행이 settle_status={settle_status} 상태로 끝났고 화면에서 확인 가능한 결과 안내는 없습니다."
    return f"{label} 실행 후 성공, 실패, 화면 변화 같은 결과 확인 신호가 보이지 않습니다."


def _signals(data: dict[str, Any], result: dict[str, Any], settle_status: str, network_only: bool) -> list[str]:
    success_evidence = [str(item) for item in data.get("success_evidence") or []]
    signals = [
        "goal_action_result=true",
        f"success_evidence={','.join(success_evidence) if success_evidence else 'none'}",
        f"settle_status={settle_status or 'unknown'}",
        f"toast_present={str(_bool_value(result.get('toast_present')) is True).lower()}",
        f"url_changed={str(_bool_value(result.get('url_changed')) is True).lower()}",
        f"dom_changed={str(_bool_value(result.get('dom_changed')) is True).lower()}",
        f"network_success_only={str(network_only).lower()}",
    ]
    cart_delta = _number(result.get("cart_count_delta"))
    if cart_delta is not None:
        signals.append(f"cart_count_delta={cart_delta:g}")
    return signals


def _record_data(record: ObservationRecord) -> dict[str, Any]:
    data = record.observation.get("data")
    return data if isinstance(data, dict) else record.observation


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
