from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext


def has_form_label_evidence(record: ObservationRecord) -> bool:
    data = record.observation.get("data") or {}
    sources = set(record.observation.get("source") or [])
    return "label_association" in data and bool({"ax", "dom"}.intersection(sources))


def evaluate_form_labels(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    explicit_missing = [
        record for record in observations_of_type(context, "missing_label")
        if has_form_label_evidence(record)
    ]
    if explicit_missing:
        refs = [record.ref for record in explicit_missing]
        return base_hit(
            rule=rule,
            context=context,
            severity=2,
            confidence=max(float(record.observation.get("confidence", 0.75)) for record in explicit_missing),
            evidence_refs=refs,
            observations=["입력칸의 목적을 알려주는 이름이나 안내 문구가 확인되지 않음"],
            signals=["missing_label"],
            summary="입력칸의 목적을 알려주는 이름이나 안내 문구가 부족해 사용자가 무엇을 입력해야 하는지 헷갈릴 수 있습니다.",
            impact_hypothesis="사용자가 무엇을 입력해야 하는지 확신하지 못해 입력 오류나 이탈이 늘 수 있습니다.",
            recommendations=["각 입력칸의 목적을 화면에 보이게 표시하거나 보조기술이 읽을 수 있도록 연결하기"],
            validation_questions=["스크린리더와 시각 사용자 모두 필드 목적을 즉시 이해하는가?"],
        )

    for record in observations_of_type(context, "form_field"):
        data = record.observation.get("data") or {}
        if not has_form_label_evidence(record):
            # Required label-association evidence is absent, so this rule is
            # NOT_EVALUABLE for this field and should not create a UX issue.
            continue
        label = str(data.get("label_text") or data.get("accessible_name") or "").strip()
        placeholder = str(data.get("placeholder") or "").strip()
        visible = data.get("visible", True)
        if visible is False or label:
            continue
        severity = 1 if placeholder else 2
        confidence = float(record.observation.get("confidence", 0.7))
        return base_hit(
            rule=rule,
            context=context,
            severity=severity,
            confidence=min(confidence, 0.78),
            evidence_refs=[record.ref],
            observations=["화면에 보이는 입력칸에서 명확한 이름이나 안내 문구가 확인되지 않음"],
            signals=["placeholder_only" if placeholder else "missing_label"],
            summary="입력칸의 목적을 알려주는 이름이나 안내 문구가 부족해 사용자가 무엇을 입력해야 하는지 헷갈릴 수 있습니다.",
            impact_hypothesis="사용자가 무엇을 입력해야 하는지 확신하지 못해 입력 오류나 이탈이 늘 수 있습니다.",
            recommendations=["입력 예시 문구에만 의존하지 말고 입력칸의 이름을 화면에 계속 보이게 표시하기"],
            validation_questions=["입력 예시 문구가 사라진 뒤에도 사용자는 입력칸의 목적을 알 수 있는가?"],
        )
    return None
