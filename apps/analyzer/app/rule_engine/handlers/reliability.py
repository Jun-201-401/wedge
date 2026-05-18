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
ACTION_KEYWORDS = (
    "login",
    "signin",
    "sign-in",
    "signup",
    "sign-up",
    "auth",
    "oauth",
    "token",
    "session",
    "cart",
    "checkout",
    "payment",
    "pay",
    "order",
    "submit",
    "save",
    "search",
    "filter",
    "address",
    "postcode",
    "verify",
    "verification",
    "kakao",
    "naver",
    "로그인",
    "회원가입",
    "인증",
    "결제",
    "주문",
    "장바구니",
    "담기",
    "저장",
    "제출",
    "검색",
    "주소",
)
CORE_URL_PATH_HINTS = (
    "/api/",
    "/auth",
    "/oauth",
    "/token",
    "/session",
    "/login",
    "/signin",
    "/signup",
    "/cart",
    "/checkout",
    "/payment",
    "/pay",
    "/order",
    "/submit",
    "/save",
    "/search",
    "/product",
    "/products",
    "/item",
    "/items",
    "/address",
    "/postcode",
    "/verify",
)
NON_USER_IMPACT_EXTENSIONS = (
    ".css.map",
    ".js.map",
    ".map",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
)
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif")
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
    evidence = _user_impacting_technical_evidence(context)
    refs = list(dict.fromkeys(str(item["ref"]) for item in evidence))
    failed_count = sum(1 for item in evidence if item.get("kind") == "network")
    console_count = sum(1 for item in evidence if item.get("kind") == "console")
    if failed_count == 0 and console_count == 0:
        return None
    return base_hit(
        rule=rule,
        context=context,
        severity=2,
        confidence=0.86 if any(not ref.startswith("aggregate.") for ref in refs) else 0.72,
        evidence_refs=refs,
        observations=[f"사용자 행동 직후 요청 실패 {failed_count}건, 화면 스크립트 오류 {console_count}건이 관찰됨"],
        signals=_reliability_signals(evidence, failed_count, console_count),
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
    return bool(_user_impacting_technical_evidence(context))


def _user_impacting_technical_evidence(context: StageContext) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    action_context_by_checkpoint = _action_context_by_checkpoint(context)

    for record in observations_of_type(context, "network_failure", "console_error", "network_timeline"):
        action_context = action_context_by_checkpoint.get(record.checkpoint_id, {})
        evidence.extend(_technical_evidence_from_record(record, action_context))

    for checkpoint in context.checkpoints:
        if checkpoint_primary_stage(checkpoint) != context.stage:
            continue
        checkpoint_id = str(checkpoint.get("checkpoint_id") or "unknown_checkpoint")
        action_context = action_context_by_checkpoint.get(checkpoint_id, {})
        state = checkpoint.get("state") or {}
        network = state.get("network_summary") or {}
        console = state.get("console_summary") or {}
        checkpoint_failed = _actionable_network_failure_count(network, checkpoint)
        if checkpoint_failed and _summary_failure_has_user_impact(action_context):
            evidence.append({"ref": f"{checkpoint_id}.state.network_summary", "kind": "network", "reason": "action_result_failure"})
        checkpoint_console = int(console.get("error_count") or 0)
        if (
            checkpoint_console
            and not _checkpoint_has_only_ignored_technical_observations(checkpoint)
            and _summary_failure_has_user_impact(action_context)
        ):
            evidence.append({"ref": f"{checkpoint_id}.state.console_summary", "kind": "console", "reason": "action_result_failure"})

    deduped: list[dict[str, Any]] = []
    seen_refs: set[str] = set()
    for item in evidence:
        ref = str(item.get("ref") or "")
        if not ref or ref in seen_refs:
            continue
        deduped.append(item)
        seen_refs.add(ref)
    return deduped


def _technical_evidence_from_record(record: ObservationRecord, action_context: dict[str, Any]) -> list[dict[str, Any]]:
    observation_type = record.observation.get("type")
    if observation_type in {"network_failure", "console_error"}:
        if _is_ignored_technical_observation(record.observation):
            return []
        kind = "network" if observation_type == "network_failure" else "console"
        if _technical_record_has_user_impact(record.observation, action_context):
            return [{"ref": record.ref, "kind": kind, "reason": _impact_reason(record.observation, action_context)}]
        return []

    if observation_type != "network_timeline":
        return []

    data = _record_data(record)
    events = data.get("events")
    if not isinstance(events, list):
        return []
    actionable_events = [
        event
        for event in events
        if isinstance(event, dict)
        and _is_failed_network_event(event)
        and not _is_ignored_network_event(event)
        and _network_event_has_user_impact(event, action_context)
    ]
    if not actionable_events:
        return []
    return [{"ref": record.ref, "kind": "network", "reason": _event_impact_reason(actionable_events[0], action_context)}]


def _technical_record_has_user_impact(observation: dict[str, Any], action_context: dict[str, Any]) -> bool:
    if observation.get("type") == "network_failure":
        data = _record_data_from_observation(observation)
        event = {
            "url": data.get("url") or observation.get("url") or _first_url(observation),
            "status": data.get("status") or observation.get("status"),
            "failed": True,
            "resourceType": data.get("resourceType") or data.get("resource_type") or observation.get("resourceType"),
        }
        return _network_event_has_user_impact(event, action_context)

    if observation.get("type") == "console_error":
        return _console_error_has_user_impact(observation, action_context)

    return False


def _network_event_has_user_impact(event: dict[str, Any], action_context: dict[str, Any]) -> bool:
    if _is_core_resource_failure(event):
        return True
    if not _has_action_attempt(action_context):
        return False
    if _summary_failure_has_user_impact(action_context):
        return True
    if _is_core_action_failure_url(event.get("url")):
        return True
    if _action_context_is_critical(action_context) and _is_interactive_request(event):
        return True
    return False


def _console_error_has_user_impact(observation: dict[str, Any], action_context: dict[str, Any]) -> bool:
    if not _has_action_attempt(action_context):
        return False
    message = _technical_message(observation).lower()
    if _summary_failure_has_user_impact(action_context) and _message_mentions_action_context(message, action_context):
        return True
    if _action_context_is_critical(action_context) and _message_mentions_core_failure(message):
        return True
    return False


def _action_context_by_checkpoint(context: StageContext) -> dict[str, dict[str, Any]]:
    contexts: dict[str, dict[str, Any]] = {}
    for checkpoint in context.checkpoints:
        checkpoint_id = str(checkpoint.get("checkpoint_id") or "")
        if not checkpoint_id:
            continue
        action_context: dict[str, Any] = {
            "has_action_attempt": False,
            "clicked_in_scenario": False,
            "critical_action": False,
            "result_missing": False,
            "settle_failed": False,
            "keywords": set(),
        }
        for observation in checkpoint.get("observations") or []:
            if isinstance(observation, dict):
                _merge_action_context(action_context, observation)
        contexts[checkpoint_id] = action_context
    return contexts


def _merge_action_context(action_context: dict[str, Any], observation: dict[str, Any]) -> None:
    observation_type = observation.get("type")
    data = _record_data_from_observation(observation)

    if observation_type == "interactive_components":
        for component in _components_from_data(data):
            if component.get("clicked_in_scenario") is True:
                action_context["has_action_attempt"] = True
                action_context["clicked_in_scenario"] = True
                _add_keywords(action_context, component.get("text"), component.get("selector"), component.get("role"))
                if _contains_action_keyword(
                    " ".join(str(value) for value in (component.get("text"), component.get("selector")) if value)
                ):
                    action_context["critical_action"] = True
        return

    if observation_type == "journey_action_raw":
        action_type = str(data.get("action_type") or "").lower()
        if action_type != "checkpoint":
            action_context["has_action_attempt"] = True
        _add_keywords(
            action_context,
            data.get("action_kind"),
            data.get("clicked_text"),
            data.get("clicked_selector"),
            data.get("element_role"),
            data.get("element_text"),
            data.get("expected_outcome_hint"),
            data.get("url_after"),
        )
        if _journey_action_is_critical(data):
            action_context["critical_action"] = True
        if _journey_result_missing(data):
            action_context["result_missing"] = True
        if str(data.get("settle_status") or "").lower() in {"failed", "timeout"}:
            action_context["settle_failed"] = True
        return

    if observation_type == "goal_action_result":
        action_context["has_action_attempt"] = True
        _add_keywords(action_context, data.get("clicked_text"), data.get("clicked_selector"), data.get("action_type"))
        result = data.get("result") if isinstance(data.get("result"), dict) else {}
        if data.get("goal_action_like") is True or _goal_result_is_critical(data):
            action_context["critical_action"] = True
        if _goal_result_missing(data):
            action_context["result_missing"] = True
        if str(result.get("settle_status") or "").lower() in {"failed", "timeout"}:
            action_context["settle_failed"] = True


def _components_from_data(data: dict[str, Any]) -> list[dict[str, Any]]:
    components = data.get("components")
    if not isinstance(components, list):
        return []
    return [component for component in components if isinstance(component, dict)]


def _has_action_attempt(action_context: dict[str, Any]) -> bool:
    return bool(action_context.get("has_action_attempt") or action_context.get("clicked_in_scenario"))


def _summary_failure_has_user_impact(action_context: dict[str, Any]) -> bool:
    return _has_action_attempt(action_context) and bool(
        action_context.get("result_missing")
        or action_context.get("settle_failed")
        or action_context.get("critical_action")
    )


def _action_context_is_critical(action_context: dict[str, Any]) -> bool:
    if action_context.get("critical_action") is True:
        return True
    keywords = action_context.get("keywords")
    return isinstance(keywords, set) and any(_contains_action_keyword(keyword) for keyword in keywords)


def _journey_action_is_critical(data: dict[str, Any]) -> bool:
    action_kind = str(data.get("action_kind") or "").lower()
    if action_kind in {"submit", "checkout_submit", "payment_submit"}:
        return True
    return _contains_action_keyword(
        " ".join(
            str(value)
            for value in (
                data.get("clicked_text"),
                data.get("clicked_selector"),
                data.get("element_text"),
                data.get("url_after"),
            )
            if value
        )
    )


def _journey_result_missing(data: dict[str, Any]) -> bool:
    if str(data.get("settle_status") or "").lower() in {"failed", "timeout"}:
        return True
    has_visible_result = _bool_value(data.get("dom_changed")) is True
    has_visible_result = has_visible_result or str(data.get("url_before") or "") != str(data.get("url_after") or "")
    toast_text = data.get("toast_text")
    if isinstance(toast_text, list) and toast_text:
        has_visible_result = True
    cart_before = data.get("cart_count_before")
    cart_after = data.get("cart_count_after")
    if isinstance(cart_before, int) and isinstance(cart_after, int) and cart_after != cart_before:
        has_visible_result = True
    expected = data.get("expected_outcome_hint")
    expects_change = isinstance(expected, list) and any(
        value in {"url_change", "modal_open", "toast_show", "form_submit", "item_count_change", "checkout_processing", "dom_change"}
        for value in expected
    )
    return expects_change and not has_visible_result


def _goal_result_is_critical(data: dict[str, Any]) -> bool:
    return _contains_action_keyword(
        " ".join(
            str(value)
            for value in (data.get("clicked_text"), data.get("clicked_selector"), data.get("action_type"))
            if value
        )
    )


def _goal_result_missing(data: dict[str, Any]) -> bool:
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    if str(result.get("settle_status") or "").lower() in {"failed", "timeout"}:
        return True
    success_evidence = data.get("success_evidence")
    if isinstance(success_evidence, list) and success_evidence:
        return False
    cart_delta = result.get("cart_count_delta") if isinstance(result.get("cart_count_delta"), (int, float)) else 0
    return data.get("goal_action_like") is True and not any(
        _bool_value(result.get(key)) is True
        for key in ("toast_present", "url_changed", "dom_changed", "network_success")
    ) and cart_delta <= 0


def _add_keywords(action_context: dict[str, Any], *values: Any) -> None:
    keywords = action_context.setdefault("keywords", set())
    if not isinstance(keywords, set):
        return
    for value in values:
        if isinstance(value, list):
            for item in value:
                _add_keywords(action_context, item)
            continue
        if isinstance(value, str) and value:
            keywords.add(value.lower())


def _contains_action_keyword(text: Any) -> bool:
    if not isinstance(text, str):
        return False
    lowered = text.lower()
    return any(keyword in lowered for keyword in ACTION_KEYWORDS)


def _is_failed_network_event(event: dict[str, Any]) -> bool:
    if event.get("failed") is True:
        return True
    status = _to_int(event.get("status"))
    return status is not None and status >= 400


def _is_ignored_network_event(event: dict[str, Any]) -> bool:
    url = str(event.get("url") or "")
    resource_type = str(event.get("resourceType") or event.get("resource_type") or "").lower()
    if url and _is_tracking_url(url):
        return True
    if _is_non_user_impact_url(url):
        return True
    if resource_type in {"font", "stylesheet", "image", "media"}:
        return True
    if _is_image_url(url):
        return True
    return False


def _is_core_resource_failure(event: dict[str, Any]) -> bool:
    if _is_ignored_network_event(event):
        return False
    url = str(event.get("url") or "")
    resource_type = str(event.get("resourceType") or event.get("resource_type") or "").lower()
    if resource_type == "document":
        return True
    if resource_type in {"xhr", "fetch"}:
        return _is_core_action_failure_url(url)
    if resource_type == "script":
        return _is_same_origin_or_core_url(url) or _contains_action_keyword(url)
    return _is_core_action_failure_url(url)


def _is_core_action_failure_url(url: Any) -> bool:
    if not isinstance(url, str) or not url:
        return False
    if _is_tracking_url(url) or _is_non_user_impact_url(url) or _is_image_url(url):
        return False
    lowered = url.lower()
    parsed = urlparse(lowered)
    if any(hint in (parsed.path or lowered) for hint in CORE_URL_PATH_HINTS):
        return True
    return not parsed.hostname and _contains_action_keyword(lowered)


def _is_same_origin_or_core_url(url: str) -> bool:
    if not url:
        return False
    parsed = urlparse(url)
    host = parsed.hostname or ""
    path = parsed.path.lower()
    return not host or any(hint in path for hint in CORE_URL_PATH_HINTS)


def _is_interactive_request(event: dict[str, Any]) -> bool:
    resource_type = str(event.get("resourceType") or event.get("resource_type") or "").lower()
    if resource_type in {"xhr", "fetch", "document"}:
        return True
    method = str(event.get("method") or "GET").upper()
    return method not in {"", "GET", "HEAD"}


def _message_mentions_action_context(message: str, action_context: dict[str, Any]) -> bool:
    if _message_mentions_core_failure(message):
        return True
    keywords = action_context.get("keywords")
    if not isinstance(keywords, set):
        return False
    return any(keyword and keyword in message for keyword in keywords)


def _message_mentions_core_failure(message: str) -> bool:
    if not message:
        return False
    return any(
        marker in message
        for marker in (
            "is not defined",
            "referenceerror",
            "typeerror",
            "failed to fetch",
            "networkerror",
            "payment",
            "checkout",
            "login",
            "auth",
            "kakao",
            "naver",
        )
    )


def _impact_reason(observation: dict[str, Any], action_context: dict[str, Any]) -> str:
    if observation.get("type") == "console_error":
        return "action_related_console_error"
    data = _record_data_from_observation(observation)
    event = {
        "url": data.get("url") or observation.get("url") or _first_url(observation),
        "resourceType": data.get("resourceType") or data.get("resource_type"),
    }
    return _event_impact_reason(event, action_context)


def _event_impact_reason(event: dict[str, Any], action_context: dict[str, Any]) -> str:
    if _is_core_resource_failure(event):
        return "core_resource_failure"
    if action_context.get("result_missing") or action_context.get("settle_failed"):
        return "action_result_failure"
    if _action_context_is_critical(action_context):
        return "critical_action_failure"
    return "action_request_failure"


def _reliability_signals(evidence: list[dict[str, Any]], failed_count: int, console_count: int) -> list[str]:
    signals: list[str] = []
    if failed_count:
        signals.append("user_impacting_failed_request_count>0")
    if console_count:
        signals.append("user_impacting_console_error_count>0")
    reasons = sorted({str(item.get("reason")) for item in evidence if item.get("reason")})
    signals.extend(f"impact_reason={reason}" for reason in reasons)
    return signals


def _actionable_network_failure_count(network: dict[str, Any], checkpoint: dict[str, Any]) -> int:
    failed_count = int(network.get("failed_request_count") or 0)
    if failed_count <= 0:
        return 0

    urls = _extract_urls(network)
    if urls:
        actionable_urls = [
            url
            for url in urls
            if not _is_tracking_url(url) and not _is_non_user_impact_url(url) and not _is_image_url(url)
        ]
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
    if urls and all(_is_tracking_url(url) or _is_non_user_impact_url(url) or _is_image_url(url) for url in urls):
        return True
    message = _technical_message(observation).lower()
    if "slow network is detected" in message or "fallback font" in message or message.startswith("[intervention]"):
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


def _first_url(value: Any) -> str | None:
    urls = _extract_urls(value)
    return urls[0] if urls else None


def _technical_message(observation: dict[str, Any]) -> str:
    data = _record_data_from_observation(observation)
    for key in ("message", "error", "text", "description"):
        value = data.get(key) or observation.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _is_non_user_impact_url(url: str) -> bool:
    if not url:
        return False
    path = urlparse(url).path.lower()
    return path.endswith(NON_USER_IMPACT_EXTENSIONS) or "/favicon" in path


def _is_image_url(url: str) -> bool:
    if not url:
        return False
    path = urlparse(url).path.lower()
    return path.endswith(IMAGE_EXTENSIONS)


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


def _to_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        try:
            return int(text)
        except ValueError:
            return None
    return None
