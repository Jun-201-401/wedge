from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

LABEL_INTEGRITY_OBSERVATION_TYPES = {
    "first_view_message",
    "value_proposition",
    "feature_summary",
    "cta_candidate",
    "interactive_components",
    "form_field",
    "form_error",
    "required_field",
    "missing_label",
    "error_recovery",
    "final_submit_candidate",
    "other",
}
LABEL_INTEGRITY_ISSUE_TYPES = {
    "encoding_broken",
    "low_readability_rendering",
    "placeholder_garbage",
    "replacement_character",
    "text_clipped",
    "text_overlap",
    "text_truncated",
}
HIGH_SEVERITY_ISSUE_TYPES = {"encoding_broken", "replacement_character", "text_clipped", "text_overlap"}
FIX_LEVERAGE_VALUES = (0.8, 0.95, 1.0, 1.15, 1.3)


def evaluate_copy_label_integrity(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    candidates = [
        candidate
        for record in context.observations
        for candidate in _label_integrity_candidates(record)
    ]
    if not candidates:
        return None

    candidate = max(candidates, key=lambda item: (_fix_leverage_rank(item["fix_leverage"]), item["confidence"]))
    return base_hit(
        rule=rule,
        context=context,
        severity=candidate["severity"],
        confidence=candidate["confidence"],
        evidence_refs=[candidate["record"].ref],
        observations=[candidate["observation"]],
        signals=candidate["signals"],
        summary="화면의 라벨이나 문구가 깨지거나 잘려 사용자가 내용을 정상적으로 읽기 어려울 수 있습니다.",
        impact_hypothesis="중요한 행동이나 입력 주변의 문구를 읽기 어렵다면 사용자가 기능을 확인하기 위해 다시 살피거나 진행을 멈출 수 있습니다.",
        recommendations=["깨짐, 말줄임, 겹침이 생긴 라벨을 전체 문구가 읽히도록 영역과 표시 방식을 조정하기"],
        validation_questions=["사용자는 해당 라벨을 확대하거나 추측하지 않고 바로 읽을 수 있는가?"],
        fix_leverage=candidate["fix_leverage"],
    )


def _label_integrity_candidates(record: ObservationRecord) -> list[dict[str, Any]]:
    observation_type = str(record.observation.get("type") or "")
    if observation_type not in LABEL_INTEGRITY_OBSERVATION_TYPES:
        return []

    data = record.observation.get("data")
    if not isinstance(data, dict):
        return []

    candidates: list[dict[str, Any]] = []
    top_level_candidate = _label_integrity_candidate(record=record, data=data)
    if top_level_candidate is not None:
        candidates.append(top_level_candidate)

    components = data.get("components")
    if isinstance(components, list):
        for component in components:
            if not isinstance(component, dict):
                continue
            component_candidate = _label_integrity_candidate(record=record, data=component, parent=data)
            if component_candidate is not None:
                candidates.append(component_candidate)
    return candidates


def _label_integrity_candidate(
    *,
    record: ObservationRecord,
    data: dict[str, Any],
    parent: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    parent = parent or {}
    signal = _integrity_signal(data)
    if signal is None:
        return None

    confidence = _confidence(record, data)
    fix_leverage = _fix_leverage(data, parent)
    severity = _severity(record=record, data=data, parent=parent, signal=signal, fix_leverage=fix_leverage)
    text = _visible_text(data)
    source = _source(data)
    signals = [
        f"label_integrity_issue_type={signal['issue_type']}",
        f"label_integrity_source={source}",
        f"fix_leverage={fix_leverage}",
    ]
    if _bool_value(data, "clicked_in_scenario"):
        signals.append("clicked_in_scenario=true")
    if _bool_value(data, "is_primary_like"):
        signals.append("is_primary_like=true")

    return {
        "record": record,
        "severity": severity,
        "confidence": confidence,
        "fix_leverage": fix_leverage,
        "observation": f"라벨 읽기 무결성 문제가 관찰됨: {text or signal['issue_type']}",
        "signals": signals,
    }


def _integrity_signal(data: dict[str, Any]) -> dict[str, Any] | None:
    integrity = data.get("label_integrity")
    if isinstance(integrity, dict):
        issue_type = _issue_type(integrity)
        if issue_type:
            return {"issue_type": issue_type}

    issue_type = _issue_type(data)
    if issue_type:
        return {"issue_type": issue_type}
    return None


def _issue_type(data: dict[str, Any]) -> str | None:
    value = str(data.get("issue_type") or data.get("integrity_issue_type") or "").strip()
    normalized = value.lower()
    return normalized if normalized in LABEL_INTEGRITY_ISSUE_TYPES else None


def _severity(
    *,
    record: ObservationRecord,
    data: dict[str, Any],
    parent: dict[str, Any],
    signal: dict[str, Any],
    fix_leverage: float,
) -> int:
    if record.stage == "COMMIT" and fix_leverage >= 1.15:
        return 3
    if fix_leverage >= 1.3 or signal["issue_type"] in HIGH_SEVERITY_ISSUE_TYPES:
        return 2
    if (
        _bool_value(data, "clicked_in_scenario")
        or _bool_value(parent, "clicked_in_scenario")
        or _bool_value(data, "is_primary_like")
        or _bool_value(parent, "is_primary_like")
    ):
        return 2
    return 1


def _confidence(record: ObservationRecord, data: dict[str, Any]) -> float:
    integrity = data.get("label_integrity")
    if isinstance(integrity, dict):
        value = integrity.get("confidence")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return min(max(float(value), 0.0), 0.9)
    value = record.observation.get("confidence")
    return min(float(value), 0.9) if isinstance(value, (int, float)) else 0.72


def _fix_leverage(data: dict[str, Any], parent: dict[str, Any]) -> float:
    integrity = data.get("label_integrity")
    if isinstance(integrity, dict):
        parsed = _allowed_fix_leverage(integrity.get("fix_leverage"))
        if parsed is not None:
            return parsed
    parsed = _allowed_fix_leverage(data.get("fix_leverage"))
    if parsed is not None:
        return parsed

    path_related = (
        _bool_value(data, "clicked_in_scenario")
        or _bool_value(parent, "clicked_in_scenario")
        or _bool_value(data, "is_primary_like")
        or _bool_value(parent, "is_primary_like")
    )
    prominence = _visual_prominence(data, parent)
    if prominence == "low" and not path_related:
        return 0.8
    if not (isinstance(data.get("bounds"), dict) or isinstance(parent.get("bounds"), dict)):
        return 0.95
    if path_related and prominence == "high":
        return 1.3
    if path_related or prominence == "high":
        return 1.15
    return 1.0


def _allowed_fix_leverage(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    for allowed in FIX_LEVERAGE_VALUES:
        if abs(number - allowed) < 0.0001:
            return allowed
    return None


def _visible_text(data: dict[str, Any]) -> str:
    for key in ("text", "visible_text", "message", "label_text", "placeholder", "accessible_name"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _source(data: dict[str, Any]) -> str:
    integrity = data.get("label_integrity")
    if isinstance(integrity, dict) and isinstance(integrity.get("source"), str):
        return str(integrity["source"])
    return "observation"


def _visual_prominence(data: dict[str, Any], parent: dict[str, Any] | None = None) -> str:
    parent = parent or {}
    value = str(data.get("visual_prominence") or data.get("prominence") or parent.get("visual_prominence") or parent.get("prominence") or "").lower()
    if value in {"low", "medium", "high"}:
        return value
    if (
        _bool_value(data, "clicked_in_scenario")
        or _bool_value(parent, "clicked_in_scenario")
        or _bool_value(data, "is_primary_like")
        or _bool_value(parent, "is_primary_like")
    ):
        return "high"
    return "medium"


def _bool_value(data: dict[str, Any], key: str) -> bool:
    return data.get(key) is True


def _fix_leverage_rank(value: float) -> int:
    order = {0.8: 1, 0.95: 2, 1.0: 3, 1.15: 4, 1.3: 5}
    return order.get(value, 0)
