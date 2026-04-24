from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.contracts.stages import DECISION_STAGES, DecisionStage
from app.rule_engine.scoring import priority_score
from app.stage.stage_context_builder import ObservationRecord, StageContext


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
            "summary": self.summary,
            "impact_hypothesis": self.impact_hypothesis,
            "recommendations": list(self.recommendations),
            "validation_questions": list(self.validation_questions),
            "exceptions_applied": list(self.exceptions_applied),
        }


class RuleHandlerMissing(ValueError):
    pass


class RuleEngine:
    def __init__(self) -> None:
        self._handlers = {
            "PATH-CTA-001": self._evaluate_path_cta_presence,
            "PATH-CTA-002": self._evaluate_path_cta_competition,
            "FRICTION-FORM-001": self._evaluate_form_labels,
            "RELIABILITY-TECH-001": self._evaluate_reliability,
        }

    def evaluate(
        self,
        *,
        contexts: dict[DecisionStage, StageContext],
        registry: dict[str, Any],
    ) -> list[RuleHit]:
        hits: list[RuleHit] = []
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
                    hits.append(hit)
        return hits

    def _base_hit(
        self,
        *,
        rule: dict[str, Any],
        context: StageContext,
        severity: int,
        confidence: float,
        evidence_refs: list[str],
        observations: list[str],
        signals: list[str],
        summary: str,
        impact_hypothesis: str,
        recommendations: list[str],
        validation_questions: list[str],
    ) -> RuleHit:
        fix_leverage = float(rule.get("fix_leverage_default", 1.0))
        return RuleHit(
            criterion_id=str(rule["criterion_id"]),
            stage=context.stage,
            axis=str(rule["axis"]),
            severity=severity,
            confidence=confidence,
            priority_score=priority_score(
                severity=severity,
                stage=context.stage,
                confidence=confidence,
                fix_leverage=fix_leverage,
            ),
            evidence_level=str(rule["evidence_level"]),
            evidence_refs=evidence_refs,
            observations=observations,
            signals=signals,
            summary=summary,
            impact_hypothesis=impact_hypothesis,
            recommendations=recommendations,
            validation_questions=validation_questions,
        )

    def _observations_of_type(self, context: StageContext, *types: str) -> list[ObservationRecord]:
        return [record for record in context.observations if record.observation.get("type") in types]

    def _primary_cta_count(self, context: StageContext) -> tuple[int | None, float, list[str]]:
        cluster_records = self._observations_of_type(context, "cta_cluster")
        best_count: int | None = None
        confidence = 0.75
        refs: list[str] = []

        for record in cluster_records:
            data = record.observation.get("data") or {}
            count = data.get("primary_like_cta_count")
            if isinstance(count, int):
                if best_count is None or count > best_count:
                    best_count = count
                    confidence = float(record.observation.get("confidence", confidence))
                    refs = [record.ref]

        if best_count is not None:
            return best_count, confidence, refs

        # FIRST_VIEW contexts can contain CTA observations whose own stage is CTA.
        # Scan raw checkpoint observations as a fallback so PATH-CTA-001 does not
        # report a missing first-view CTA when the CTA candidate was correctly
        # assigned to the CTA StageContext from the same checkpoint.
        for checkpoint in context.checkpoints:
            checkpoint_id = str(checkpoint.get("checkpoint_id") or "unknown_checkpoint")
            for observation in checkpoint.get("observations", []):
                if not isinstance(observation, dict) or observation.get("type") != "cta_cluster":
                    continue
                data = observation.get("data") or {}
                count = data.get("primary_like_cta_count")
                if isinstance(count, int) and (best_count is None or count > best_count):
                    best_count = count
                    confidence = float(observation.get("confidence", confidence))
                    observation_id = observation.get("observation_id") or "unknown"
                    refs = [f"{checkpoint_id}.{observation_id}"]
        if best_count is not None:
            return best_count, confidence, refs

        aggregate = context.aggregate_signals.get("primary_cta_count_by_stage")
        if isinstance(aggregate, dict):
            count = aggregate.get(context.stage)
            if isinstance(count, int):
                return count, 0.72, [f"aggregate.primary_cta_count_by_stage.{context.stage}"]

        return None, confidence, refs

    def _evaluate_path_cta_presence(self, rule: dict[str, Any], context: StageContext) -> RuleHit | None:
        if context.scenario_fit and context.scenario_fit.get("scenario_fit_status") == "NOT_APPLICABLE":
            return None
        if not context.observed:
            return None

        primary_count, count_confidence, count_refs = self._primary_cta_count(context)
        if primary_count and primary_count > 0:
            return None

        if context.stage == "FIRST_VIEW" and not self._observations_of_type(context, "cta_cluster"):
            return None
        if primary_count == 0:
            if not count_refs or all(ref.startswith("aggregate.") for ref in count_refs):
                return None
            severity = 2 if context.stage == "CTA" else 1
            return self._base_hit(
                rule=rule,
                context=context,
                severity=severity,
                confidence=count_confidence,
                evidence_refs=count_refs,
                observations=["CTA cluster evidence에서 primary-like CTA가 0개로 확인됨"],
                signals=["primary_like_cta_count=0"],
                summary="핵심 행동을 시작할 primary CTA가 충분히 드러나지 않아 다음 행동 선택이 어려울 수 있습니다.",
                impact_hypothesis="사용자는 다음에 눌러야 할 핵심 행동을 바로 식별하지 못해 전환 시작이 지연될 수 있습니다.",
                recommendations=["핵심 CTA를 decision area 안에 하나의 primary 스타일로 노출하기"],
                validation_questions=["사용자는 첫 화면 또는 CTA 영역에서 3초 안에 핵심 CTA를 식별하는가?"],
            )

        # Missing or weak CTA-specific evidence is NOT_EVALUABLE internally in
        # this first slice. Do not create a user-facing PATH-CTA-001 issue from
        # a lone candidate without the required cluster/layout/readiness signal.
        return None

    def _evaluate_path_cta_competition(self, rule: dict[str, Any], context: StageContext) -> RuleHit | None:
        count, confidence, refs = self._primary_cta_count(context)
        if count is None or count < 3 or not refs:
            return None
        return self._base_hit(
            rule=rule,
            context=context,
            severity=2,
            confidence=confidence,
            evidence_refs=refs,
            observations=[f"같은 decision stage에서 primary급 CTA {count}개가 동시에 노출됨"],
            signals=["primary_like_cta_count>=3", "행동 경로 분산"],
            summary="같은 결정 순간에서 여러 primary급 CTA가 경쟁해 사용자가 첫 행동을 고르기 어려울 수 있습니다.",
            impact_hypothesis="무료 시작 또는 문의 같은 핵심 전환 행동의 시작률이 낮아질 수 있습니다.",
            recommendations=[
                "핵심 CTA를 1개로 정하고 보조 CTA는 secondary 스타일로 낮추기",
                "CTA 주변 카피에서 각 행동의 차이를 명확히 설명하기",
            ],
            validation_questions=["사용자는 첫 화면에서 어떤 버튼을 눌러야 하는지 바로 이해했는가?"],
        )

    def _has_form_label_evidence(self, record: ObservationRecord) -> bool:
        data = record.observation.get("data") or {}
        sources = set(record.observation.get("source") or [])
        return "label_association" in data and bool({"ax", "dom"}.intersection(sources))

    def _evaluate_form_labels(self, rule: dict[str, Any], context: StageContext) -> RuleHit | None:
        explicit_missing = [
            record for record in self._observations_of_type(context, "missing_label")
            if self._has_form_label_evidence(record)
        ]
        if explicit_missing:
            refs = [record.ref for record in explicit_missing]
            return self._base_hit(
                rule=rule,
                context=context,
                severity=2,
                confidence=max(float(record.observation.get("confidence", 0.75)) for record in explicit_missing),
                evidence_refs=refs,
                observations=["입력 필드 label 또는 accessible name 누락이 관찰됨"],
                signals=["missing_label"],
                summary="입력 필드의 목적을 알려주는 label 또는 instruction이 부족해 입력 진행이 어려울 수 있습니다.",
                impact_hypothesis="사용자가 무엇을 입력해야 하는지 확신하지 못해 입력 오류나 이탈이 늘 수 있습니다.",
                recommendations=["각 입력 필드에 visible label 또는 accessible name을 연결하기"],
                validation_questions=["스크린리더와 시각 사용자 모두 필드 목적을 즉시 이해하는가?"],
            )

        for record in self._observations_of_type(context, "form_field"):
            data = record.observation.get("data") or {}
            if not self._has_form_label_evidence(record):
                # Required label-association evidence is absent, so this rule is
                # NOT_EVALUABLE for this field and should not create a UX issue.
                continue
            label = str(data.get("label_text") or data.get("accessible_name") or "").strip()
            placeholder = str(data.get("placeholder") or "").strip()
            visible = data.get("visible", True)
            if visible is False or label:
                continue
            severity = 1 if placeholder else 2
            confidence = float(record.observation.get("confidence", 0.7))
            return self._base_hit(
                rule=rule,
                context=context,
                severity=severity,
                confidence=min(confidence, 0.78),
                evidence_refs=[record.ref],
                observations=["visible form field에 명확한 label/accessibile name이 확인되지 않음"],
                signals=["placeholder_only" if placeholder else "missing_label"],
                summary="입력 필드의 목적을 알려주는 label 또는 instruction이 부족해 입력 진행이 어려울 수 있습니다.",
                impact_hypothesis="사용자가 무엇을 입력해야 하는지 확신하지 못해 입력 오류나 이탈이 늘 수 있습니다.",
                recommendations=["placeholder에만 의존하지 말고 visible label 또는 aria-labelledby를 제공하기"],
                validation_questions=["placeholder가 사라진 뒤에도 사용자는 필드 목적을 알 수 있는가?"],
            )
        return None

    def _evaluate_reliability(self, rule: dict[str, Any], context: StageContext) -> RuleHit | None:
        refs: list[str] = []
        failed_count = 0
        console_count = 0

        for record in self._observations_of_type(context, "network_failure", "console_error"):
            if record.observation.get("type") == "network_failure":
                failed_count += 1
            if record.observation.get("type") == "console_error":
                console_count += 1
            refs.append(record.ref)

        for checkpoint in context.checkpoints:
            checkpoint_id = str(checkpoint.get("checkpoint_id") or "unknown_checkpoint")
            state = checkpoint.get("state") or {}
            network = state.get("network_summary") or {}
            console = state.get("console_summary") or {}
            checkpoint_failed = int(network.get("failed_request_count") or 0)
            checkpoint_console = int(console.get("error_count") or 0)
            if checkpoint_failed:
                failed_count += checkpoint_failed
                refs.append(f"{checkpoint_id}.state.network_summary")
            if checkpoint_console:
                console_count += checkpoint_console
                refs.append(f"{checkpoint_id}.state.console_summary")

        # Run-level aggregate reliability counters are not stage-attributed
        # evidence. They remain diagnostic until an upstream producer supplies
        # stage-specific observations or checkpoint state.

        refs = list(dict.fromkeys(refs))
        if failed_count == 0 and console_count == 0:
            return None
        return self._base_hit(
            rule=rule,
            context=context,
            severity=2,
            confidence=0.86 if any(not ref.startswith("aggregate.") for ref in refs) else 0.72,
            evidence_refs=refs,
            observations=[f"failed request {failed_count}건, console error {console_count}건이 관찰됨"],
            signals=["failed_request_count>0" if failed_count else "console_error_count>0"],
            summary="사용자 행동 직후 기술 오류가 관찰되어 진행 신뢰성이 낮아질 수 있습니다.",
            impact_hypothesis="오류가 행동 결과 피드백을 방해해 사용자가 흐름을 재시도하거나 중단할 수 있습니다.",
            recommendations=["행동 직후 실패 요청과 콘솔 오류를 우선 재현하고 사용자-facing fallback을 제공하기"],
            validation_questions=["오류 상황에서도 사용자는 다음 행동 또는 재시도 방법을 이해하는가?"],
        )
