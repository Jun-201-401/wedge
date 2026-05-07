from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.clients import SpringCallbackClient, SpringCallbackError, SpringCallbackResponse
from app.rule_engine import analyze_evidence_packet, load_default_registry
from app.services.llm_analysis import GMSReportExplainer


def analyzer_health() -> dict[str, str]:
    registry = load_default_registry()
    return {
        "service": "analyzer",
        "status": "ok",
        "rule_registry_id": str(registry.get("registry_id") or "unknown"),
    }


def analyze_packet(evidence_packet: dict[str, Any]) -> dict[str, Any]:
    judge_result = analyze_evidence_packet(evidence_packet)
    return GMSReportExplainer.from_env().explain(judge_result)


def analyze_packet_and_callback(
    *,
    analysis_job_id: str,
    run_id: str,
    evidence_packet: dict[str, Any],
    callback_client: SpringCallbackClient,
    event_id: str,
) -> dict[str, Any]:
    started_payload = build_started_callback_payload(
        analysis_job_id=analysis_job_id,
        run_id=run_id,
    )
    started_response, started_error = _try_send_started_callback(
        callback_client=callback_client,
        analysis_job_id=analysis_job_id,
        payload=started_payload,
        event_id=f"{event_id}.started",
    )
    judge_result = analyze_packet(evidence_packet)
    payload = build_completed_callback_payload(
        analysis_job_id=analysis_job_id,
        run_id=run_id,
        judge_result=judge_result,
    )
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
        "title": str(issue.get("summary") or criterion_id),
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
