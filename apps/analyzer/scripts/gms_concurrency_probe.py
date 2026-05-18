#!/usr/bin/env python3
"""Probe GMS concurrent image/text request behavior with bounded smoke loads.

This script is intentionally a developer-only tool. It prints durations and
error classes, but it never prints API keys, prompts, or signed image URLs.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import statistics
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

from app.clients.evidence_packet import EvidencePacketClient, EvidencePacketFetchError
from app.providers.gms import GMSClient, GMSClientError, GMSConfig, load_analyzer_dotenv


IMAGE_PROMPT = (
    'Return only compact JSON: {"ok": true, "visible": "short description"}. '
    'This is a concurrency smoke test; do not analyze UX quality.'
)
TEXT_PROMPT = (
    'Return only compact JSON: {"ok": true, "kind": "text"}. '
    'This is a concurrency smoke test.'
)


@dataclass(frozen=True)
class ProbeJobResult:
    index: int
    kind: str
    status: str
    duration_seconds: float
    error_type: str | None = None
    output_chars: int = 0


@dataclass(frozen=True)
class ProbeSummary:
    image_count: int
    text_count: int
    total_count: int
    success_count: int
    error_count: int
    elapsed_seconds: float
    average_seconds: float | None
    max_seconds: float | None
    p95_seconds: float | None
    results: list[ProbeJobResult]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run bounded concurrent GMS image/text smoke requests.",
    )
    parser.add_argument("--run-id", help="Run ID to fetch the first screenshot signed URL from the evidence packet.")
    parser.add_argument("--evidence-packet-id", help="Evidence packet ID to fetch the first screenshot signed URL from.")
    parser.add_argument("--image-url", help="Explicit screenshot URL. Not printed by this script.")
    parser.add_argument("--image-count", type=int, default=0, help="Number of concurrent image requests.")
    parser.add_argument("--postgres-container", default=os.environ.get("POSTGRES_CONTAINER", "wedge-postgres-dev"), help="Docker Postgres container for --run-id fallback.")
    parser.add_argument("--postgres-user", default=os.environ.get("POSTGRES_USER", "ssafy"), help="Postgres user for --run-id fallback.")
    parser.add_argument("--postgres-db", default=os.environ.get("POSTGRES_DB", "wedge_dev"), help="Postgres database for --run-id fallback.")
    parser.add_argument("--skip-postgres-fallback", action="store_true", help="Do not resolve run IDs through local docker Postgres if API fetch fails.")
    parser.add_argument("--text-count", type=int, default=0, help="Number of concurrent text requests.")
    parser.add_argument("--timeout", type=float, default=None, help="Override GMS request timeout seconds.")
    parser.add_argument(
        "--evidence-base-url",
        default=os.environ.get("ANALYZER_EVIDENCE_BASE_URL") or os.environ.get("ANALYZER_CALLBACK_BASE_URL") or "http://127.0.0.1:8080",
        help="API base URL for evidence packet fetches.",
    )
    parser.add_argument(
        "--evidence-auth-token-env",
        default="ANALYZER_EVIDENCE_AUTH_TOKEN,ANALYZER_CALLBACK_AUTH_TOKEN,INTERNAL_SERVICE_TOKEN",
        help="Comma-separated env var names to resolve the evidence auth token.",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()
    if args.image_count < 0 or args.text_count < 0:
        parser.error("--image-count and --text-count must be >= 0")
    if args.image_count == 0 and args.text_count == 0:
        parser.error("at least one of --image-count or --text-count must be > 0")
    if args.image_count > 0 and not (args.image_url or args.run_id or args.evidence_packet_id):
        parser.error("image requests require --image-url, --run-id, or --evidence-packet-id")
    return args


def main() -> int:
    _load_probe_dotenvs()
    args = parse_args()
    image_url = args.image_url or (_resolve_image_url(args) if args.image_count > 0 else None)
    summary = run_probe(
        image_url=image_url,
        image_count=args.image_count,
        text_count=args.text_count,
        timeout_seconds=args.timeout,
    )
    if args.json:
        print(json.dumps(_summary_to_json(summary), ensure_ascii=False, indent=2))
    else:
        _print_summary(summary)
    return 0 if summary.error_count == 0 else 1


def _load_probe_dotenvs() -> None:
    # Analyzer code loads apps/analyzer/.env by default. Local compose keeps the
    # GMS and internal-service settings in the repository root .env, so load both
    # without overriding values already exported by the caller.
    load_analyzer_dotenv()
    repo_dotenv = Path(__file__).resolve().parents[3] / ".env"
    load_analyzer_dotenv(repo_dotenv)


def run_probe(
    *,
    image_url: str | None,
    image_count: int,
    text_count: int,
    timeout_seconds: float | None,
) -> ProbeSummary:
    config = GMSConfig.from_env()
    if timeout_seconds is not None:
        config = GMSConfig(
            enabled=config.enabled,
            api_key=config.api_key,
            base_url=config.base_url,
            openai_responses_path=config.openai_responses_path,
            model=config.model,
            timeout_seconds=timeout_seconds,
        )
    jobs = [("image", index) for index in range(1, image_count + 1)] + [
        ("text", index) for index in range(1, text_count + 1)
    ]
    start_at = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs)) as executor:
        futures = [
            executor.submit(_run_single_job, kind=kind, index=index, image_url=image_url, config=config)
            for kind, index in jobs
        ]
        results = [future.result() for future in concurrent.futures.as_completed(futures)]
    elapsed = time.perf_counter() - start_at
    results.sort(key=lambda item: (item.kind, item.index))
    durations = [result.duration_seconds for result in results]
    return ProbeSummary(
        image_count=image_count,
        text_count=text_count,
        total_count=len(results),
        success_count=sum(1 for result in results if result.status == "success"),
        error_count=sum(1 for result in results if result.status != "success"),
        elapsed_seconds=elapsed,
        average_seconds=statistics.fmean(durations) if durations else None,
        max_seconds=max(durations) if durations else None,
        p95_seconds=_percentile(durations, 95),
        results=results,
    )


def _run_single_job(*, kind: str, index: int, image_url: str | None, config: GMSConfig) -> ProbeJobResult:
    started_at = time.perf_counter()
    try:
        client = GMSClient(config, feature=f"concurrency_probe_{kind}")
        if kind == "image":
            if not image_url:
                raise ValueError("image_url is required for image probe jobs")
            output = client.generate_with_image(prompt=IMAGE_PROMPT, image_url=image_url)
        else:
            output = client.generate_text(prompt=TEXT_PROMPT)
        return ProbeJobResult(
            index=index,
            kind=kind,
            status="success",
            duration_seconds=time.perf_counter() - started_at,
            output_chars=len(output),
        )
    except Exception as exc:  # noqa: BLE001 - this is a smoke diagnostic boundary.
        return ProbeJobResult(
            index=index,
            kind=kind,
            status="error",
            duration_seconds=time.perf_counter() - started_at,
            error_type=_error_type(exc),
        )


def _resolve_image_url(args: argparse.Namespace) -> str:
    token = _first_env_value(args.evidence_auth_token_env.split(","))
    client = EvidencePacketClient(base_url=args.evidence_base_url, auth_token=token, timeout_seconds=10.0)
    if args.evidence_packet_id:
        packet = client.fetch_by_packet_id(args.evidence_packet_id)
    elif args.run_id:
        try:
            packet = client.fetch_by_run_id(args.run_id)
        except EvidencePacketFetchError:
            if args.skip_postgres_fallback:
                raise
            evidence_packet_id = _resolve_evidence_packet_id_from_postgres(args)
            packet = client.fetch_by_packet_id(evidence_packet_id)
    else:
        raise ValueError("run_id or evidence_packet_id is required")
    image_url = _first_screenshot_url(packet)
    if not image_url:
        raise ValueError("No screenshot signed URL found in evidence packet")
    return image_url


def _resolve_evidence_packet_id_from_postgres(args: argparse.Namespace) -> str:
    if not _looks_like_uuid(args.run_id):
        raise ValueError("--run-id must be a UUID for local Postgres fallback")
    sql = (
        "select id from evidence_packet "
        f"where run_id='{args.run_id}' "
        "order by created_at desc limit 1"
    )
    command = [
        "docker",
        "exec",
        args.postgres_container,
        "psql",
        "-U",
        args.postgres_user,
        "-d",
        args.postgres_db,
        "-Atc",
        sql,
    ]
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError("Failed to resolve evidence_packet_id from local Postgres")
    evidence_packet_id = completed.stdout.strip().splitlines()[0] if completed.stdout.strip() else ""
    if not _looks_like_uuid(evidence_packet_id):
        raise RuntimeError("No evidence_packet_id found for run_id")
    return evidence_packet_id


def _looks_like_uuid(value: Any) -> bool:
    return isinstance(value, str) and bool(
        re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", value)
    )


def _first_screenshot_url(packet: dict[str, Any]) -> str | None:
    for artifact in packet.get("artifacts") or []:
        if not isinstance(artifact, dict):
            continue
        raw_type = str(artifact.get("type") or artifact.get("artifact_type") or "").lower()
        if raw_type not in {"screenshot", "frame"}:
            continue
        for key in ("signed_url", "signedUrl", "presigned_url", "presignedUrl", "url", "public_url", "publicUrl"):
            value = artifact.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _first_env_value(names: Iterable[str]) -> str:
    for name in names:
        value = os.environ.get(name.strip())
        if value:
            return value
    return ""


def _percentile(values: list[float], percentile: int) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((percentile / 100) * (len(ordered) - 1))))
    return ordered[index]


def _error_type(exc: Exception) -> str:
    if isinstance(exc, GMSClientError):
        message = str(exc)
        if "HTTP 429" in message:
            return "http_429"
        if "HTTP 5" in message:
            return "http_5xx"
        if "timed out" in message.lower():
            return "timeout"
        if "GMS request failed" in message:
            return "network_error"
        return "gms_error"
    return type(exc).__name__


def _summary_to_json(summary: ProbeSummary) -> dict[str, Any]:
    payload = asdict(summary)
    payload["results"] = [asdict(result) for result in summary.results]
    return payload


def _print_summary(summary: ProbeSummary) -> None:
    print(
        "GMS concurrency probe: "
        f"image={summary.image_count} text={summary.text_count} "
        f"success={summary.success_count}/{summary.total_count} errors={summary.error_count} "
        f"elapsed={summary.elapsed_seconds:.3f}s"
    )
    if summary.average_seconds is not None:
        print(
            "durations: "
            f"avg={summary.average_seconds:.3f}s "
            f"max={summary.max_seconds:.3f}s "
            f"p95={summary.p95_seconds:.3f}s"
        )
    for result in summary.results:
        suffix = f" outputChars={result.output_chars}" if result.status == "success" else f" errorType={result.error_type}"
        print(f"- {result.kind}#{result.index}: {result.status} {result.duration_seconds:.3f}s{suffix}")


if __name__ == "__main__":
    raise SystemExit(main())
