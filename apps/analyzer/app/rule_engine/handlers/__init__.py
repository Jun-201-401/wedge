from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app.rule_engine.handlers.copy_integrity import evaluate_copy_label_integrity
from app.rule_engine.handlers.copy_quality import evaluate_copy_flow_quality
from app.rule_engine.handlers.checkout_order_review import evaluate_checkout_order_review
from app.rule_engine.handlers.feedback_action_result import evaluate_feedback_action_result
from app.rule_engine.handlers.feedback_system_status import evaluate_feedback_system_status
from app.rule_engine.handlers.form_labels import evaluate_form_labels
from app.rule_engine.handlers.form_required_optional import evaluate_form_required_optional
from app.rule_engine.handlers.journey import evaluate_journey_goal_cta_mismatch
from app.rule_engine.handlers.path_accordion import evaluate_path_accordion_discoverability
from app.rule_engine.handlers.path_back import evaluate_path_back_link
from app.rule_engine.handlers.path_choice import evaluate_path_choice_overload
from app.rule_engine.handlers.path_cta import evaluate_path_cta_competition, evaluate_path_cta_presence
from app.rule_engine.handlers.product_image import evaluate_product_image_load
from app.rule_engine.handlers.reliability import evaluate_loading_stuck, evaluate_reliability
from app.rule_engine.handlers.safety_block import evaluate_safety_block
from app.rule_engine.handlers.target_size import evaluate_target_size
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import StageContext

RuleHandler = Callable[[dict[str, Any], StageContext], RuleHit | None]

DEFAULT_RULE_HANDLERS: dict[str, RuleHandler] = {
    "PATH-CTA-001": evaluate_path_cta_presence,
    "PATH-CTA-002": evaluate_path_cta_competition,
    "PATH-BACK-LINK-001": evaluate_path_back_link,
    "PATH-ACCORDION-DISCOVERABILITY-001": evaluate_path_accordion_discoverability,
    "PATH-CHOICE-OVERLOAD-001": evaluate_path_choice_overload,
    "CHECKOUT-ORDER-REVIEW-001": evaluate_checkout_order_review,
    "FEEDBACK-ACTION-RESULT-001": evaluate_feedback_action_result,
    "FEEDBACK-SYSTEM-STATUS-001": evaluate_feedback_system_status,
    "FRICTION-FORM-001": evaluate_form_labels,
    "FORM-REQUIRED-OPTIONAL-001": evaluate_form_required_optional,
    "COPY-FLOW-QUALITY-001": evaluate_copy_flow_quality,
    "COPY-LABEL-INTEGRITY-001": evaluate_copy_label_integrity,
    "RELIABILITY-TECH-001": evaluate_reliability,
    "RELIABILITY-LOADING-STUCK-001": evaluate_loading_stuck,
    "JOURNEY-GOAL-CTA-MISMATCH-001": evaluate_journey_goal_cta_mismatch,
    "PATH-SAFETY-BOUNDARY-001": evaluate_safety_block,
    "TECH-PRODUCT-IMAGE-LOAD-001": evaluate_product_image_load,
    "TECH-TARGET-SIZE-001": evaluate_target_size,
}
