from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from app.contracts.stages import DECISION_STAGES, DecisionStage
from app.rule_engine.scoring import DEFAULT_SCORING_POLICY
from app.stage.stage_context_builder import StageContext

OBSERVATION_PRIORITY_POLICY_ID = "observation_priority_policy_v0_1"


@dataclass(frozen=True)
class ObservationWeight:
    weight: float
    reason: str


OBSERVATION_WEIGHTS: dict[str, ObservationWeight] = {
    "heading_structure": ObservationWeight(1.05, "first-view structure evidence"),
    "first_view_message": ObservationWeight(1.1, "first-view message evidence"),
    "value_proposition": ObservationWeight(1.25, "value proposition evidence"),
    "feature_summary": ObservationWeight(1.05, "feature/value detail evidence"),
    "audience_signal": ObservationWeight(0.9, "audience fit evidence"),
    "trust_signal": ObservationWeight(1.0, "trust evidence"),
    "cta_cluster": ObservationWeight(1.55, "CTA cluster evidence"),
    "cta_candidate": ObservationWeight(1.25, "CTA candidate evidence"),
    "cta_text_specificity": ObservationWeight(1.05, "CTA copy specificity evidence"),
    "visual_emphasis": ObservationWeight(1.0, "visual emphasis evidence"),
    "target_size_issue": ObservationWeight(1.15, "CTA target usability evidence"),
    "pricing_entrypoint": ObservationWeight(1.2, "pricing entrypoint evidence"),
    "checkout_entrypoint": ObservationWeight(1.35, "checkout entrypoint evidence"),
    "signup_entrypoint": ObservationWeight(1.25, "signup entrypoint evidence"),
    "contact_entrypoint": ObservationWeight(1.1, "contact entrypoint evidence"),
    "form_field": ObservationWeight(1.0, "form field evidence"),
    "form_error": ObservationWeight(1.35, "form error evidence"),
    "required_field": ObservationWeight(1.1, "required field evidence"),
    "missing_label": ObservationWeight(1.55, "field label risk evidence"),
    "error_recovery": ObservationWeight(1.25, "error recovery evidence"),
    "submit_disabled": ObservationWeight(1.6, "disabled submit evidence"),
    "final_submit_candidate": ObservationWeight(1.35, "final submit evidence"),
    "payment_or_sensitive_action": ObservationWeight(1.7, "payment/sensitive action evidence"),
    "terms_privacy_signal": ObservationWeight(0.9, "commit support evidence"),
    "network_failure": ObservationWeight(1.6, "network failure evidence"),
    "console_error": ObservationWeight(1.45, "console error evidence"),
    "settle_response": ObservationWeight(1.05, "action response evidence"),
    "settle_item_count_change": ObservationWeight(0.95, "value expansion evidence"),
}

SOURCE_BONUSES = {
    "dom": 0.04,
    "ax": 0.06,
    "layout": 0.05,
    "screenshot": 0.05,
    "network": 0.08,
    "console": 0.08,
    "performance": 0.06,
    "discovery": 0.03,
    "scenario_log": 0.03,
    "rule": 0.02,
}

DEFAULT_OBSERVATION_WEIGHT = ObservationWeight(0.65, "supporting observation evidence")
ISSUE_EVIDENCE_MULTIPLIER = 1.25
MAX_SOURCE_QUALITY = 1.25


def stage_observation_priorities(
    contexts: dict[DecisionStage, StageContext],
    issues: list[dict[str, Any]],
) -> dict[str, Any]:
    issue_ids_by_ref = _issue_ids_by_evidence_ref(issues)
    stages: list[dict[str, Any]] = []

    for stage in DECISION_STAGES:
        observations = [
            _observation_priority_item(record, stage, issue_ids_by_ref)
            for record in contexts[stage].observations
        ]
        observations.sort(key=lambda item: (-float(item["score"]), str(item["type"]), str(item["ref"])))
        ranked_observations = [
            {
                **observation,
                "rank": index,
            }
            for index, observation in enumerate(observations, start=1)
        ]
        stages.append(
            {
                "stage": stage,
                "observation_count": len(ranked_observations),
                "top_score": ranked_observations[0]["score"] if ranked_observations else 0.0,
                "observations": ranked_observations,
            }
        )

    return {
        "policy_id": OBSERVATION_PRIORITY_POLICY_ID,
        "formula": "type_weight * stage_weight * confidence * source_quality * data_condition_multiplier * issue_multiplier",
        "stages": stages,
    }


def legacy_component_priorities(observation_priorities: dict[str, Any]) -> dict[str, Any]:
    stages: list[dict[str, Any]] = []
    for stage_item in observation_priorities.get("stages") or []:
        if not isinstance(stage_item, dict):
            continue
        observations = stage_item.get("observations") or []
        stages.append(
            {
                "stage": stage_item.get("stage"),
                "component_count": stage_item.get("observation_count", 0),
                "top_score": stage_item.get("top_score", 0.0),
                "components": observations,
            }
        )
    return {
        "policy_id": "component_priority_policy_v0_1",
        "stages": stages,
    }


def _observation_priority_item(
    record: Any,
    stage: DecisionStage,
    issue_ids_by_ref: dict[str, list[str]],
) -> dict[str, Any]:
    observation = record.observation
    observation_type = str(observation.get("type") or "other")
    observation_weight = OBSERVATION_WEIGHTS.get(observation_type, DEFAULT_OBSERVATION_WEIGHT)
    stage_weight = DEFAULT_SCORING_POLICY.stage_weights.get(stage, 1.0)
    confidence = _confidence(observation.get("confidence"))
    sources = _sources(observation.get("source"))
    source_quality = _source_quality(sources)
    data_condition_multiplier, data_condition_reason = _data_condition_multiplier(observation_type, observation.get("data"))
    issue_ids = issue_ids_by_ref.get(record.ref, [])
    issue_multiplier = ISSUE_EVIDENCE_MULTIPLIER if issue_ids else 1.0
    score = round(
        observation_weight.weight
        * stage_weight
        * confidence
        * source_quality
        * data_condition_multiplier
        * issue_multiplier,
        2,
    )

    return {
        "ref": record.ref,
        "type": observation_type,
        "score": score,
        "type_weight": observation_weight.weight,
        "stage_weight": stage_weight,
        "confidence": round(confidence, 2),
        "source_quality": source_quality,
        "data_condition_multiplier": data_condition_multiplier,
        "sources": sources,
        "issueIds": issue_ids,
        "priority_reason": observation_weight.reason,
        "data_condition_reason": data_condition_reason,
    }


def _data_condition_multiplier(observation_type: str, data: Any) -> tuple[float, str]:
    if not isinstance(data, dict):
        return 1.0, "no structured data condition"

    if observation_type == "cta_cluster":
        count = data.get("primary_like_cta_count")
        if isinstance(count, int) and count >= 3:
            return 1.2, "primary_like_cta_count >= 3"
        if count == 0:
            return 1.15, "primary_like_cta_count = 0"
        return 1.0, "CTA count is within baseline range"

    if observation_type in {"network_failure", "console_error"}:
        return 1.2, "technical failure observation"

    if observation_type == "settle_response":
        status = data.get("settle_status")
        if status in {"timeout", "failed", "error"}:
            return 1.15, f"settle_status={status}"
        return 1.0, "settle response did not indicate failure"

    if observation_type == "settle_item_count_change":
        status = data.get("settle_status")
        current = data.get("current_count")
        expected = data.get("expected_count")
        if status == "timeout":
            return 1.1, "item count settle timed out"
        if isinstance(current, int) and isinstance(expected, int) and current < expected:
            return 1.1, "current_count is below expected_count"
        return 1.0, "item count changed as expected"

    if observation_type in {"missing_label", "form_error", "submit_disabled"}:
        return 1.15, "direct input/commit risk signal"

    if observation_type == "cta_candidate" and data.get("is_primary_like") is True:
        return 1.05, "primary-like CTA candidate"

    return 1.0, "baseline data condition"


def _issue_ids_by_evidence_ref(issues: list[dict[str, Any]]) -> dict[str, list[str]]:
    issue_ids_by_ref: dict[str, list[str]] = {}
    for issue in issues:
        issue_id = issue.get("issue_id")
        if not issue_id:
            continue
        for evidence_ref in issue.get("evidence_refs") or []:
            if isinstance(evidence_ref, str) and evidence_ref:
                issue_ids_by_ref.setdefault(evidence_ref, []).append(str(issue_id))
    return issue_ids_by_ref


def _confidence(value: Any) -> float:
    if isinstance(value, bool):
        return 0.65
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.65
    if not math.isfinite(confidence):
        return 0.65
    return max(0.0, min(1.0, confidence))


def _sources(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item]


def _source_quality(sources: list[str]) -> float:
    bonus = sum(SOURCE_BONUSES.get(source, 0.0) for source in set(sources))
    return round(min(1.0 + bonus, MAX_SOURCE_QUALITY), 2)
