from __future__ import annotations

import json
import re
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Callable, Iterator

PhaseTimingSink = Callable[[str], None]
PhaseTimingExtra = dict[str, Any] | Callable[[], dict[str, Any]]

_SENSITIVE_KEY_PATTERN = re.compile(
    r"(api[_-]?key|authorization|callback[_-]?token|secret|token|prompt|raw[_-]?response|"
    r"signed[_-]?url|presigned[_-]?url|public[_-]?url|evidence[_-]?packet|image[_-]?url)",
    re.IGNORECASE,
)
_ALLOWED_EXTRA_VALUE_TYPES = (str, int, float, bool, type(None))
_ALLOWED_EXTRA_KEYS = {
    "messageType",
    "callbackStatusCode",
    "checkpointCount",
    "observationCount",
    "artifactCount",
    "gmsCallCount",
    "candidateCount",
    "stageCount",
    "ruleCount",
    "issueCount",
}


@dataclass(frozen=True)
class PhaseTimingContext:
    run_id: str = ""
    analysis_job_id: str = ""
    evidence_packet_id: str = ""


def emit_phase_timing(
    *,
    context: PhaseTimingContext,
    phase: str,
    duration_ms: float | int,
    status: str = "success",
    error_type: str | None = None,
    extra: dict[str, Any] | None = None,
    sink: PhaseTimingSink | None = None,
) -> None:
    """Emit one safe structured phase timing log line.

    This logger is intentionally stdout-based so the analyzer can expose
    request-scoped timings without adding high-cardinality Prometheus labels.
    Only scalar summary fields are emitted; sensitive payload-shaped values are
    redacted before serialization.
    """

    event: dict[str, Any] = {
        "event": "analyzer_phase_timing",
        "phase": phase,
        "durationMs": max(0, int(round(float(duration_ms)))),
        "status": status,
    }
    if context.run_id:
        event["runId"] = context.run_id
    if context.analysis_job_id:
        event["analysisJobId"] = context.analysis_job_id
    if context.evidence_packet_id:
        event["evidencePacketId"] = context.evidence_packet_id
    if error_type:
        event["errorType"] = error_type

    for key, value in _safe_extra_items(extra).items():
        if key not in event:
            event[key] = value

    line = json.dumps(event, ensure_ascii=False, sort_keys=True)
    if sink is not None:
        sink(line)
        return
    print(line, flush=True)


def safe_emit_phase_timing(
    *,
    context: PhaseTimingContext,
    phase: str,
    duration_ms: float | int,
    status: str = "success",
    error_type: str | None = None,
    extra: PhaseTimingExtra | None = None,
    sink: PhaseTimingSink | None = None,
) -> None:
    """Best-effort telemetry wrapper that never affects analyzer behavior."""

    try:
        emit_phase_timing(
            context=context,
            phase=phase,
            duration_ms=duration_ms,
            status=status,
            error_type=error_type,
            extra=_resolve_extra(extra),
            sink=sink,
        )
    except Exception:
        return


@contextmanager
def phase_timer(
    *,
    context: PhaseTimingContext,
    phase: str,
    extra: PhaseTimingExtra | None = None,
    sink: PhaseTimingSink | None = None,
) -> Iterator[None]:
    started_at = time.perf_counter()
    try:
        yield
    except Exception as exc:
        safe_emit_phase_timing(
            context=context,
            phase=phase,
            duration_ms=(time.perf_counter() - started_at) * 1000,
            status="error",
            error_type=type(exc).__name__,
            extra=extra,
            sink=sink,
        )
        raise
    safe_emit_phase_timing(
        context=context,
        phase=phase,
        duration_ms=(time.perf_counter() - started_at) * 1000,
        status="success",
        extra=extra,
        sink=sink,
    )


def packet_timing_summary(packet: dict[str, Any]) -> dict[str, int]:
    checkpoints = [checkpoint for checkpoint in packet.get("checkpoints") or [] if isinstance(checkpoint, dict)]
    observations = [
        observation
        for checkpoint in checkpoints
        for observation in checkpoint.get("observations") or []
        if isinstance(observation, dict)
    ]
    return {
        "checkpointCount": len(checkpoints),
        "observationCount": len(observations),
        "artifactCount": len([artifact for artifact in packet.get("artifacts") or [] if isinstance(artifact, dict)]),
    }


def _resolve_extra(extra: PhaseTimingExtra | None) -> dict[str, Any] | None:
    if extra is None:
        return None
    if callable(extra):
        return extra()
    return extra


def _safe_extra_items(extra: dict[str, Any] | None) -> dict[str, Any]:
    if not extra:
        return {}

    safe: dict[str, Any] = {}
    for key, value in extra.items():
        normalized_key = str(key)
        if _is_sensitive_key(normalized_key):
            safe[normalized_key] = "[REDACTED]"
            continue
        if normalized_key not in _ALLOWED_EXTRA_KEYS:
            continue
        if isinstance(value, _ALLOWED_EXTRA_VALUE_TYPES):
            safe[normalized_key] = value
    return safe


def _is_sensitive_key(key: str) -> bool:
    return bool(_SENSITIVE_KEY_PATTERN.search(key))
