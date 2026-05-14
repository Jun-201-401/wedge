from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

REQUIRED_MARKERS = ("*", "필수", "required", "mandatory")
OPTIONAL_MARKERS = ("선택", "optional")
NON_FIELD_TYPES = {"hidden", "submit", "button", "reset", "image"}


def evaluate_form_required_optional(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    candidates = [
        candidate
        for record in observations_of_type(context, "form_field")
        for candidate in [_required_error_without_prior_marker(record)]
        if candidate is not None
    ]
    if not candidates:
        return None

    candidate = max(candidates, key=lambda item: (item["severity"], item["confidence"]))
    field_label = candidate["field_label"] or "field"
    return base_hit(
        rule=rule,
        context=context,
        severity=candidate["severity"],
        confidence=candidate["confidence"],
        evidence_refs=[candidate["record"].ref],
        observations=[f"{field_label} produced a required-field error after submit, but no prior required marker was detected."],
        signals=[
            "submit_required_error=true",
            "visible_required_marker=false",
            f"field_label={field_label}",
            f"required_state={candidate['required_state']}",
        ],
        summary="필수 입력 항목이 사전에 명확히 표시되지 않아 사용자가 제출 후 오류를 통해서야 필요한 정보를 알게 됩니다.",
        impact_hypothesis="사용자는 어떤 항목이 반드시 필요한지 제출 전에는 알기 어렵고, 제출 후 오류를 보고 다시 입력해야 할 수 있습니다.",
        recommendations=["제출 전에 필수 입력 항목을 별표, '필수' 문구, 또는 그룹 안내로 명확하게 표시하기"],
        validation_questions=["사용자가 제출 버튼을 누르기 전에 어떤 필드가 필수인지 바로 알 수 있는가?"],
    )


def _required_error_without_prior_marker(record: ObservationRecord) -> dict[str, Any] | None:
    data = _record_data(record)
    if not _is_visible_field(data):
        return None
    if _bool_value(data.get("submit_required_error")) is not True:
        return None
    if _has_required_marker(data):
        return None

    required_state = _required_state(data)
    severity = 3 if _is_high_impact(data) else 2
    return {
        "record": record,
        "severity": severity,
        "confidence": _confidence(record, data),
        "field_label": _field_label(data),
        "required_state": required_state,
    }


def _is_visible_field(data: dict[str, Any]) -> bool:
    if data.get("visible") is False or _truthy(data.get("hidden")):
        return False
    field_type = str(data.get("input_type") or data.get("type") or "").strip().lower()
    if field_type in NON_FIELD_TYPES:
        return False
    role = str(data.get("role") or "").strip().lower()
    return role not in {"button", "submit"}


def _has_required_marker(data: dict[str, Any]) -> bool:
    if _bool_value(data.get("visible_required_marker")) is True:
        return True

    group_state = str(data.get("group_level_required_state") or "").strip().lower()
    if group_state in {"required", "all_required", "required_visible", "marked_required"}:
        return True

    text = " ".join(
        value
        for value in (
            _text(data.get("label_text")),
            _text(data.get("accessible_name")),
            _text(data.get("nearby_text")),
            _text(data.get("describedby_text")),
            _text(data.get("help_text")),
        )
        if value
    ).lower()
    return any(marker in text for marker in REQUIRED_MARKERS)


def _required_state(data: dict[str, Any]) -> str:
    if _bool_value(data.get("required")) is True:
        return "required"
    if _bool_value(data.get("aria_required")) is True or _bool_value(data.get("aria-required")) is True:
        return "aria_required"
    return "observed_submit_error"


def _is_high_impact(data: dict[str, Any]) -> bool:
    if _bool_value(data.get("payment_or_sensitive")) is True:
        return True
    text = " ".join(
        value
        for value in (
            _field_label(data),
            _text(data.get("form_heading")),
            _text(data.get("container_heading")),
        )
        if value
    ).lower()
    return any(keyword in text for keyword in ("payment", "card", "checkout", "결제", "카드", "주문"))


def _field_label(data: dict[str, Any]) -> str:
    return (
        _text(data.get("label_text"))
        or _text(data.get("accessible_name"))
        or _text(data.get("field_key"))
        or _text(data.get("name"))
        or _text(data.get("selector"))
    )


def _confidence(record: ObservationRecord, data: dict[str, Any]) -> float:
    value = record.observation.get("confidence")
    confidence = float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.78
    if _bool_value(data.get("required")) is not True and _bool_value(data.get("aria_required")) is not True:
        confidence = min(confidence, 0.82)
    return min(max(confidence, 0.72), 0.9)


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


def _truthy(value: Any) -> bool:
    return _bool_value(value) is True


def _text(value: Any) -> str:
    return str(value).strip() if isinstance(value, str) else ""
