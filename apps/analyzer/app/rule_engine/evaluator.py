from __future__ import annotations

from typing import Any

from app.contracts.stages import DECISION_STAGES, DecisionStage
from app.rule_engine.handlers import DEFAULT_RULE_HANDLERS, RuleHandler
from app.rule_engine.models import RuleEvaluation, RuleHandlerMissing, RuleHit
from app.stage.stage_context_builder import StageContext


class RuleEngine:
    def __init__(self, handlers: dict[str, RuleHandler] | None = None) -> None:
        self._handlers = handlers or DEFAULT_RULE_HANDLERS

    def evaluate(
        self,
        *,
        contexts: dict[DecisionStage, StageContext],
        registry: dict[str, Any],
    ) -> list[RuleHit]:
        hits: list[RuleHit] = []
        for evaluation in self.evaluate_registry(contexts=contexts, registry=registry):
            if evaluation.is_issue and evaluation.hit is not None:
                hits.append(evaluation.hit)
        return hits

    def evaluate_registry(
        self,
        *,
        contexts: dict[DecisionStage, StageContext],
        registry: dict[str, Any],
    ) -> list[RuleEvaluation]:
        evaluations: list[RuleEvaluation] = []
        for rule in registry.get("rules", []):
            if not isinstance(rule, dict):
                continue
            criterion_id = str(rule.get("criterion_id"))
            handler = self._handlers.get(criterion_id)
            if handler is None:
                raise RuleHandlerMissing(f"No evaluator is bound for registry rule: {criterion_id}")
            for stage in rule.get("applicableStages", []):
                if stage not in DECISION_STAGES:
                    continue
                context = contexts[stage]
                hit = handler(rule, context)
                if hit and hit.evidence_refs:
                    evaluations.append(RuleEvaluation(criterion_id=criterion_id, stage=context.stage, status="ISSUE", hit=hit))
                else:
                    evaluations.append(
                        RuleEvaluation(
                            criterion_id=criterion_id,
                            stage=context.stage,
                            status="NOT_EVALUABLE",
                            reason="handler_returned_no_evidence_backed_hit",
                        )
                    )
        return evaluations
