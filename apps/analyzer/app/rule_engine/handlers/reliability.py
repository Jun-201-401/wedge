from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, checkpoint_primary_stage, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

PAGE_READY_WARNING_MS = 5_000
PAGE_READY_CRITICAL_MS = 8_000
GENERAL_NAVIGATION_ACTION_KINDS = {"navigation", "route_change", "link_click", "menu_click", "tab_change"}
HEAVY_TARGET_SIGNAL_KEYS = {
    "has_auth_redirect",
    "has_map",
    "has_payment_form",
    "has_permission_prompt",
    "has_streaming_response",
    "has_webgl",
}
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
        observations=[f"사용자 행동 직후 요청 실패 {failed_count}건, 화면 스크립트 오류 {console_count}건이 관찰됨"],
        signals=["failed_request_count>0" if failed_count else "console_error_count>0"],
        summary="사용자 행동 직후 기술 오류가 관찰되어 진행 신뢰성이 낮아질 수 있습니다.",
        impact_hypothesis="오류가 행동 결과 피드백을 방해해 사용자가 흐름을 재시도하거나 중단할 수 있습니다.",
        recommendations=["행동 직후 발생한 기술 오류를 우선 재현하고, 실패 상황에서도 사용자가 볼 수 있는 안내와 재시도 방법을 제공하기"],
        validation_questions=["오류 상황에서도 사용자는 다음 행동 또는 재시도 방법을 이해하는가?"],
    )


def evaluate_loading_stuck(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    if _has_technical_failure(context):
        return None

    records = _page_ready_delay_records(context)
    if not records:
        return None

    max_duration = max((_duration_ms(context, record) or 0) for record in records)
    severity = 3 if context.stage == "COMMIT" or max_duration >= PAGE_READY_CRITICAL_MS else 2
    confidence = max(_observation_confidence(record) for record in records)
    if not any(record.observation.get("type") == "page_ready_timing" for record in records):
        confidence = min(confidence, 0.7)

    return base_hit(
        rule=rule,
        context=context,
        severity=severity,
        confidence=confidence,
        evidence_refs=[record.ref for record in records],
        observations=["일반적인 페이지 전환이 기준 시간보다 오래 걸리는 신호가 관찰됨"],
        signals=_loading_signals(context, records),
        summary="다음 화면이나 결과 화면이 준비되는 시간이 길어 사용자가 진행 상태를 불안하게 느낄 수 있습니다.",
        impact_hypothesis="전환 후 의미 있는 내용이 늦게 보이면 사용자가 화면이 멈췄다고 판단하고 흐름을 이탈할 수 있습니다.",
        recommendations=["다음 화면이 준비되는 동안 핵심 콘텐츠를 더 빨리 보여주거나 진행 상태를 명확히 안내하기"],
        validation_questions=["일반적인 이동 행동 후 사용자는 다음 화면이 준비되고 있다는 점을 바로 이해할 수 있는가?"],
    )


def _page_ready_delay_records(context: StageContext) -> list[ObservationRecord]:
    records: list[ObservationRecord] = []
    for record in observations_of_type(context, "page_ready_timing", "loading_state", "settle_response"):
        duration = _duration_ms(context, record)
        if duration is None or duration < PAGE_READY_WARNING_MS:
            continue
        if not _is_general_navigation_record(context, record):
            continue
        if record.observation.get("type") == "loading_state" and _bool_value(_record_data(record).get("loading_visible")) is not True:
            continue
        records.append(record)
    return records


def _is_general_navigation_record(context: StageContext, record: ObservationRecord) -> bool:
    data = _record_data(record)
    checkpoint = _checkpoint_by_id(context).get(record.checkpoint_id) or {}
    trigger = checkpoint.get("trigger") if isinstance(checkpoint.get("trigger"), dict) else {}

    if _has_exception_context(data):
        return False

    trigger_type = str(data.get("trigger_type") or trigger.get("type") or "").lower()
    if trigger_type and trigger_type != "click":
        return False

    action_kind = str(data.get("action_kind") or "").lower()
    if action_kind not in GENERAL_NAVIGATION_ACTION_KINDS:
        return False

    if _bool_value(data.get("same_origin")) is False:
        return False
    if str(data.get("http_method") or "GET").upper() not in {"", "GET"}:
        return False
    if any(_bool_value(data.get(key)) is True for key in ("form_submit", "download_triggered", "external_redirect", "modal_opened", "target_blank")):
        return False

    changed = any(
        _bool_value(data.get(key)) is True
        for key in ("url_changed", "route_changed", "main_content_changed", "tab_panel_changed", "history_changed")
    )
    anchor_only = _bool_value(data.get("anchor_scroll")) is True and not any(
        _bool_value(data.get(key)) is True
        for key in ("url_changed", "route_changed", "main_content_changed", "tab_panel_changed")
    )
    return changed and not anchor_only


def _has_exception_context(data: dict[str, Any]) -> bool:
    target_signals = data.get("target_page_signals")
    if isinstance(target_signals, dict):
        if any(_bool_value(target_signals.get(key)) is True for key in HEAVY_TARGET_SIGNAL_KEYS):
            return True
    return any(_bool_value(data.get(key)) is True for key in HEAVY_TARGET_SIGNAL_KEYS)


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
    signals: list[str] = [f"page_ready_threshold_ms={PAGE_READY_WARNING_MS}", "general_navigation=true"]
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
