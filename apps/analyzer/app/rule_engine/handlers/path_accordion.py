from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import ObservationRecord, StageContext


def evaluate_path_accordion_discoverability(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    candidates = [
        candidate
        for record in observations_of_type(context, "accordion_state")
        for candidate in _hidden_primary_like_cta_candidates(record)
    ]
    if not candidates:
        return None

    candidate = max(candidates, key=lambda item: (item["confidence"], item["trigger_text"]))
    trigger_text = candidate["trigger_text"] or "accordion"
    return base_hit(
        rule=rule,
        context=context,
        severity=2,
        confidence=candidate["confidence"],
        evidence_refs=[candidate["record"].ref],
        observations=[f"접힌 아코디언 '{trigger_text}' 안에 강조된 행동 버튼이 숨겨져 있습니다."],
        signals=[
            "accordion.expanded=false",
            "hidden_panel_has_primary_like_cta=true",
            f"accordion.trigger_text={trigger_text}",
            f"accordion.panel_relationship={candidate['panel_relationship']}",
        ],
        summary="중요한 행동 버튼이 접힌 아코디언 안에 숨겨져 있어 다음 행동을 발견하기 어렵습니다.",
        impact_hypothesis="사용자는 아코디언을 열기 전까지 주요 다음 행동을 볼 수 없어 행동 버튼을 놓칠 수 있습니다.",
        recommendations=["주요 행동 버튼을 접힌 아코디언 밖에 보이게 두거나, 아코디언 라벨이 해당 행동을 명확히 가리키도록 수정하기"],
        validation_questions=["사용자는 이 아코디언을 열지 않아도 주요 다음 행동을 찾을 수 있는가?"],
    )


def _hidden_primary_like_cta_candidates(record: ObservationRecord) -> list[dict[str, Any]]:
    data = _observation_payload(record.observation)
    accordions = data.get("accordions")
    if not isinstance(accordions, list):
        return []

    confidence = _confidence(record)
    candidates: list[dict[str, Any]] = []
    for accordion in accordions:
        if not isinstance(accordion, dict):
            continue
        if accordion.get("expanded") is not False:
            continue
        if accordion.get("hidden_panel_has_primary_like_cta") is not True:
            continue
        candidates.append(
            {
                "record": record,
                "confidence": confidence,
                "trigger_text": _text(accordion.get("trigger_text")),
                "panel_relationship": _text(accordion.get("panel_relationship")) or "unknown",
            }
        )
    return candidates


def _observation_payload(observation: dict[str, Any]) -> dict[str, Any]:
    data = observation.get("data")
    return data if isinstance(data, dict) else observation


def _confidence(record: ObservationRecord) -> float:
    value = record.observation.get("confidence")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.72
    return min(float(value), 0.86)


def _text(value: Any) -> str:
    return str(value).strip() if isinstance(value, str) else ""
