from __future__ import annotations

import os
import time
from typing import Any, Literal

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest, start_http_server

AiRequestStatus = Literal["success", "error"]
AiRequestErrorType = Literal[
    "none",
    "disabled",
    "missing_api_key",
    "timeout",
    "http_error",
    "invalid_json",
    "network_error",
    "unknown",
]

AI_REQUESTS_TOTAL = Counter(
    "wedge_ai_gms_requests_total",
    "Total number of Wedge AI GMS requests by service, feature, model, status, and error type.",
    ["service", "feature", "model", "status", "error_type"],
)

AI_REQUEST_DURATION_SECONDS = Histogram(
    "wedge_ai_gms_request_duration_seconds",
    "Duration of Wedge AI GMS requests in seconds by service, feature, model, status, and error type.",
    ["service", "feature", "model", "status", "error_type"],
    buckets=(0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30),
)


def include_metrics_route(app: Any) -> None:
    if not _env_bool("ANALYZER_METRICS_ENABLED", default=False):
        return

    from fastapi import Response

    @app.get("/metrics", include_in_schema=False)
    def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


def start_metrics_server_from_env() -> None:
    if not _env_bool("ANALYZER_METRICS_ENABLED", default=False):
        return
    host = os.environ.get("ANALYZER_METRICS_HOST", "0.0.0.0")
    port = _env_int("ANALYZER_METRICS_PORT", default=9102)
    start_http_server(port=port, addr=host)
    print(f"analyzer metrics server started: host={host} port={port}", flush=True)


def observe_gms_request(
    *,
    feature: str,
    model: str,
    status: AiRequestStatus,
    error_type: AiRequestErrorType,
    started_at: float,
) -> None:
    labels = {
        "service": "analyzer",
        "feature": _label_value(feature, "unknown"),
        "model": _label_value(model, "unknown"),
        "status": status,
        "error_type": error_type,
    }
    AI_REQUESTS_TOTAL.labels(**labels).inc()
    AI_REQUEST_DURATION_SECONDS.labels(**labels).observe(max(0.0, time.perf_counter() - started_at))


def _label_value(value: str, fallback: str) -> str:
    stripped = value.strip()
    return stripped if stripped else fallback


def _env_bool(name: str, *, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, *, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default
