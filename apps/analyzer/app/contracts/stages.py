from __future__ import annotations

from typing import Literal

DecisionStage = Literal["FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT"]

DECISION_STAGES: tuple[DecisionStage, ...] = (
    "FIRST_VIEW",
    "VALUE",
    "CTA",
    "INPUT",
    "COMMIT",
)

DECISION_STAGE_DISPLAY_NAMES: dict[DecisionStage, str] = {
    "FIRST_VIEW": "첫 화면 이해",
    "VALUE": "가치 이해",
    "CTA": "행동 선택",
    "INPUT": "입력 진행",
    "COMMIT": "최종 확정",
}


def is_decision_stage(value: object) -> bool:
    return isinstance(value, str) and value in DECISION_STAGES
