from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.rule_engine import analyze_evidence_packet, load_default_registry


def analyzer_health() -> dict[str, str]:
    registry = load_default_registry()
    return {
        "service": "analyzer",
        "status": "ok",
        "rule_registry_id": str(registry.get("registry_id") or "unknown"),
    }


def analyze_packet(evidence_packet: dict[str, Any]) -> dict[str, Any]:
    return analyze_evidence_packet(evidence_packet)


def analyze_packet_and_callback(
    *,
    analysis_job_id: str,
    run_id: str,
    evidence_packet: dict[str, Any],
    callback_client: Any,
    event_id: str,
) -> dict[str, Any]:
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
        "callbackStatusCode": response.status_code,
        "callbackBody": response.body,
        "judgeResult": judge_result,
    }


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
        "status": "COMPLETED",
        "completedAt": _format_utc(completed_at),
        "topFindings": _top_findings(judge_result),
        "nudges": _nudges(judge_result),
        "judgeResult": judge_result,
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
        "status": "FAILED",
        "failedAt": _format_utc(failed_at),
        "errorCode": error_code,
        "errorMessage": error_message,
    }


def _top_findings(judge_result: dict[str, Any]) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for issue in judge_result.get("issues") or []:
        if not isinstance(issue, dict):
            continue
        findings.append(
            {
                "category": str(issue.get("criterion_id") or issue.get("category") or "UNKNOWN"),
                "impact": _impact_from_severity(issue.get("severity")),
                "summary": str(issue.get("summary") or ""),
            }
        )
    return findings


def _nudges(judge_result: dict[str, Any]) -> list[dict[str, Any]]:
    nudges: list[dict[str, Any]] = []
    for nudge in judge_result.get("nudges") or []:
        if not isinstance(nudge, dict):
            continue
        nudges.append(
            {
                "title": str(nudge.get("title") or ""),
                "rationale": str(nudge.get("rationale") or ""),
                "difficulty": str(nudge.get("difficulty") or ""),
                "expectedEffect": str(nudge.get("expected_effect") or nudge.get("expectedEffect") or ""),
                "followUpQuestion": str(
                    nudge.get("validation_question") or nudge.get("followUpQuestion") or ""
                ),
            }
        )
    return nudges


def _impact_from_severity(severity: Any) -> str:
    try:
        severity_value = int(severity)
    except (TypeError, ValueError):
        return "UNKNOWN"
    if severity_value >= 3:
        return "HIGH"
    if severity_value == 2:
        return "MEDIUM"
    return "LOW"


def _format_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
