from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

WARNING_GROUP_CHOICE_COUNT = 11
OVERLOAD_GROUP_CHOICE_COUNT = 15
CRITICAL_GROUP_CHOICE_COUNT = 20
DENSE_WARNING_CHOICE_COUNT = 7
DENSE_OVERLOAD_CHOICE_COUNT = 9
DENSE_WARNING_SPACING_PX = 8
DENSE_OVERLOAD_SPACING_PX = 16
CONTAINER_BUCKET_PX = 24
LAYOUT_CLUSTER_DISTANCE_PX = 96

UTILITY_CONTAINER_ROLES = {"banner", "header", "contentinfo", "footer"}
BROAD_CONTAINER_ROLES = {"", "main", "document", "body"}
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
    "도움",
    "고객센터",
    "저작권",
)


def evaluate_path_choice_overload(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    candidates = [
        candidate
        for record in observations_of_type(context, "interactive_components")
        for candidate in _choice_count_candidates(record, context)
    ]
    candidates = [candidate for candidate in candidates if candidate["severity"] > 0]
    if not candidates:
        return None

    candidate = max(
        candidates,
        key=lambda item: (
            item["severity"],
            item["choice_count"],
            -1 if item["avg_spacing_px"] is None else -item["avg_spacing_px"],
            item["confidence"],
        ),
    )
    count = candidate["choice_count"]
    spacing = candidate["avg_spacing_px"]
    group_label = candidate["group_label"]
    density_signal = f"group_avg_spacing_px={spacing}" if spacing is not None else "group_avg_spacing_px=unknown"
    return base_hit(
        rule=rule,
        context=context,
        severity=candidate["severity"],
        confidence=candidate["confidence"],
        evidence_refs=[candidate["record"].ref],
        observations=[f"같은 선택 영역({group_label}) 안에 클릭 가능한 선택지 {count}개가 동시에 노출됨"],
        signals=[
            f"choice_group_key={candidate['group_key']}",
            f"choice_group_label={group_label}",
            f"group_interactive_choice_count={count}",
            density_signal,
            f"warning_threshold={WARNING_GROUP_CHOICE_COUNT}",
            f"overload_threshold={OVERLOAD_GROUP_CHOICE_COUNT}",
            f"dense_warning_threshold={DENSE_WARNING_CHOICE_COUNT}@{DENSE_WARNING_SPACING_PX}px",
            f"dense_overload_threshold={DENSE_OVERLOAD_CHOICE_COUNT}@{DENSE_OVERLOAD_SPACING_PX}px",
        ],
        summary="같은 선택 영역 안에 비슷한 행동 선택지가 많이 모여 있어 사용자가 다음 행동을 고르기 어려울 수 있습니다.",
        impact_hypothesis="사용자는 화면 전체의 모든 링크가 아니라 같은 영역 안의 선택지를 비교합니다. 같은 그룹 안에 선택지가 많거나 좁은 간격으로 모이면 목표 행동을 찾기 전에 비교와 탐색 부담이 커질 수 있습니다.",
        recommendations=["같은 영역 안의 선택지를 우선순위에 따라 줄이고, 관련 항목은 더 작은 그룹이나 단계로 나누어 시각적 구분을 분명히 하기"],
        validation_questions=["사용자는 이 선택 영역 안에서 가장 중요한 다음 행동을 빠르게 고를 수 있는가?"],
    )


def _choice_count_candidates(record: ObservationRecord, context: StageContext) -> list[dict[str, Any]]:
    data = _observation_payload(record.observation)
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

    groups = _choice_groups(countable_components)
    candidates: list[dict[str, Any]] = []
    for group in groups:
        choice_count = len(group["components"])
        avg_spacing = _average_spacing(group["components"])
        severity = _severity(choice_count=choice_count, avg_spacing_px=avg_spacing, stage=context.stage)
        if severity == 0:
            continue
        candidates.append(
            {
                "record": record,
                "group_key": group["key"],
                "group_label": group["label"],
                "choice_count": choice_count,
                "avg_spacing_px": avg_spacing,
                "severity": severity,
                "confidence": _confidence(record, viewport=viewport),
            }
        )
    return candidates


def _severity(*, choice_count: int, avg_spacing_px: float | None, stage: str) -> int:
    if choice_count >= CRITICAL_GROUP_CHOICE_COUNT and stage in {"CTA", "INPUT", "COMMIT"}:
        return 3
    if choice_count >= OVERLOAD_GROUP_CHOICE_COUNT:
        return 2
    if choice_count >= WARNING_GROUP_CHOICE_COUNT:
        return 1
    if avg_spacing_px is not None and choice_count >= DENSE_OVERLOAD_CHOICE_COUNT and avg_spacing_px < DENSE_OVERLOAD_SPACING_PX:
        return 2
    if avg_spacing_px is not None and choice_count >= DENSE_WARNING_CHOICE_COUNT and avg_spacing_px < DENSE_WARNING_SPACING_PX:
        return 1
    return 0


def _is_countable_choice(component: Any, *, viewport: dict[str, float] | None) -> bool:
    if not isinstance(component, dict):
        return False
    if component.get("visible") is False or _truthy(component.get("hidden")):
        return False
    if _truthy(component.get("is_form_control")):
        return False
    if _truthy(component.get("disabled")) or _truthy(component.get("aria_disabled")) or _truthy(component.get("aria-disabled")):
        return False
    if _truthy(component.get("aria_hidden")) or _truthy(component.get("aria-hidden")):
        return False
    role = str(component.get("role") or "").lower()
    if component.get("clickable") is False and role not in {"button", "link", "menuitem", "tab", "checkbox", "radio"}:
        return False
    if _is_utility_or_legal_choice(component):
        return False

    bounds = component.get("bounds")
    if isinstance(bounds, dict) and viewport is not None:
        return _intersects_viewport(bounds, viewport)
    return True


def _choice_groups(components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    keyed_groups: dict[str, dict[str, Any]] = {}
    unkeyed: list[dict[str, Any]] = []
    for component in components:
        key = _container_group_key(component)
        if key is None:
            unkeyed.append(component)
            continue
        group = keyed_groups.setdefault(
            key,
            {
                "key": key,
                "label": _group_label(component),
                "components": [],
            },
        )
        group["components"].append(component)

    groups = list(keyed_groups.values())
    groups.extend(_layout_cluster_groups(unkeyed))
    return [group for group in groups if len(group["components"]) > 0]


def _container_group_key(component: dict[str, Any]) -> str | None:
    role = _container_role(component)
    if role in UTILITY_CONTAINER_ROLES:
        return None
    bounds = _bounds(component.get("container_bounds"))
    if bounds is not None and role not in BROAD_CONTAINER_ROLES:
        return "container:" + ":".join(
            [
                role,
                _bucket(bounds["x"]),
                _bucket(bounds["y"]),
                _bucket(bounds["width"]),
                _bucket(bounds["height"]),
            ]
        )
    heading = _text(component.get("container_heading"))
    own_bounds = _bounds(component.get("bounds"))
    if heading and own_bounds is not None:
        return f"heading:{heading.lower()}:{_bucket(own_bounds['y'])}"
    return None


def _layout_cluster_groups(components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    for component in components:
        bounds = _bounds(component.get("bounds"))
        if bounds is None:
            continue
        matched: dict[str, Any] | None = None
        for group in groups:
            if _near_group(bounds, group["bounds"]):
                matched = group
                break
        if matched is None:
            matched = {
                "key": f"layout:{len(groups) + 1}",
                "label": "layout cluster",
                "components": [],
                "bounds": bounds.copy(),
            }
            groups.append(matched)
        matched["components"].append(component)
        matched["bounds"] = _union_bounds(matched["bounds"], bounds)
    return [{"key": group["key"], "label": group["label"], "components": group["components"]} for group in groups]


def _near_group(bounds: dict[str, float], group_bounds: dict[str, float]) -> bool:
    if _vertical_overlap(bounds, group_bounds) > 0:
        return True
    return _bounds_distance(bounds, group_bounds) <= LAYOUT_CLUSTER_DISTANCE_PX


def _group_label(component: dict[str, Any]) -> str:
    heading = _text(component.get("container_heading"))
    if heading:
        return heading
    role = _container_role(component)
    return role if role else "layout cluster"


def _average_spacing(components: list[dict[str, Any]]) -> float | None:
    values = [
        value
        for component in components
        for value in [_number(component.get("nearest_target_spacing_px"))]
        if value is not None and value >= 0
    ]
    if not values:
        return None
    return round(sum(values) / len(values), 1)


def _is_utility_or_legal_choice(component: dict[str, Any]) -> bool:
    role = _container_role(component)
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
    if any(pattern in text for pattern in LEGAL_OR_HELP_PATTERN):
        return True
    if role in UTILITY_CONTAINER_ROLES:
        return True
    bounds = _bounds(component.get("bounds"))
    has_readable_label = bool(_text(component.get("text")) or _text(component.get("visible_text")) or _text(component.get("accessible_name")))
    if not has_readable_label and bounds is not None and max(bounds["width"], bounds["height"]) <= 48:
        return True
    return False


def _observation_payload(observation: dict[str, Any]) -> dict[str, Any]:
    data = observation.get("data")
    return data if isinstance(data, dict) else observation


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


def _union_bounds(left: dict[str, float], right: dict[str, float]) -> dict[str, float]:
    x1 = min(left["x"], right["x"])
    y1 = min(left["y"], right["y"])
    x2 = max(left["x"] + left["width"], right["x"] + right["width"])
    y2 = max(left["y"] + left["height"], right["y"] + right["height"])
    return {"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1}


def _vertical_overlap(left: dict[str, float], right: dict[str, float]) -> float:
    return max(0.0, min(left["y"] + left["height"], right["y"] + right["height"]) - max(left["y"], right["y"]))


def _bounds_distance(left: dict[str, float], right: dict[str, float]) -> float:
    dx = max(0.0, max(left["x"], right["x"]) - min(left["x"] + left["width"], right["x"] + right["width"]))
    dy = max(0.0, max(left["y"], right["y"]) - min(left["y"] + left["height"], right["y"] + right["height"]))
    return (dx * dx + dy * dy) ** 0.5


def _bucket(value: float) -> str:
    return str(round(value / CONTAINER_BUCKET_PX))


def _container_role(component: dict[str, Any]) -> str:
    value = component.get("container_role") or component.get("decision_area_role")
    return str(value or "").strip().lower()


def _text(value: Any) -> str:
    return str(value).strip() if isinstance(value, str) else ""


def _truthy(value: Any) -> bool:
    if value is True:
        return True
    return isinstance(value, str) and value.strip().lower() in {"true", "1", "yes"}
