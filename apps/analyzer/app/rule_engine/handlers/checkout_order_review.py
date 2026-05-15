from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

CHECKOUT_FLOW_SUBTYPES = {"checkout", "payment", "booking", "order", "application"}


def evaluate_checkout_order_review(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    candidates = [
        candidate
        for record in observations_of_type(context, "checkout_context")
        for candidate in [_missing_review_candidate(record)]
        if candidate is not None
    ]
    if not candidates:
        return None

    candidate = max(candidates, key=lambda item: (item["severity"], item["confidence"]))
    return base_hit(
        rule=rule,
        context=context,
        severity=candidate["severity"],
        confidence=candidate["confidence"],
        evidence_refs=[candidate["record"].ref],
        observations=["주문 검토 요약 없이 최종 제출 행동이 노출되어 있습니다."],
        signals=_signals(candidate),
        summary="사용자가 주문 또는 예약 정보를 검토하기 전에 최종 제출 행동이 먼저 나타납니다.",
        impact_hypothesis="사용자는 잘못된 결제, 주문, 예약, 신청 정보를 알아차리지 못한 채 최종 확정할 수 있습니다.",
        recommendations=["최종 제출 행동 전에 주문, 예약, 결제, 신청 정보를 요약해서 확인할 수 있게 보여주기"],
        validation_questions=["사용자는 최종 행동 버튼을 누르기 전에 제출할 내용을 확인할 수 있는가?"],
    )


def _missing_review_candidate(record: ObservationRecord) -> dict[str, Any] | None:
    checkout = _checkout_context(record)
    if not checkout:
        return None
    if _bool_value(checkout.get("has_final_submit")) is not True:
        return None
    if not _is_checkout_like(checkout):
        return None
    if _bool_value(checkout.get("has_order_summary")) is True:
        return None

    flow_subtype = _text(checkout.get("flow_subtype")) or "unknown"
    return {
        "record": record,
        "severity": 3 if flow_subtype == "payment" else 2,
        "confidence": _confidence(record, checkout),
        "flow_subtype": flow_subtype,
        "final_submit_text": _text(checkout.get("final_submit_text")),
        "checkout_keywords": _string_list(checkout.get("checkout_keywords")),
    }


def _checkout_context(record: ObservationRecord) -> dict[str, Any]:
    payload = _record_data(record)
    checkout = payload.get("checkout_context")
    if isinstance(checkout, dict):
        return checkout
    return payload if "has_final_submit" in payload or "has_order_summary" in payload else {}


def _is_checkout_like(checkout: dict[str, Any]) -> bool:
    if _bool_value(checkout.get("is_checkout_flow")) is True:
        return True
    flow_subtype = _text(checkout.get("flow_subtype"))
    if flow_subtype in CHECKOUT_FLOW_SUBTYPES:
        return True
    keywords = set(_string_list(checkout.get("checkout_keywords")))
    return bool(keywords & {"checkout", "summary", "total"})


def _signals(candidate: dict[str, Any]) -> list[str]:
    signals = [
        "has_final_submit=true",
        "has_order_summary=false",
        f"flow_subtype={candidate['flow_subtype']}",
    ]
    final_submit_text = candidate["final_submit_text"]
    if final_submit_text:
        signals.append(f"final_submit_text={final_submit_text}")
    keywords = candidate["checkout_keywords"]
    if keywords:
        signals.append("checkout_keywords=" + "|".join(keywords))
    return signals


def _record_data(record: ObservationRecord) -> dict[str, Any]:
    data = record.observation.get("data")
    return data if isinstance(data, dict) else record.observation


def _confidence(record: ObservationRecord, checkout: dict[str, Any]) -> float:
    value = record.observation.get("confidence")
    confidence = float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.72
    if _bool_value(checkout.get("is_checkout_flow")) is not True:
        confidence = min(confidence, 0.72)
    return min(max(confidence, 0.0), 0.86)


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


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if isinstance(item, str) and item.strip()]


def _text(value: Any) -> str:
    return str(value).strip().lower() if isinstance(value, str) else ""
