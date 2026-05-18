from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

MIN_TARGET_SIZE_PX = 24
ENHANCED_TARGET_SIZE_PX = 44
SEVERE_TARGET_SIZE_PX = 16
TIGHT_SPACING_PX = 8
MAX_PROBLEM_TARGETS = 20

INTERACTIVE_ROLES = {"button", "link", "menuitem", "tab", "checkbox", "radio", "switch", "option"}
TEXT_ENTRY_ROLES = {"textbox", "searchbox", "combobox"}
TEXT_ENTRY_TAGS = {"textarea"}
BUTTON_INPUT_TYPES = {"button", "submit", "reset", "image"}
UTILITY_CONTAINER_ROLES = {"banner", "header", "contentinfo", "footer"}
LEGAL_OR_HELP_PATTERN = (
    "privacy",
    "terms",
    "policy",
    "cookie",
    "cookies",
    "settings",
    "help",
    "legal",
    "about",
    "copyright",
    "개인정보",
    "약관",
    "정책",
    "쿠키",
    "설정",
    "도움말",
)
CORE_ACTION_KEYWORDS = (
    "login",
    "signin",
    "sign-in",
    "signup",
    "sign-up",
    "search",
    "submit",
    "save",
    "next",
    "continue",
    "cart",
    "checkout",
    "payment",
    "pay",
    "order",
    "buy",
    "purchase",
    "verify",
    "address",
    "postcode",
    "로그인",
    "회원가입",
    "검색",
    "제출",
    "저장",
    "다음",
    "계속",
    "장바구니",
    "담기",
    "구매",
    "결제",
    "주문",
    "인증",
    "주소",
)


def evaluate_target_size(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    candidates = [
        candidate
        for record in observations_of_type(context, "interactive_components")
        for candidate in _target_size_candidates(record, context)
    ]
    candidates = [candidate for candidate in candidates if candidate["severity"] > 0]
    if not candidates:
        return None

    candidate = max(
        candidates,
        key=lambda item: (
            item["severity"],
            item["small_target_count"],
            item["tight_target_count"],
            -item["worst_min_dim_px"],
            item["confidence"],
        ),
    )
    selectors = [component["selector"] for component in candidate["problem_components"] if component.get("selector")]
    signals = [
        f"min_target_size_px={MIN_TARGET_SIZE_PX}",
        f"enhanced_target_size_px={ENHANCED_TARGET_SIZE_PX}",
        f"tight_spacing_px={TIGHT_SPACING_PX}",
        f"small_target_count={candidate['small_target_count']}",
        f"tight_target_count={candidate['tight_target_count']}",
        f"worst_target_min_dim_px={candidate['worst_min_dim_px']}",
    ]
    if selectors:
        signals.append("target_size_problem_selectors=" + "|".join(selectors[:MAX_PROBLEM_TARGETS]))

    return base_hit(
        rule=rule,
        context=context,
        severity=candidate["severity"],
        confidence=candidate["confidence"],
        evidence_refs=[candidate["record"].ref],
        observations=[
            f"{candidate['small_target_count']} interactive target(s) are smaller than {MIN_TARGET_SIZE_PX}px or tightly spaced below the enhanced target range."
        ],
        signals=signals,
        summary="일부 클릭 대상이 작거나 가까이 배치되어 사용자가 정확히 누르기 어려울 수 있습니다.",
        impact_hypothesis="작은 버튼이나 링크가 가까이 붙어 있으면 터치 환경이나 빠른 클릭 상황에서 잘못 누르거나 다시 시도할 가능성이 커집니다.",
        recommendations=[
            f"주요 버튼과 아이콘 버튼은 최소 {MIN_TARGET_SIZE_PX}px 이상으로 확보하고, 가능하면 {ENHANCED_TARGET_SIZE_PX}px 수준의 터치 영역이나 충분한 간격을 제공하기"
        ],
        validation_questions=["사용자가 마우스나 터치로 해당 버튼을 실수 없이 누를 수 있을 만큼 크기와 간격이 충분한가?"],
    )


def _target_size_candidates(record: ObservationRecord, context: StageContext) -> list[dict[str, Any]]:
    data = _observation_payload(record.observation)
    if not isinstance(data, dict):
        return []

    components = data.get("components")
    if not isinstance(components, list):
        return []

    viewport = _viewport_for_record(record, context)
    problem_components = [
        component
        for component in components
        if _is_problem_target(component, viewport=viewport)
    ]
    if not problem_components:
        return []

    severities = [_component_severity(component) for component in problem_components]
    worst_min_dim = min(_min_dim(component) for component in problem_components)
    small_target_count = sum(1 for component in problem_components if _min_dim(component) < MIN_TARGET_SIZE_PX)
    tight_target_count = sum(1 for component in problem_components if _is_tightly_spaced(component))
    return [
        {
            "record": record,
            "problem_components": problem_components[:MAX_PROBLEM_TARGETS],
            "small_target_count": small_target_count,
            "tight_target_count": tight_target_count,
            "worst_min_dim_px": round(worst_min_dim, 1),
            "severity": max(severities),
            "confidence": _confidence(record, viewport=viewport),
        }
    ]


def _is_problem_target(component: Any, *, viewport: dict[str, float] | None) -> bool:
    if not _is_countable_target(component, viewport=viewport):
        return False
    return _component_severity(component) > 0


def _component_severity(component: dict[str, Any]) -> int:
    min_dim = _min_dim(component)
    tight = _is_tightly_spaced(component)
    spacing_known = _number(component.get("nearest_target_spacing_px")) is not None
    if min_dim < SEVERE_TARGET_SIZE_PX and (tight or not spacing_known):
        return 3
    if min_dim < MIN_TARGET_SIZE_PX and (tight or not spacing_known):
        return 2
    if min_dim < MIN_TARGET_SIZE_PX:
        return 1
    if min_dim < ENHANCED_TARGET_SIZE_PX and tight:
        return 1
    return 0


def _is_countable_target(component: Any, *, viewport: dict[str, float] | None) -> bool:
    if not isinstance(component, dict):
        return False
    if component.get("visible") is False or _truthy(component.get("hidden")):
        return False
    if _truthy(component.get("disabled")) or _truthy(component.get("aria_disabled")) or _truthy(component.get("aria-disabled")):
        return False
    if _truthy(component.get("aria_hidden")) or _truthy(component.get("aria-hidden")):
        return False

    if not _has_interactive_affordance(component):
        return False
    if _is_text_entry_target(component):
        return False
    if _is_excluded_target(component):
        return False
    if not _is_goal_relevant_target(component):
        return False

    bounds = _bounds(component.get("bounds"))
    if bounds is None:
        return False
    if viewport is not None and not _intersects_viewport(bounds, viewport):
        return False
    return True


def _has_interactive_affordance(component: dict[str, Any]) -> bool:
    role = str(component.get("role") or "").lower()
    tag = str(component.get("tag") or "").lower()
    if component.get("clickable") is True:
        return True
    if tag in {"button", "input", "select"}:
        return True
    if role in INTERACTIVE_ROLES - {"link"}:
        return True
    if role == "link" or tag == "a":
        return _has_link_target(component)
    return False


def _has_link_target(component: dict[str, Any]) -> bool:
    return any(
        _text(component.get(key))
        for key in ("href", "url", "target_url")
    )


def _is_text_entry_target(component: dict[str, Any]) -> bool:
    role = str(component.get("role") or "").strip().lower()
    tag = str(component.get("tag") or "").strip().lower()
    input_type = str(component.get("type") or component.get("input_type") or "").strip().lower()
    if role in TEXT_ENTRY_ROLES:
        return True
    if tag in TEXT_ENTRY_TAGS:
        return True
    if tag == "input" and input_type not in BUTTON_INPUT_TYPES:
        return True
    return False


def _is_excluded_target(component: dict[str, Any]) -> bool:
    container_role = str(component.get("container_role") or component.get("decision_area_role") or "").strip().lower()
    if container_role in UTILITY_CONTAINER_ROLES:
        return True
    text = " ".join(
        value
        for value in (
            _text(component.get("text")),
            _text(component.get("visible_text")),
            _text(component.get("accessible_name")),
            _text(component.get("href")),
            _text(component.get("selector")),
            _text(component.get("container_heading")),
        )
        if value
    ).lower()
    return any(pattern in text for pattern in LEGAL_OR_HELP_PATTERN)


def _is_goal_relevant_target(component: dict[str, Any]) -> bool:
    return (
        _was_used_in_scenario(component)
        or _is_cta_target(component)
        or _is_form_or_required_target(component)
        or _has_core_action_keyword(component)
    )


def _was_used_in_scenario(component: dict[str, Any]) -> bool:
    if any(
        _truthy(component.get(key))
        for key in ("clicked_in_scenario", "typed_in_scenario", "filled_in_scenario", "selected_in_scenario")
    ):
        return True
    return _number(component.get("interaction_order")) is not None


def _is_cta_target(component: dict[str, Any]) -> bool:
    return _truthy(component.get("is_cta_candidate")) or _truthy(component.get("is_primary_like"))


def _is_form_or_required_target(component: dict[str, Any]) -> bool:
    role = str(component.get("role") or "").lower()
    tag = str(component.get("tag") or "").lower()
    return (
        _truthy(component.get("is_form_control"))
        or _truthy(component.get("required"))
        or tag in {"input", "select", "textarea"}
        or role in {"checkbox", "radio", "switch", "option", "textbox", "combobox", "listbox"}
    )


def _has_core_action_keyword(component: dict[str, Any]) -> bool:
    text = " ".join(
        value
        for value in (
            _text(component.get("text")),
            _text(component.get("visible_text")),
            _text(component.get("accessible_name")),
            _text(component.get("href")),
            _text(component.get("selector")),
            _text(component.get("container_heading")),
            _text(component.get("nearby_text")),
        )
        if value
    ).lower()
    return any(keyword in text for keyword in CORE_ACTION_KEYWORDS)


def _is_tightly_spaced(component: dict[str, Any]) -> bool:
    spacing = _number(component.get("nearest_target_spacing_px"))
    return spacing is not None and spacing < TIGHT_SPACING_PX


def _min_dim(component: dict[str, Any]) -> float:
    bounds = _bounds(component.get("bounds"))
    if bounds is None:
        return 0.0
    return min(bounds["width"], bounds["height"])


def _observation_payload(observation: dict[str, Any]) -> dict[str, Any]:
    data = observation.get("data")
    return data if isinstance(data, dict) else observation


def _viewport_for_record(record: ObservationRecord, context: StageContext) -> dict[str, float] | None:
    for checkpoint in context.checkpoints:
        checkpoint_id = str(checkpoint.get("checkpoint_id") or "")
        if checkpoint_id != record.checkpoint_id:
            continue
        viewport = _viewport_from_checkpoint(checkpoint)
        if viewport is not None:
            return viewport
    for checkpoint in context.checkpoints:
        viewport = _viewport_from_checkpoint(checkpoint)
        if viewport is not None:
            return viewport
    return None


def _viewport_from_checkpoint(checkpoint: dict[str, Any]) -> dict[str, float] | None:
    state = checkpoint.get("state")
    if not isinstance(state, dict):
        return None

    viewport = state.get("viewport")
    if isinstance(viewport, dict):
        normalized = _viewport_dimensions(viewport)
        if normalized is not None:
            return normalized

    layout_summary = state.get("layout_summary")
    if isinstance(layout_summary, dict):
        first_view = layout_summary.get("first_view")
        if isinstance(first_view, dict):
            return _viewport_dimensions(first_view)
    return None


def _viewport_dimensions(value: dict[str, Any]) -> dict[str, float] | None:
    width = _number(value.get("width"))
    height = _number(value.get("height"))
    if width is None or height is None or width <= 0 or height <= 0:
        return None
    return {"width": width, "height": height}


def _intersects_viewport(bounds: dict[str, Any], viewport: dict[str, float]) -> bool:
    normalized = _bounds(bounds)
    if normalized is None:
        return True

    viewport_width = viewport["width"]
    viewport_height = viewport["height"]
    return (
        normalized["x"] < viewport_width
        and normalized["x"] + normalized["width"] > 0
        and normalized["y"] < viewport_height
        and normalized["y"] + normalized["height"] > 0
    )


def _confidence(record: ObservationRecord, *, viewport: dict[str, float] | None) -> float:
    value = record.observation.get("confidence")
    confidence = min(float(value), 0.9) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.74
    if viewport is None:
        confidence = min(confidence, 0.78)
    return confidence


def _bounds(value: Any) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    x = _number(value.get("x"))
    y = _number(value.get("y"))
    width = _number(value.get("width"))
    height = _number(value.get("height"))
    if x is None or y is None or width is None or height is None:
        return None
    if width <= 0 or height <= 0:
        return None
    return {"x": x, "y": y, "width": width, "height": height}


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number


def _text(value: Any) -> str:
    return str(value).strip() if isinstance(value, str) else ""


def _truthy(value: Any) -> bool:
    if value is True:
        return True
    return isinstance(value, str) and value.strip().lower() in {"true", "1", "yes"}
