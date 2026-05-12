from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.contracts.stages import DecisionStage, is_decision_stage

OBSERVATION_STAGE_DEFAULTS: dict[str, DecisionStage] = {
    "heading_structure": "FIRST_VIEW",
    "first_view_message": "VALUE",
    "value_proposition": "VALUE",
    "feature_summary": "VALUE",
    "audience_signal": "VALUE",
    "trust_signal": "VALUE",
    "cta_candidate": "CTA",
    "cta_cluster": "CTA",
    "cta_text_specificity": "CTA",
    "visual_emphasis": "CTA",
    "pricing_entrypoint": "CTA",
    "checkout_entrypoint": "CTA",
    "signup_entrypoint": "CTA",
    "contact_entrypoint": "CTA",
    "form_field": "INPUT",
    "form_error": "INPUT",
    "required_field": "INPUT",
    "missing_label": "INPUT",
    "error_recovery": "INPUT",
    "submit_disabled": "COMMIT",
    "final_submit_candidate": "COMMIT",
    "payment_or_sensitive_action": "COMMIT",
    "terms_privacy_signal": "COMMIT",
    "network_failure": "CTA",
    "console_error": "CTA",
    "page_ready_timing": "CTA",
    "settle_response": "INPUT",
    "settle_item_count_change": "VALUE",
}


class StageResolver:
    """Resolve deterministic DecisionStage values without provider/LLM input."""

    def resolve_checkpoint_stage(self, checkpoint: Mapping[str, Any]) -> DecisionStage:
        primary_stage = checkpoint.get("primaryStage")
        if is_decision_stage(primary_stage):
            return primary_stage  # type: ignore[return-value]

        legacy_stage = checkpoint.get("stage")
        if is_decision_stage(legacy_stage):
            return legacy_stage  # type: ignore[return-value]

        return "FIRST_VIEW"

    def resolve_observation_stage(
        self,
        observation: Mapping[str, Any],
        checkpoint: Mapping[str, Any] | None = None,
    ) -> DecisionStage:
        explicit_stage = observation.get("stage")
        if is_decision_stage(explicit_stage):
            return explicit_stage  # type: ignore[return-value]

        observation_type = observation.get("type")
        if isinstance(observation_type, str) and observation_type in OBSERVATION_STAGE_DEFAULTS:
            return OBSERVATION_STAGE_DEFAULTS[observation_type]

        if checkpoint is not None:
            return self.resolve_checkpoint_stage(checkpoint)

        return "FIRST_VIEW"
