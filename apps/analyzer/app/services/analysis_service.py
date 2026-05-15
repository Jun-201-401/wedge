from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

from app.clients import SpringCallbackClient, SpringCallbackError, SpringCallbackResponse
from app.observability.phase_timing import (
    PhaseTimingContext,
    packet_timing_summary,
    phase_timer,
    safe_emit_phase_timing,
)
from app.providers import GMSSemanticProvider
from app.providers.label_integrity import GMSLabelIntegrityProvider
from app.providers.label_role import GMSLabelRoleProvider
from app.rule_engine import analyze_evidence_packet, load_default_registry
from app.services.llm_analysis import GMSReportExplainer

REFERENCE_FIELDS = ("label", "publisher", "title", "basisSummary", "url")


def analyzer_health() -> dict[str, str]:
    registry = load_default_registry()
    return {
        "service": "analyzer",
        "status": "ok",
        "rule_registry_id": str(registry.get("registry_id") or "unknown"),
    }


def analyze_packet(
    evidence_packet: dict[str, Any],
    *,
    timing_context: PhaseTimingContext | None = None,
) -> dict[str, Any]:
    timing_context = timing_context or _packet_timing_context(evidence_packet)
    with phase_timer(
        context=timing_context,
        phase="analysis_core_total",
        extra=lambda: packet_timing_summary(evidence_packet),
    ):
        judge_result = analyze_evidence_packet(
            evidence_packet,
            semantic_provider=GMSSemanticProvider.from_env(),
            label_integrity_provider=GMSLabelIntegrityProvider.from_env(),
            label_role_provider=GMSLabelRoleProvider.from_env(),
            timing_context=timing_context,
        )
        with phase_timer(
            context=timing_context,
            phase="report_explainer",
            extra=lambda: {"issueCount": len(judge_result.get("issues") or [])},
        ):
            return GMSReportExplainer.from_env().explain(judge_result)


def analyze_packet_and_callback(
    *,
    analysis_job_id: str,
    run_id: str,
    evidence_packet: dict[str, Any],
    callback_client: SpringCallbackClient,
    event_id: str,
    timing_context: PhaseTimingContext | None = None,
) -> dict[str, Any]:
    timing_context = timing_context or PhaseTimingContext(
        run_id=run_id,
        analysis_job_id=analysis_job_id,
    )
    started_payload = build_started_callback_payload(
        analysis_job_id=analysis_job_id,
        run_id=run_id,
    )
    started_at = time.perf_counter()
    started_response, started_error = _try_send_started_callback(
        callback_client=callback_client,
        analysis_job_id=analysis_job_id,
        payload=started_payload,
        event_id=f"{event_id}.started",
    )
    safe_emit_phase_timing(
        context=timing_context,
        phase="started_callback",
        duration_ms=(time.perf_counter() - started_at) * 1000,
        status="error" if started_error else "success",
        error_type="SpringCallbackError" if started_error else None,
        extra={"callbackStatusCode": started_response.status_code if started_response else None},
    )
    judge_result = analyze_packet(evidence_packet, timing_context=timing_context)
    payload = build_completed_callback_payload(
        analysis_job_id=analysis_job_id,
        run_id=run_id,
        judge_result=judge_result,
    )
    with phase_timer(context=timing_context, phase="completed_callback"):
        response = callback_client.send_completed(
            analysis_job_id=analysis_job_id,
            payload=payload,
            event_id=event_id,
        )
    return {
        "analysisJobId": analysis_job_id,
        "runId": run_id,
        "startedCallbackStatusCode": started_response.status_code if started_response else None,
        "startedCallbackError": started_error,
        "callbackStatusCode": response.status_code,
        "callbackBody": response.body,
        "judgeResult": judge_result,
    }


def build_started_callback_payload(
    *,
    analysis_job_id: str,
    run_id: str,
    started_at: datetime | None = None,
) -> dict[str, Any]:
    started_at = started_at or datetime.now(UTC)
    return {
        "analysisJobId": analysis_job_id,
        "runId": run_id,
        "startedAt": _format_instant(started_at),
    }


def _try_send_started_callback(
    *,
    callback_client: SpringCallbackClient,
    analysis_job_id: str,
    payload: dict[str, Any],
    event_id: str,
) -> tuple[SpringCallbackResponse | None, str | None]:
    try:
        response = callback_client.send_started(
            analysis_job_id=analysis_job_id,
            payload=payload,
            event_id=event_id,
        )
        return response, None
    except SpringCallbackError as exc:
        return None, str(exc)


def build_completed_callback_payload(
    *,
    analysis_job_id: str,
    run_id: str,
    judge_result: dict[str, Any],
    completed_at: datetime | None = None,
) -> dict[str, Any]:
    completed_at = completed_at or datetime.now(UTC)
    judge_result = _with_normalized_issue_references(judge_result)
    return {
        "analysisJobId": analysis_job_id,
        "runId": run_id,
        "analyzerVersion": "analyzer-0.5.0",
        "promptVersion": "rule-engine-v1",
        "modelInfo": {
            "llm": str(judge_result.get("llm_model") or "none"),
            "attentionModel": "rule-engine-v1",
            "ctrModel": "none",
        },
        "topFindings": [_to_top_finding(issue, rank) for rank, issue in enumerate(judge_result.get("issues") or [], start=1)][:3],
        "nudges": [_to_nudge(nudge) for nudge in judge_result.get("nudges") or []],
        "judgeResult": judge_result,
        "completedAt": _format_instant(completed_at),
    }


def _with_normalized_issue_references(judge_result: dict[str, Any]) -> dict[str, Any]:
    issues = judge_result.get("issues")
    if not isinstance(issues, list):
        return dict(judge_result)

    normalized = dict(judge_result)
    normalized_issues: list[Any] = []
    for issue in issues:
        if not isinstance(issue, dict):
            normalized_issues.append(issue)
            continue
        normalized_issue = dict(issue)
        normalized_issue["references"] = _normalized_references(issue.get("references"))
        normalized_issues.append(normalized_issue)
    normalized["issues"] = normalized_issues
    return normalized


def _normalized_references(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []

    references: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        reference: dict[str, str] = {}
        for field in REFERENCE_FIELDS:
            text = item.get(field)
            if not isinstance(text, str) or not text.strip():
                reference = {}
                break
            reference[field] = _normalized_reference_url(text) if field == "url" else text.strip()
        if reference:
            references.append(reference)
    return references


def _normalized_reference_url(value: str) -> str:
    return value.strip().removeprefix("<").removesuffix(">").strip()


def build_failed_callback_payload(
    *,
    analysis_job_id: str,
    run_id: str,
    error_code: str,
    error_message: str,
    failed_at: datetime | None = None,
) -> dict[str, Any]:
    failed_at = failed_at or datetime.now(UTC)
    return {
        "analysisJobId": analysis_job_id,
        "runId": run_id,
        "failedAt": _format_instant(failed_at),
        "errorCode": error_code,
        "errorMessage": error_message,
    }


def _to_top_finding(issue: dict[str, Any], rank: int) -> dict[str, Any]:
    criterion_id = str(issue.get("criterion_id") or issue.get("issue_id") or "UNKNOWN")
    finding = {
        "rank": rank,
        "category": criterion_id,
        "title": str(issue.get("title") or issue.get("summary") or criterion_id),
        "description": str(issue.get("impact_hypothesis") or issue.get("summary") or criterion_id),
        "confidence": issue.get("confidence", 0),
        "impact": _impact(issue.get("severity")),
        "evidenceRefs": [{"type": "evidence", "id": ref} for ref in issue.get("evidence_refs") or []],
    }
    evidence_locations = issue.get("evidence_locations")
    if isinstance(evidence_locations, list) and evidence_locations:
        finding["evidenceLocations"] = evidence_locations
    return finding


def _to_nudge(nudge: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": str(nudge.get("title") or "Review finding"),
        "rationale": str(nudge.get("rationale") or ""),
        "difficulty": str(nudge.get("difficulty") or "MEDIUM"),
        "expectedEffect": str(nudge.get("expected_effect") or nudge.get("expectedEffect") or ""),
        "priority": str(nudge.get("priority") or "P1"),
        "followUpQuestion": str(nudge.get("validation_question") or nudge.get("followUpQuestion") or ""),
    }


def _impact(severity: Any) -> str:
    if isinstance(severity, (int, float)):
        if severity >= 3:
            return "HIGH"
        if severity >= 2:
            return "MEDIUM"
        return "LOW"
    try:
        severity_value = int(severity)
    except (TypeError, ValueError):
        return "MEDIUM"
    if severity_value >= 3:
        return "HIGH"
    if severity_value >= 2:
        return "MEDIUM"
    return "LOW"


def _format_instant(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _packet_timing_context(evidence_packet: dict[str, Any]) -> PhaseTimingContext:
    return PhaseTimingContext(
        run_id=str(evidence_packet.get("run_id") or evidence_packet.get("runId") or ""),
        evidence_packet_id=str(evidence_packet.get("evidence_packet_id") or evidence_packet.get("evidencePacketId") or ""),
    )
