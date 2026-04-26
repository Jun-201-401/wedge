from __future__ import annotations

from dataclasses import dataclass

from app.contracts.stages import DECISION_STAGES, DecisionStage


@dataclass(frozen=True)
class ScoringPolicy:
    policy_id: str
    stage_weights: dict[DecisionStage, float]
    medium_risk_threshold: float = 25.0
    high_risk_threshold: float = 60.0
    critical_risk_threshold: float = 80.0


DEFAULT_SCORING_POLICY = ScoringPolicy(
    policy_id="scoring_policy_v0_5_default",
    stage_weights={
        "FIRST_VIEW": 1.2,
        "VALUE": 1.1,
        "CTA": 1.3,
        "INPUT": 1.2,
        "COMMIT": 1.4,
    },
)

STAGE_WEIGHTS = DEFAULT_SCORING_POLICY.stage_weights


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def priority_score(
    *,
    severity: int,
    stage: DecisionStage,
    confidence: float,
    fix_leverage: float = 1.0,
    policy: ScoringPolicy = DEFAULT_SCORING_POLICY,
) -> float:
    return round(severity * policy.stage_weights[stage] * confidence * fix_leverage, 2)


def issue_risk(severity: int, confidence: float) -> float:
    return round(clamp((severity / 3) * confidence * 100, 0, 100), 2)


def stage_scores_from_issues(
    issues: list[dict[str, object]],
    *,
    policy: ScoringPolicy = DEFAULT_SCORING_POLICY,
) -> list[dict[str, object]]:
    scores: list[dict[str, object]] = []
    for stage in DECISION_STAGES:
        stage_issues = [issue for issue in issues if issue.get("stage") == stage]
        if not stage_issues:
            continue
        max_risk = max(
            issue_risk(int(issue.get("severity", 0)), float(issue.get("confidence", 0.0)))
            for issue in stage_issues
        )
        scores.append({"stage": stage, "score": max_risk, "issue_count": len(stage_issues)})
    return scores


def friction_score(
    stage_scores: list[dict[str, object]],
    *,
    policy: ScoringPolicy = DEFAULT_SCORING_POLICY,
) -> float:
    if not stage_scores:
        return 0.0
    weighted_sum = 0.0
    total_weight = 0.0
    for item in stage_scores:
        stage = item.get("stage")
        if stage not in policy.stage_weights:
            continue
        weight = policy.stage_weights[stage]  # type: ignore[index]
        weighted_sum += float(item.get("score", 0.0)) * weight
        total_weight += weight
    if total_weight == 0:
        return 0.0
    return round(clamp(weighted_sum / total_weight, 0, 100), 2)


def overall_risk(friction: float, *, policy: ScoringPolicy = DEFAULT_SCORING_POLICY) -> str:
    if friction >= policy.critical_risk_threshold:
        return "critical"
    if friction >= policy.high_risk_threshold:
        return "high"
    if friction >= policy.medium_risk_threshold:
        return "medium"
    return "low"
