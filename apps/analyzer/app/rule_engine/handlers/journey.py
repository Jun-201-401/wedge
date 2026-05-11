from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, observations_of_type
from app.rule_engine.models import RuleHit
from app.rule_engine.signals import cta_signals
from app.stage.stage_context_builder import StageContext

LOW_RELEVANCE_LABELS = {"AUXILIARY_ACTION", "IRRELEVANT_ACTION"}


def evaluate_journey_goal_cta_mismatch(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    clicked_cta_refs = _clicked_cta_refs(context)
    for signal in cta_signals(context):
        if signal.observation_ref not in clicked_cta_refs:
            continue
        if not signal.semantic_confidence_ok:
            continue
        if signal.scenario_relevance_label not in LOW_RELEVANCE_LABELS:
            continue

        severity = 2 if signal.scenario_relevance_label == "IRRELEVANT_ACTION" else 1
        return base_hit(
            rule=rule,
            context=context,
            severity=severity,
            confidence=signal.provider_confidence,
            evidence_refs=[signal.observation_ref],
            observations=[f"CTA semantic label is {signal.scenario_relevance_label}."],
            signals=[f"cta_text={signal.visible_text}", "scenario_relevance_low"],
            summary="The selected CTA appears weakly related to the scenario goal.",
            impact_hypothesis="Users may follow an action path that does not advance the intended goal.",
            recommendations=["Align the primary CTA copy and destination with the scenario goal."],
            validation_questions=["Does this CTA directly move users toward the selected goal?"],
        )
    return None


def _clicked_cta_refs(context: StageContext) -> set[str]:
    click_checkpoints = _click_checkpoint_ids(context)
    return {
        record.ref
        for record in observations_of_type(context, "cta_candidate")
        if record.checkpoint_id in click_checkpoints
    }


def _click_checkpoint_ids(context: StageContext) -> set[str]:
    ids: set[str] = set()
    for checkpoint in context.checkpoints:
        trigger = checkpoint.get("trigger") if isinstance(checkpoint, dict) else {}
        if not isinstance(trigger, dict):
            continue
        action = trigger.get("type") or trigger.get("actionType")
        if action == "click":
            checkpoint_id = str(checkpoint.get("checkpoint_id") or "")
            if checkpoint_id:
                ids.add(checkpoint_id)
    return ids
