from __future__ import annotations

from app.contracts.stages import DECISION_STAGES, DecisionStage

STAGE_WEIGHTS: dict[DecisionStage, float] = {
    "FIRST_VIEW": 1.2,
    "VALUE": 1.1,
    "CTA": 1.3,
    "INPUT": 1.2,
    "COMMIT": 1.4,
}


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(max(value, minimum), maximum)


def priority_score(
    *,
    severity: int,
    stage: DecisionStage,
    confidence: float,
    fix_leverage: float = 1.0,
) -> float:
    return round(severity * STAGE_WEIGHTS[stage] * confidence * fix_leverage, 2)


def issue_risk(severity: int, confidence: float) -> float:
    return round(clamp((severity / 3) * confidence * 100, 0, 100), 2)


def stage_scores_from_issues(issues: list[dict[str, object]]) -> list[dict[str, object]]:
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


def friction_score(stage_scores: list[dict[str, object]]) -> float:
    if not stage_scores:
        return 0.0
    weighted_sum = 0.0
    total_weight = 0.0
    for item in stage_scores:
        stage = item.get("stage")
        if stage not in STAGE_WEIGHTS:
            continue
        weight = STAGE_WEIGHTS[stage]  # type: ignore[index]
        weighted_sum += float(item.get("score", 0.0)) * weight
        total_weight += weight
    if total_weight == 0:
        return 0.0
    return round(clamp(weighted_sum / total_weight, 0, 100), 2)


def overall_risk(friction: float) -> str:
    if friction >= 80:
        return "critical"
    if friction >= 60:
        return "high"
    if friction >= 25:
        return "medium"
    return "low"
