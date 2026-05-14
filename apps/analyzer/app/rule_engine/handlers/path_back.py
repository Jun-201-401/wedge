from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext


def evaluate_path_back_link(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    candidates = [
        candidate
        for record in observations_of_type(context, "path_navigation")
        for candidate in [_back_link_candidate(record, context)]
        if candidate is not None
    ]
    if not candidates:
        return None

    candidate = max(candidates, key=lambda item: (item["severity"], item["flow_step_count"] or 0, item["confidence"]))
    return base_hit(
        rule=rule,
        context=context,
        severity=candidate["severity"],
        confidence=candidate["confidence"],
        evidence_refs=[candidate["record"].ref],
        observations=["다단계 흐름에서 이전 단계로 돌아가거나 입력을 수정할 수 있는 명시적인 링크가 확인되지 않았습니다."],
        signals=_signals(candidate),
        summary="이전 단계로 돌아가거나 내용을 수정하는 방법이 화면에서 명확하지 않습니다.",
        impact_hypothesis="사용자가 앞 단계의 선택이나 입력을 바꾸고 싶을 때 흐름을 포기하거나 브라우저 뒤로가기에 의존할 수 있습니다.",
        recommendations=["다단계 흐름의 중간 단계에는 '이전', '뒤로', '수정하기', '변경'처럼 현재 흐름 안에서 되돌아갈 수 있는 명시적인 링크나 버튼을 제공하기"],
        validation_questions=["사용자가 이전 단계의 선택이나 입력을 바꾸고 싶을 때 화면 안에서 바로 되돌아갈 방법을 찾을 수 있는가?"],
    )


def _back_link_candidate(record: ObservationRecord, context: StageContext) -> dict[str, Any] | None:
    data = _record_data(record)
    flow_step_count = _flow_step_count(data)
    if not _is_multistep_flow(data, flow_step_count):
        return None
    if _has_explicit_back_affordance(data):
        return None

    history_back_available = _bool_value(data.get("browser_history_back_available"))
    severity = 1 if history_back_available is True else 2
    confidence = _confidence(record)
    if history_back_available is True:
        confidence = min(confidence, 0.74)
    if context.stage == "INPUT" and history_back_available is not True:
        confidence = min(max(confidence, 0.76), 0.86)

    return {
        "record": record,
        "severity": severity,
        "confidence": confidence,
        "flow_step_count": flow_step_count,
        "step_indicator_count": _list_count(data.get("step_indicator")),
        "back_link_candidate_count": _list_count(data.get("back_link_candidate")),
        "browser_history_back_available": history_back_available,
    }


def _signals(candidate: dict[str, Any]) -> list[str]:
    values = [
        "multi_step_flow=true",
        f"flow_step_count={candidate['flow_step_count'] if candidate['flow_step_count'] is not None else 'unknown'}",
        f"step_indicator_count={candidate['step_indicator_count']}",
        f"back_link_candidate_count={candidate['back_link_candidate_count']}",
    ]
    history = candidate["browser_history_back_available"]
    if history is not None:
        values.append(f"browser_history_back_available={str(history).lower()}")
    if candidate["severity"] == 1:
        values.append("explicit_back_affordance_missing_history_available")
    else:
        values.append("explicit_back_affordance_missing")
    return values


def _is_multistep_flow(data: dict[str, Any], flow_step_count: int | None) -> bool:
    if flow_step_count is not None and flow_step_count >= 2:
        return True
    for indicator in _records(data.get("step_indicator")):
        total = _int_value(
            indicator.get("total_steps")
            or indicator.get("total")
            or indicator.get("step_count")
            or indicator.get("flow_step_count")
        )
        if total is not None and total >= 2:
            return True
    return False


def _has_explicit_back_affordance(data: dict[str, Any]) -> bool:
    for candidate in _records(data.get("back_link_candidate")):
        if candidate.get("visible") is False or candidate.get("hidden") is True:
            continue
        if candidate.get("disabled") is True or candidate.get("aria_disabled") is True or candidate.get("aria-disabled") is True:
            continue
        text = _candidate_text(candidate)
        if not text or _looks_like_back_affordance(text):
            return True
    return False


def _looks_like_back_affordance(text: str) -> bool:
    lowered = text.casefold()
    tokens = (
        "back",
        "previous",
        "prev",
        "return",
        "go back",
        "edit",
        "change",
        "modify",
        "cancel",
        "이전",
        "뒤로",
        "돌아",
        "수정",
        "변경",
        "취소",
    )
    return any(token in lowered for token in tokens)


def _candidate_text(candidate: dict[str, Any]) -> str:
    parts = [
        candidate.get("text"),
        candidate.get("visible_text"),
        candidate.get("accessible_name"),
        candidate.get("aria_label"),
        candidate.get("label"),
        candidate.get("href"),
        candidate.get("selector"),
    ]
    return " ".join(str(part).strip() for part in parts if isinstance(part, str) and part.strip())


def _record_data(record: ObservationRecord) -> dict[str, Any]:
    data = record.observation.get("data")
    return data if isinstance(data, dict) else record.observation


def _records(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _list_count(value: Any) -> int:
    return len(value) if isinstance(value, list) else 0


def _flow_step_count(data: dict[str, Any]) -> int | None:
    direct = _int_value(data.get("flow_step_count"))
    if direct is not None:
        return direct
    totals = [
        total
        for indicator in _records(data.get("step_indicator"))
        for total in [_int_value(indicator.get("total_steps") or indicator.get("total") or indicator.get("step_count"))]
        if total is not None
    ]
    return max(totals) if totals else None


def _confidence(record: ObservationRecord) -> float:
    value = record.observation.get("confidence")
    if isinstance(value, bool):
        return 0.72
    if isinstance(value, (int, float)):
        return min(max(float(value), 0.0), 0.88)
    return 0.72


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


def _int_value(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None
