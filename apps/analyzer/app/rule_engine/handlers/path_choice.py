from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

WARNING_CHOICE_COUNT = 11
OVERLOAD_CHOICE_COUNT = 15
CRITICAL_CHOICE_COUNT = 20


def evaluate_path_choice_overload(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    candidates = [
        candidate
        for record in observations_of_type(context, "interactive_components")
        for candidate in _choice_count_candidates(record, context)
    ]
    candidates = [candidate for candidate in candidates if candidate["severity"] > 0]
    if not candidates:
        return None

    candidate = max(candidates, key=lambda item: (item["severity"], item["choice_count"], item["confidence"]))
    count = candidate["choice_count"]
    return base_hit(
        rule=rule,
        context=context,
        severity=candidate["severity"],
        confidence=candidate["confidence"],
        evidence_refs=[candidate["record"].ref],
        observations=[f"한 viewport 안에 클릭 가능한 선택지 {count}개가 동시에 노출됨"],
        signals=[
            f"viewport_interactive_choice_count={count}",
            f"warning_threshold={WARNING_CHOICE_COUNT}",
            f"overload_threshold={OVERLOAD_CHOICE_COUNT}",
        ],
        summary="한 화면에 선택지가 과도하게 많아 사용자가 다음 이동이나 행동을 고르기 어려울 수 있습니다.",
        impact_hypothesis="비슷한 위계의 클릭 대상이 한 viewport에 많이 노출되면 사용자가 목표 행동을 고르기 전에 비교와 탐색에 더 많은 주의를 쓰게 될 수 있습니다.",
        recommendations=["한 화면의 바로가기나 행동 선택지를 우선순위에 따라 줄이고, 관련 항목은 그룹으로 묶어 시각적 위계를 분명히 하기"],
        validation_questions=["사용자는 현재 viewport에서 가장 중요한 다음 행동을 빠르게 고를 수 있는가?"],
    )


def _choice_count_candidates(record: ObservationRecord, context: StageContext) -> list[dict[str, Any]]:
    data = record.observation.get("data")
    if not isinstance(data, dict):
        return []

    components = data.get("components")
    if not isinstance(components, list):
        return []

    viewport = _viewport_for_record(record, context)
    countable_components = [
        component
        for component in components
        if _is_countable_choice(component, viewport=viewport)
    ]
    choice_count = len(countable_components)
    severity = _severity(choice_count=choice_count, stage=context.stage)
    if severity == 0:
        return []

    return [
        {
            "record": record,
            "choice_count": choice_count,
            "severity": severity,
            "confidence": _confidence(record, viewport=viewport),
        }
    ]


def _severity(*, choice_count: int, stage: str) -> int:
    if choice_count >= CRITICAL_CHOICE_COUNT and stage in {"CTA", "INPUT", "COMMIT"}:
        return 3
    if choice_count >= OVERLOAD_CHOICE_COUNT:
        return 2
    if choice_count >= WARNING_CHOICE_COUNT:
        return 1
    return 0


def _is_countable_choice(component: Any, *, viewport: dict[str, float] | None) -> bool:
    if not isinstance(component, dict):
        return False
    if component.get("visible") is False or _truthy(component.get("hidden")):
        return False
    if _truthy(component.get("disabled")) or _truthy(component.get("aria_disabled")) or _truthy(component.get("aria-disabled")):
        return False
    if _truthy(component.get("aria_hidden")) or _truthy(component.get("aria-hidden")):
        return False
    role = str(component.get("role") or "").lower()
    if component.get("clickable") is False and role not in {"button", "link", "menuitem", "tab", "checkbox", "radio"}:
        return False

    bounds = component.get("bounds")
    if isinstance(bounds, dict) and viewport is not None:
        return _intersects_viewport(bounds, viewport)
    return True


def _intersects_viewport(bounds: dict[str, Any], viewport: dict[str, float]) -> bool:
    x = _number(bounds.get("x"))
    y = _number(bounds.get("y"))
    width = _number(bounds.get("width"))
    height = _number(bounds.get("height"))
    if x is None or y is None or width is None or height is None:
        return True
    if width <= 0 or height <= 0:
        return False

    viewport_width = viewport["width"]
    viewport_height = viewport["height"]
    return x < viewport_width and x + width > 0 and y < viewport_height and y + height > 0


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


def _confidence(record: ObservationRecord, *, viewport: dict[str, float] | None) -> float:
    value = record.observation.get("confidence")
    confidence = min(float(value), 0.9) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.72
    if viewport is None:
        confidence = min(confidence, 0.78)
    return confidence


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number


def _truthy(value: Any) -> bool:
    if value is True:
        return True
    return isinstance(value, str) and value.strip().lower() in {"true", "1", "yes"}
