from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app.rule_engine.handlers.form_labels import evaluate_form_labels
from app.rule_engine.handlers.journey import evaluate_journey_action_result, evaluate_journey_goal_cta_mismatch
from app.rule_engine.handlers.path_cta import evaluate_path_cta_competition, evaluate_path_cta_presence
from app.rule_engine.handlers.reliability import evaluate_reliability
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import StageContext

RuleHandler = Callable[[dict[str, Any], StageContext], RuleHit | None]

DEFAULT_RULE_HANDLERS: dict[str, RuleHandler] = {
    "PATH-CTA-001": evaluate_path_cta_presence,
    "PATH-CTA-002": evaluate_path_cta_competition,
    "FRICTION-FORM-001": evaluate_form_labels,
    "RELIABILITY-TECH-001": evaluate_reliability,
    "JOURNEY-ACTION-RESULT-001": evaluate_journey_action_result,
    "JOURNEY-GOAL-CTA-MISMATCH-001": evaluate_journey_goal_cta_mismatch,
}
