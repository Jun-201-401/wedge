from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.contracts.stages import DECISION_STAGE_DISPLAY_NAMES, DECISION_STAGES, DecisionStage
from app.providers import SemanticProviderPort
from app.normalization import SemanticLabelResolver
from app.rule_engine.evaluator import RuleEngine, RuleHit
from app.rule_engine.registry_loader import load_default_registry
from app.rule_engine.scoring import friction_score, overall_risk, stage_scores_from_issues
from app.stage.stage_context_builder import StageContext, StageContextBuilder


def analyze_evidence_packet(
    packet: dict[str, Any],
    registry: dict[str, Any] | None = None,
    semantic_provider: SemanticProviderPort | None = None,
) -> dict[str, Any]:
    registry = registry or load_default_registry()
    contexts = StageContextBuilder().build(packet)
    if semantic_provider is not None:
        contexts = SemanticLabelResolver(semantic_provider).enrich(contexts)
    hits = RuleEngine().evaluate(contexts=contexts, registry=registry)
    issues = _issues_from_hits(hits)
    stage_scores = stage_scores_from_issues(issues)
    friction = friction_score(stage_scores)

    result: dict[str, Any] = {
        "schema_version": "0.5",
        "run_id": packet.get("run_id") or "",
        "evidence_schema_version": packet.get("schema_version") or "unknown",
        "rule_registry_id": registry.get("registry_id") or "unknown",
        "summary": {
            "overall_risk": overall_risk(friction),
            "friction_score": friction,
            "top_issues_count": len(issues),
            "task_success": _task_success(packet, issues),
        },
        "stage_scores": stage_scores,
        "issues": issues,
        "decision_map": _decision_map(contexts, issues),
        "scenario_mismatch_report": _scenario_mismatch_report(packet),
        "nudges": _nudges_from_issues(issues),
        "llm_notes": [
            "Rule Engine generated deterministic stage/severity/confidence/priority values.",
            "LLM/MCP providers are constrained to semantic labels or post-judgment explanation drafts.",
        ],
    }
    return result


def _issues_from_hits(hits: list[RuleHit]) -> list[dict[str, Any]]:
    return [hit.to_issue(f"issue_{index:03d}") for index, hit in enumerate(hits, start=1)]


def _task_success(packet: dict[str, Any], issues: list[dict[str, Any]]) -> str:
    aggregate_value = (packet.get("aggregate_signals") or {}).get("task_success")
    if aggregate_value in {"success", "partial", "failed", "blocked"}:
        return str(aggregate_value)
    if any(int(issue.get("severity", 0)) >= 3 for issue in issues):
        return "blocked"
    if issues:
        return "partial"
    return "success"


def _decision_map(
    contexts: dict[DecisionStage, StageContext],
    issues: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    issues_by_stage: dict[DecisionStage, list[dict[str, Any]]] = defaultdict(list)
    for issue in issues:
        stage = issue.get("stage")
        if stage in DECISION_STAGES:
            issues_by_stage[stage].append(issue)  # type: ignore[index]

    items: list[dict[str, Any]] = []
    for stage in DECISION_STAGES:
        context = contexts[stage]
        stage_issues = issues_by_stage[stage]
        summary_item = context.decision_stage_summary.get(stage, {})
        evidence_refs = _stage_evidence_refs(context, stage_issues)

        if stage_issues:
            status = "WARNING"
            summary = _warning_summary(stage, stage_issues)
        elif summary_item.get("status") == "NOT_APPLICABLE":
            status = "NOT_APPLICABLE"
            summary = _stage_not_applicable_summary(stage)
        elif summary_item.get("status") == "BLOCKED":
            status = "BLOCKED"
            summary = f"{DECISION_STAGE_DISPLAY_NAMES[stage]} 단계가 사이트 상태로 인해 차단되었습니다."
        elif context.observed:
            status = "PASS"
            summary = _stage_pass_summary(stage)
        else:
            status = "NOT_OBSERVED"
            summary = f"{DECISION_STAGE_DISPLAY_NAMES[stage]} 단계 evidence가 아직 관찰되지 않았습니다."

        items.append(
            {
                "stage": stage,
                "displayName": DECISION_STAGE_DISPLAY_NAMES[stage],
                "status": status,
                "issueIds": [str(issue["issue_id"]) for issue in stage_issues],
                "summary": summary,
                "evidenceRefs": evidence_refs,
            }
        )
    return items


def _stage_evidence_refs(context: StageContext, issues: list[dict[str, Any]]) -> list[str]:
    refs: list[str] = []
    for issue in issues:
        refs.extend(str(ref) for ref in issue.get("evidence_refs", []))
    if not refs:
        refs.extend(context.evidence_refs())
    return list(dict.fromkeys(refs))


def _warning_summary(stage: DecisionStage, issues: list[dict[str, Any]]) -> str:
    if len(issues) == 1:
        return str(issues[0].get("summary") or f"{DECISION_STAGE_DISPLAY_NAMES[stage]} 단계에서 개선 신호가 관찰되었습니다.")
    return f"{DECISION_STAGE_DISPLAY_NAMES[stage]} 단계에서 {len(issues)}개 개선 신호가 관찰되었습니다."


def _stage_pass_summary(stage: DecisionStage) -> str:
    return {
        "FIRST_VIEW": "첫 화면에서 판단에 필요한 evidence가 관찰되었고 P0 issue는 감지되지 않았습니다.",
        "VALUE": "가치 이해 단계 evidence가 관찰되었고 P0 issue는 감지되지 않았습니다.",
        "CTA": "행동 선택 단계 evidence가 관찰되었고 P0 issue는 감지되지 않았습니다.",
        "INPUT": "입력 진행 단계 evidence가 관찰되었고 P0 issue는 감지되지 않았습니다.",
        "COMMIT": "최종 확정 단계 evidence가 관찰되었고 P0 issue는 감지되지 않았습니다.",
    }[stage]


def _stage_not_applicable_summary(stage: DecisionStage) -> str:
    return f"이 실행에서는 {DECISION_STAGE_DISPLAY_NAMES[stage]} 단계가 적용되지 않습니다."


def _scenario_mismatch_report(packet: dict[str, Any]) -> dict[str, Any] | None:
    scenario_fit = packet.get("scenario_fit")
    if not isinstance(scenario_fit, dict):
        return None
    if scenario_fit.get("scenario_fit_status") not in {"NOT_APPLICABLE", "BLOCKED_BY_SITE", "UNSAFE_OR_RESTRICTED"}:
        return None
    return {
        "scenario_type": scenario_fit.get("scenario_type") or "CONTENT_ONLY",
        "scenario_fit_status": scenario_fit.get("scenario_fit_status") or "UNKNOWN",
        "block_reason": scenario_fit.get("reason") or "Selected scenario does not fit the observed page.",
        "evidence_refs": list(scenario_fit.get("evidence_refs") or []),
        "recommended_alternatives": list(scenario_fit.get("recommended_alternatives") or []),
        "user_message": "선택한 시나리오가 현재 페이지와 맞지 않아 UX issue와 분리해 보고합니다.",
    }


def _nudges_from_issues(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    nudges: list[dict[str, Any]] = []
    for index, issue in enumerate(issues, start=1):
        recommendations = issue.get("recommendations") or []
        recommendation = str(recommendations[0]) if recommendations else "관찰된 evidence를 기준으로 UI 흐름을 단순화합니다."
        questions = issue.get("validation_questions") or []
        nudges.append(
            {
                "nudge_id": f"nudge_{index:03d}",
                "issue_id": issue["issue_id"],
                "title": str(issue.get("summary", "개선 제안"))[:80],
                "rationale": f"{issue['criterion_id']} rule hit와 evidence_refs에 근거합니다.",
                "recommendation": recommendation,
                "difficulty": "LOW" if int(issue.get("severity", 1)) <= 1 else "MEDIUM",
                "expected_effect": "사용자 결정 단계의 마찰을 낮출 수 있습니다.",
                "validation_question": str(questions[0]) if questions else "수정 후 같은 evidence 수집에서 issue가 재현되지 않는가?",
            }
        )
    return nudges
