from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.contracts.stages import DecisionStage

RuleEvaluationStatus = str


@dataclass(frozen=True)
class RuleHit:
    criterion_id: str
    stage: DecisionStage
    axis: str
    severity: int
    confidence: float
    priority_score: float
    evidence_level: str
    evidence_refs: list[str]
    observations: list[str] = field(default_factory=list)
    signals: list[str] = field(default_factory=list)
    fix_leverage: float = 1.0
    summary: str = ""
    impact_hypothesis: str = ""
    recommendations: list[str] = field(default_factory=list)
    validation_questions: list[str] = field(default_factory=list)
    exceptions_applied: list[str] = field(default_factory=list)

    def to_issue(self, issue_id: str) -> dict[str, Any]:
        return {
            "issue_id": issue_id,
            "criterion_id": self.criterion_id,
            "stage": self.stage,
            "axis": self.axis,
            "severity": self.severity,
            "confidence": round(self.confidence, 2),
            "priority_score": self.priority_score,
            "evidence_level": self.evidence_level,
            "evidence_refs": list(self.evidence_refs),
            "observations": list(self.observations),
            "signals": list(self.signals),
            "fix_leverage": self.fix_leverage,
            "summary": self.summary,
            "impact_hypothesis": self.impact_hypothesis,
            "recommendations": list(self.recommendations),
            "validation_questions": list(self.validation_questions),
            "exceptions_applied": list(self.exceptions_applied),
        }


@dataclass(frozen=True)
class RuleEvaluation:
    criterion_id: str
    stage: DecisionStage
    status: RuleEvaluationStatus
    reason: str = ""
    hit: RuleHit | None = None

    @property
    def is_issue(self) -> bool:
        return self.status == "ISSUE" and self.hit is not None and bool(self.hit.evidence_refs)


class RuleHandlerMissing(ValueError):
    pass
