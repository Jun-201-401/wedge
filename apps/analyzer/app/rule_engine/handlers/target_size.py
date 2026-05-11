from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

SEARCH_OBSERVATION_TYPES = {"form_field", "interactive_components", "cta_candidate", "final_submit_candidate"}
REFERENCE_SEARCH_HEIGHT = 44
REFERENCE_SEARCH_WIDTH = 584
VIEWPORT_SIDE_MARGIN = 32


def evaluate_target_size(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    viewport_width = _viewport_width(context)
    candidates = [
        candidate
        for record in context.observations
        for candidate in _search_target_candidates(record, viewport_width=viewport_width)
    ]
    candidates = [candidate for candidate in candidates if candidate["severity"] > 0]
    if not candidates:
        return None

    candidate = max(candidates, key=lambda item: (item["severity"], item["confidence"]))
    return base_hit(
        rule=rule,
        context=context,
        severity=candidate["severity"],
        confidence=candidate["confidence"],
        evidence_refs=[candidate["record"].ref],
        observations=[candidate["observation"]],
        signals=candidate["signals"],
        summary="검색창의 입력 영역이 Google 검색창 기준보다 작아 검색어를 입력하기 어려울 수 있습니다.",
        impact_hypothesis="검색창이 충분히 넓거나 높지 않으면 사용자가 검색창을 정확히 선택하거나 입력 내용을 확인하는 데 더 많은 주의를 써야 할 수 있습니다.",
        recommendations=["검색창 높이와 폭을 Google 검색창 기준에 가깝게 확보하고, 특히 주요 검색 흐름에서는 입력 영역을 더 넉넉하게 조정하기"],
        validation_questions=["사용자는 검색창을 바로 알아보고 불편 없이 클릭한 뒤 검색어를 입력할 수 있는가?"],
    )


def _search_target_candidates(record: ObservationRecord, *, viewport_width: float | None) -> list[dict[str, Any]]:
    observation_type = str(record.observation.get("type") or "")
    if observation_type not in SEARCH_OBSERVATION_TYPES:
        return []

    data = record.observation.get("data")
    if not isinstance(data, dict):
        return []

    candidates: list[dict[str, Any]] = []
    top_level_candidate = _search_target_candidate(record=record, data=data, viewport_width=viewport_width)
    if top_level_candidate is not None:
        candidates.append(top_level_candidate)

    components = data.get("components")
    if isinstance(components, list):
        for component in components:
            if not isinstance(component, dict):
                continue
            component_candidate = _search_target_candidate(record=record, data=component, viewport_width=viewport_width)
            if component_candidate is not None:
                candidates.append(component_candidate)
    return candidates


def _search_target_candidate(
    *,
    record: ObservationRecord,
    data: dict[str, Any],
    viewport_width: float | None,
) -> dict[str, Any] | None:
    if not _is_search_field(data):
        return None
    bounds = data.get("hit_area_bounds") if isinstance(data.get("hit_area_bounds"), dict) else data.get("bounds")
    if not isinstance(bounds, dict):
        return None

    width = _positive_number(bounds.get("width"))
    height = _positive_number(bounds.get("height"))
    if width is None or height is None:
        return None

    reference_width = _reference_width(viewport_width)
    width_ratio = width / reference_width
    clicked = _bool_value(data, "clicked_in_scenario") or _bool_value(data, "typed_in_scenario") or _bool_value(data, "filled_in_scenario")
    severity = _severity(width=width, height=height, width_ratio=width_ratio, clicked=clicked)
    confidence = _confidence(record, viewport_width=viewport_width)
    signals = [
        f"target_type=search_input",
        f"search_width={_format_number(width)}",
        f"search_height={_format_number(height)}",
        f"google_reference_width={_format_number(reference_width)}",
        f"google_reference_height={REFERENCE_SEARCH_HEIGHT}",
        f"width_ratio={width_ratio:.2f}",
    ]
    if clicked:
        signals.append("search_used_in_scenario=true")

    return {
        "record": record,
        "severity": severity,
        "confidence": confidence,
        "observation": f"검색창 크기 부족: { _visible_text(data) or _selector(data) or 'search input' }",
        "signals": signals,
    }


def _severity(*, width: float, height: float, width_ratio: float, clicked: bool) -> int:
    if clicked and (height < 32 or width_ratio < 0.45 or width < 100):
        return 3
    if height < 32 or width_ratio < 0.55 or width < 100:
        return 2
    if height < 40 or width_ratio < 0.75 or width < 120:
        return 1
    return 0


def _is_search_field(data: dict[str, Any]) -> bool:
    role = str(data.get("role") or "").lower()
    if role == "searchbox":
        return True

    for key in ("input_type", "inputType", "type", "component_type", "componentType"):
        value = str(data.get(key) or "").lower()
        if value in {"search", "search_input", "searchbox"}:
            return True

    haystack = " ".join(
        str(data.get(key) or "")
        for key in (
            "text",
            "visible_text",
            "placeholder",
            "aria_label",
            "ariaLabel",
            "accessible_name",
            "label_text",
            "selector",
            "id",
            "class",
            "name",
        )
    ).lower()
    return any(term in haystack for term in ("검색", "search"))


def _viewport_width(context: StageContext) -> float | None:
    for checkpoint in context.checkpoints:
        state = checkpoint.get("state")
        if not isinstance(state, dict):
            continue
        viewport = state.get("viewport")
        if isinstance(viewport, dict):
            width = _positive_number(viewport.get("width"))
            if width is not None:
                return width
        layout_summary = state.get("layout_summary")
        if isinstance(layout_summary, dict):
            first_view = layout_summary.get("first_view")
            if isinstance(first_view, dict):
                width = _positive_number(first_view.get("width"))
                if width is not None:
                    return width
    return None


def _reference_width(viewport_width: float | None) -> float:
    if viewport_width is None:
        return REFERENCE_SEARCH_WIDTH
    return max(1.0, min(REFERENCE_SEARCH_WIDTH, viewport_width - VIEWPORT_SIDE_MARGIN))


def _confidence(record: ObservationRecord, *, viewport_width: float | None) -> float:
    value = record.observation.get("confidence")
    confidence = min(float(value), 0.9) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.72
    if viewport_width is None:
        confidence = min(confidence, 0.78)
    return confidence


def _positive_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _visible_text(data: dict[str, Any]) -> str:
    for key in ("text", "visible_text", "placeholder", "label_text", "accessible_name"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _selector(data: dict[str, Any]) -> str:
    value = data.get("selector")
    return value.strip() if isinstance(value, str) else ""


def _bool_value(data: dict[str, Any], key: str) -> bool:
    return data.get(key) is True


def _format_number(value: float) -> str:
    number = float(value)
    return str(int(number)) if number.is_integer() else f"{number:.1f}"
