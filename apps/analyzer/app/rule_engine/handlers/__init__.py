from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app.rule_engine.handlers.copy_quality import evaluate_copy_flow_quality
from app.rule_engine.handlers.form_labels import evaluate_form_labels
from app.rule_engine.handlers.journey import evaluate_journey_goal_cta_mismatch
from app.rule_engine.handlers.path_cta import evaluate_path_cta_competition, evaluate_path_cta_presence
from app.rule_engine.handlers.reliability import evaluate_loading_stuck, evaluate_reliability
from app.rule_engine.handlers.target_size import evaluate_target_size
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import StageContext

RuleHandler = Callable[[dict[str, Any], StageContext], RuleHit | None]

DEFAULT_RULE_HANDLERS: dict[str, RuleHandler] = {
    "PATH-CTA-001": evaluate_path_cta_presence,
    "PATH-CTA-002": evaluate_path_cta_competition,
    "FRICTION-FORM-001": evaluate_form_labels,
    "COPY-FLOW-QUALITY-001": evaluate_copy_flow_quality,
    "TARGET-SIZE-001": evaluate_target_size,
    "RELIABILITY-TECH-001": evaluate_reliability,
    "RELIABILITY-LOADING-STUCK-001": evaluate_loading_stuck,
    "JOURNEY-GOAL-CTA-MISMATCH-001": evaluate_journey_goal_cta_mismatch,
}
