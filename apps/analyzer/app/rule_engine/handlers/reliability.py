from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

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
URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+")
TRACKING_HOST_EXACT = {
    "bc.ad.daum.net",
    "act.ds.kakao.com",
    "cm.g.doubleclick.net",
    "cdn.megadata.co.kr",
}
TRACKING_HOST_SUFFIXES = (
    ".doubleclick.net",
    ".googlesyndication.com",
    ".google-analytics.com",
    ".googletagmanager.com",
    ".facebook.com",
)
TRACKING_PATH_HINTS = (
    "/adfit/",
    "/pixel",
    "/collect",
    "/pagead/",
)


def evaluate_reliability(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    refs: list[str] = []
    failed_count = 0
    console_count = 0

    for record in observations_of_type(context, "network_failure", "console_error"):
        if _is_ignored_technical_observation(record.observation):
            continue
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
        checkpoint_failed = _actionable_network_failure_count(network, checkpoint)
        checkpoint_console = int(console.get("error_count") or 0)
        if checkpoint_failed:
            failed_count += checkpoint_failed
            refs.append(f"{checkpoint_id}.state.network_summary")
        if checkpoint_console and not _checkpoint_has_only_ignored_technical_observations(checkpoint):
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
    if any(
        not _is_ignored_technical_observation(record.observation)
        for record in observations_of_type(context, "network_failure", "console_error")
    ):
        return True
    for checkpoint in context.checkpoints:
        if checkpoint_primary_stage(checkpoint) != context.stage:
            continue
        state = checkpoint.get("state") or {}
        network = state.get("network_summary") or {}
        console = state.get("console_summary") or {}
        if _actionable_network_failure_count(network, checkpoint) > 0:
            return True
        if int(console.get("error_count") or 0) > 0 and not _checkpoint_has_only_ignored_technical_observations(checkpoint):
            return True
    return False


def _actionable_network_failure_count(network: dict[str, Any], checkpoint: dict[str, Any]) -> int:
    failed_count = int(network.get("failed_request_count") or 0)
    if failed_count <= 0:
        return 0

    urls = _extract_urls(network)
    if urls:
        actionable_urls = [url for url in urls if not _is_tracking_url(url)]
        return min(failed_count, len(actionable_urls)) if actionable_urls else 0

    if _checkpoint_has_only_ignored_technical_observations(checkpoint):
        return 0
    return failed_count


def _checkpoint_has_only_ignored_technical_observations(checkpoint: dict[str, Any]) -> bool:
    observations = checkpoint.get("observations")
    if not isinstance(observations, list):
        return False
    technical = [
        observation
        for observation in observations
        if isinstance(observation, dict) and observation.get("type") in {"network_failure", "console_error"}
    ]
    return bool(technical) and all(_is_ignored_technical_observation(observation) for observation in technical)


def _is_ignored_technical_observation(observation: dict[str, Any]) -> bool:
    urls = _extract_urls(observation)
    if urls and all(_is_tracking_url(url) for url in urls):
        return True
    return _is_generic_resource_console_error(observation)


def _is_generic_resource_console_error(observation: dict[str, Any]) -> bool:
    if observation.get("type") != "console_error":
        return False
    if _extract_urls(observation):
        return False
    message = str(_record_data_from_observation(observation).get("message") or observation.get("message") or "")
    return message.startswith("Failed to load resource:")


def _is_tracking_url(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    path = parsed.path or ""
    if host in TRACKING_HOST_EXACT:
        return True
    if any(host.endswith(suffix) for suffix in TRACKING_HOST_SUFFIXES):
        return True
    return any(hint in path for hint in TRACKING_PATH_HINTS) and any(
        marker in host for marker in ("daumcdn.net", "kakao.com", "google", "facebook", "megadata")
    )


def _extract_urls(value: Any) -> list[str]:
    urls: list[str] = []
    if isinstance(value, str):
        urls.extend(match.rstrip("),.;") for match in URL_PATTERN.findall(value))
    elif isinstance(value, dict):
        for nested in value.values():
            urls.extend(_extract_urls(nested))
    elif isinstance(value, list):
        for nested in value:
            urls.extend(_extract_urls(nested))
    return list(dict.fromkeys(urls))


def _record_data_from_observation(observation: dict[str, Any]) -> dict[str, Any]:
    data = observation.get("data")
    return data if isinstance(data, dict) else observation


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
