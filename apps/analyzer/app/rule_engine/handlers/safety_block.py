from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext

EXTERNAL_BLOCK_CODES = {
    "POLICY_EXTERNAL_NAVIGATION_BLOCKED",
    "POLICY_CHECKOUT_NAVIGATION_BLOCKED",
}
HIGH_RISK_BLOCK_CODES = {
    "POLICY_PAYMENT_COMMIT_BLOCKED",
    "POLICY_DESTRUCTIVE_ACTION_BLOCKED",
}
INPUT_BLOCK_CODES = {
    "POLICY_SYNTHETIC_INPUT_BLOCKED",
    "POLICY_SHIPPING_FORM_ENTRY_BLOCKED",
    "POLICY_PAYMENT_INFO_ENTRY_BLOCKED",
}


def evaluate_safety_block(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    records = _safety_block_records(context)
    if not records:
        return None

    failure_codes = _failure_codes(records)
    severity = _severity(context, failure_codes)
    summary = _summary(failure_codes)

    return base_hit(
        rule=rule,
        context=context,
        severity=severity,
        confidence=0.94,
        evidence_refs=[record.ref for record in records],
        observations=[_observation_text(failure_codes)],
        signals=_signals(context, records, failure_codes),
        summary=summary,
        impact_hypothesis=_impact_hypothesis(failure_codes),
        recommendations=_recommendations(failure_codes),
        validation_questions=_validation_questions(failure_codes),
        fix_leverage=0.8,
    )


def _safety_block_records(context: StageContext) -> list[ObservationRecord]:
    records: list[ObservationRecord] = []
    for record in observations_of_type(context, "runner_failure"):
        failure_code = _failure_code(record)
        if failure_code and failure_code.startswith("POLICY_") and failure_code.endswith("_BLOCKED"):
            records.append(record)
    return records


def _failure_codes(records: list[ObservationRecord]) -> list[str]:
    return list(dict.fromkeys(code for record in records if (code := _failure_code(record))))


def _failure_code(record: ObservationRecord) -> str | None:
    data = record.observation.get("data")
    source = data if isinstance(data, dict) else record.observation
    value = source.get("failure_code")
    return value if isinstance(value, str) else None


def _severity(context: StageContext, failure_codes: list[str]) -> int:
    if any(code in HIGH_RISK_BLOCK_CODES for code in failure_codes):
        return 3
    if context.stage == "COMMIT":
        return 3
    return 2


def _summary(failure_codes: list[str]) -> str:
    if any(code in HIGH_RISK_BLOCK_CODES for code in failure_codes):
        return "실제 확정이나 되돌리기 어려운 행동으로 이어질 수 있어 자동 실행이 안전하게 멈췄습니다."
    if any(code in INPUT_BLOCK_CODES for code in failure_codes):
        return "테스트 입력 없이 실제 정보 입력으로 이어질 수 있어 자동 실행이 안전하게 멈췄습니다."
    if any(code in EXTERNAL_BLOCK_CODES for code in failure_codes):
        return "선택한 흐름이 외부 사이트나 허용되지 않은 경계로 이어져 자동 실행이 안전하게 멈췄습니다."
    return "선택한 흐름이 안전 정책 경계에 닿아 자동 실행이 안전하게 멈췄습니다."


def _observation_text(failure_codes: list[str]) -> str:
    if any(code in HIGH_RISK_BLOCK_CODES for code in failure_codes):
        return "실제 결제, 주문 확정, 삭제처럼 되돌리기 어려운 행동 가능성이 관찰됨"
    if any(code in INPUT_BLOCK_CODES for code in failure_codes):
        return "실제 개인정보, 배송지, 결제 정보 입력으로 이어질 수 있는 행동 가능성이 관찰됨"
    if any(code in EXTERNAL_BLOCK_CODES for code in failure_codes):
        return "외부 로그인, 외부 결제, 외부 서비스 이동처럼 현재 자동 실행 범위를 벗어나는 흐름이 관찰됨"
    return "Runner 안전 정책으로 자동 실행을 계속할 수 없는 흐름이 관찰됨"


def _impact_hypothesis(failure_codes: list[str]) -> str:
    if any(code in EXTERNAL_BLOCK_CODES for code in failure_codes):
        return "사용자가 목표 행동을 계속하려면 외부 로그인이나 외부 서비스로 이동해야 할 수 있어, 전환 흐름이 내부 페이지에서 끊겨 보일 수 있습니다."
    if any(code in INPUT_BLOCK_CODES for code in failure_codes):
        return "사용자가 행동을 이어가려면 실제 정보를 입력해야 하는 구간이 빨리 나타나, 테스트나 안내 없는 사용자는 진행을 멈출 수 있습니다."
    return "되돌리기 어려운 행동 직전까지 도달했기 때문에 사용자가 무엇을 확정하는지 충분히 확인하지 못하면 이탈하거나 실수할 수 있습니다."


def _recommendations(failure_codes: list[str]) -> list[str]:
    if any(code in EXTERNAL_BLOCK_CODES for code in failure_codes):
        return ["외부 서비스로 이동하기 전에 이동 목적, 이동 대상, 돌아오는 방법을 사용자가 알 수 있게 안내하기"]
    if any(code in INPUT_BLOCK_CODES for code in failure_codes):
        return ["실제 정보 입력이 필요한 지점 전에 필요한 정보, 입력 이유, 개인정보 처리 안내를 명확히 제공하기"]
    return ["최종 확정이나 되돌리기 어려운 행동 전에 사용자가 선택 내용을 검토하고 취소할 수 있는 단계를 제공하기"]


def _validation_questions(failure_codes: list[str]) -> list[str]:
    if any(code in EXTERNAL_BLOCK_CODES for code in failure_codes):
        return ["사용자는 외부 서비스로 이동하는 이유와 이동 후 무엇을 해야 하는지 이해할 수 있는가?"]
    if any(code in INPUT_BLOCK_CODES for code in failure_codes):
        return ["사용자는 어떤 정보를 왜 입력해야 하는지, 입력 전에 충분히 이해할 수 있는가?"]
    return ["사용자는 최종 확정 전에 선택 내용과 결과를 충분히 검토할 수 있는가?"]


def _signals(context: StageContext, records: list[ObservationRecord], failure_codes: list[str]) -> list[str]:
    signals = [
        f"safety_block_count_by_stage.{context.stage}={len(records)}",
        *(f"safety_block_reason={code}" for code in failure_codes),
    ]
    return list(dict.fromkeys(signals))
