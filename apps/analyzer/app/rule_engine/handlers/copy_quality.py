from __future__ import annotations

from typing import Any

from app.providers.label_role import LABEL_ROLE_TASK_TYPE, MIN_LABEL_ROLE_CONFIDENCE
from app.rule_engine.handler_utils import base_hit
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

LABEL_ROLE_ISSUE_TYPES = {
    "intent_mismatch",
    "irrelevant_label",
    "label_role_mismatch",
    "misleading_copy",
    "misleading_label",
    "unclear_label",
}

HIGH_IMPACT_STAGES = {"CTA", "INPUT", "COMMIT"}
HIGH_LEVERAGE_ISSUE_TYPES = {
    "intent_mismatch",
    "irrelevant_label",
    "label_role_mismatch",
    "misleading_label",
    "unclear_label",
}
FIX_LEVERAGE_VALUES = (0.8, 0.95, 1.0, 1.15, 1.3)


def evaluate_copy_flow_quality(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    candidates = [
        candidate
        for record in context.observations
        for candidate in _label_role_candidates(record)
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
        summary="화면 요소의 역할이나 주변 맥락과 라벨이 맞지 않아 사용자가 기능을 오해하거나 다음 행동을 망설일 수 있습니다.",
        impact_hypothesis="라벨이 요소의 역할을 설명하지 못하면 사용자는 누르거나 입력하기 전에 기능을 다시 추측해야 하므로 목표 흐름 진입이 늦어질 수 있습니다.",
        recommendations=["요소의 실제 기능과 현재 단계의 목적이 바로 드러나도록 라벨을 구체적으로 정리하기"],
        validation_questions=["사용자는 해당 라벨만 보고 요소의 기능과 다음 행동을 바로 예측할 수 있는가?"],
        fix_leverage=candidate["fix_leverage"],
    )


def _label_role_candidates(record: ObservationRecord) -> list[dict[str, Any]]:
    data = record.observation.get("data")
    if not isinstance(data, dict):
        return []

    candidates: list[dict[str, Any]] = []
    top_level_candidate = _label_role_candidate(record=record, data=data)
    if top_level_candidate is not None:
        candidates.append(top_level_candidate)

    components = data.get("components")
    if isinstance(components, list):
        for component in components:
            if not isinstance(component, dict):
                continue
            component_candidate = _label_role_candidate(record=record, data=component, parent=data)
            if component_candidate is not None:
                candidates.append(component_candidate)
    return candidates


def _label_role_candidate(
    *,
    record: ObservationRecord,
    data: dict[str, Any],
    parent: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    parent = parent or {}

    signal = _label_role_signal(data)
    if signal is None:
        return None

    confidence = _confidence(record, data)
    fix_leverage = _fix_leverage(record=record, data=data, parent=parent, signal=signal)
    severity = _severity(record=record, data=data, parent=parent, signal=signal, fix_leverage=fix_leverage)
    text = _visible_text(data)
    expected_meaning = _expected_meaning(data)
    signals = [
        f"label_role_issue_type={signal['issue_type']}",
        f"visual_prominence={_visual_prominence(data, parent)}",
        f"fix_leverage={fix_leverage}",
    ]
    if _bool_value(data, "clicked_in_scenario"):
        signals.append("clicked_in_scenario=true")
    if _bool_value(data, "is_primary_like"):
        signals.append("is_primary_like=true")
    if expected_meaning:
        signals.append(f"expected_meaning={expected_meaning}")

    return {
        "record": record,
        "severity": severity,
        "confidence": confidence,
        "fix_leverage": fix_leverage,
        "observation": f"라벨-역할 불일치 신호가 관찰됨: {text or signal['issue_type']}",
        "signals": signals,
    }


def _label_role_signal(data: dict[str, Any]) -> dict[str, Any] | None:
    alignment = data.get("label_role_alignment")
    if not isinstance(alignment, dict):
        return None
    if str(alignment.get("task_type") or "") != LABEL_ROLE_TASK_TYPE:
        return None
    if str(alignment.get("status") or "").lower() != "mismatch":
        return None
    provider = alignment.get("provider")
    if not isinstance(provider, dict) or str(provider.get("type") or "").lower() != "gms":
        return None
    confidence = alignment.get("confidence")
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        return None
    if float(confidence) < MIN_LABEL_ROLE_CONFIDENCE:
        return None
    issue_type = _issue_type(alignment)
    if _provided_fix_leverage(data) is None:
        return None
    if issue_type:
        return {"issue_type": issue_type, "source": "label_role_alignment"}
    status = str(alignment.get("alignment") or "").lower()
    if status in {"misaligned", "role_mismatch", "intent_mismatch", "irrelevant"}:
        return {"issue_type": "label_role_mismatch", "source": "label_role_alignment"}
    return None


def _issue_type(data: dict[str, Any]) -> str | None:
    value = str(
        data.get("issue_type")
        or data.get("label_issue_type")
        or ""
    ).strip()
    normalized = value.lower()
    return normalized if normalized in LABEL_ROLE_ISSUE_TYPES else None


def _fix_leverage(
    *,
    record: ObservationRecord,
    data: dict[str, Any],
    parent: dict[str, Any],
    signal: dict[str, Any],
) -> float:
    provided = _provided_fix_leverage(data)
    if provided is not None:
        return provided

    issue_type = signal["issue_type"]
    prominence = _visual_prominence(data, parent)
    clicked = _bool_value(data, "clicked_in_scenario") or _bool_value(parent, "clicked_in_scenario")
    primary_like = _bool_value(data, "is_primary_like") or _bool_value(parent, "is_primary_like")
    path_related = clicked or primary_like
    has_position = isinstance(data.get("bounds"), dict) or isinstance(parent.get("bounds"), dict)

    if prominence == "low" and not path_related:
        return 0.8
    if not has_position:
        return 0.95
    if (
        record.stage in HIGH_IMPACT_STAGES
        and path_related
        and prominence == "high"
        and issue_type in HIGH_LEVERAGE_ISSUE_TYPES
    ):
        return 1.3
    if path_related or prominence == "high" or record.stage in {"CTA", "COMMIT"}:
        return 1.15
    return 1.0


def _severity(
    *,
    record: ObservationRecord,
    data: dict[str, Any],
    parent: dict[str, Any],
    signal: dict[str, Any],
    fix_leverage: float,
) -> int:
    issue_type = signal["issue_type"]
    if record.stage == "COMMIT" and fix_leverage >= 1.15:
        return 3
    if fix_leverage >= 1.3 or issue_type in {"misleading_label", "misleading_copy"}:
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
    alignment = data.get("label_role_alignment")
    if isinstance(alignment, dict):
        value = alignment.get("confidence")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return min(max(float(value), 0.0), 0.9)
    return 0.0


def _visible_text(data: dict[str, Any]) -> str:
    for key in ("text", "visible_text", "message", "label_text", "placeholder", "accessible_name"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _expected_meaning(data: dict[str, Any]) -> str:
    alignment = data.get("label_role_alignment")
    if isinstance(alignment, dict):
        value = alignment.get("expected_meaning")
        if isinstance(value, str) and value.strip():
            return value.strip()
    for key in ("expected_meaning", "expected_role", "expected_intent", "expected_function"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _provided_fix_leverage(data: dict[str, Any]) -> float | None:
    alignment = data.get("label_role_alignment")
    if isinstance(alignment, dict):
        value = alignment.get("fix_leverage")
        parsed = _allowed_fix_leverage(value)
        if parsed is not None:
            return parsed
    return None


def _allowed_fix_leverage(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    for allowed in FIX_LEVERAGE_VALUES:
        if abs(number - allowed) < 0.0001:
            return allowed
    return None


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
