from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Protocol

from app.clients import EvidencePacketClient, SpringCallbackClient
from app.observability.phase_timing import PhaseTimingContext, phase_timer
from app.services.analysis_service import analyze_packet_and_callback, build_failed_callback_payload


class AnalysisRequestValidationError(ValueError):
    pass


@dataclass(frozen=True)
class AnalysisRequest:
    analysis_job_id: str
    run_id: str
    evidence_packet_id: str
    event_id: str


@dataclass(frozen=True)
class AnalysisConsumerConfig:
    mq_url: str
    queue_name: str
    callback_base_url: str
    callback_auth_token: str
    callback_signature_secret: str
    evidence_base_url: str
    evidence_auth_token: str
    worker_id: str = "analyzer_worker"
    prefetch: int = 1
    requeue_on_failure: bool = False
    queue_dead_letter_exchange: str | None = "wedge.dlq"
    queue_dead_letter_routing_key: str | None = "analysis.dlq"
    queue_type: str | None = "classic"

    @classmethod
    def from_env(cls) -> "AnalysisConsumerConfig":
        return cls(
            mq_url=os.environ.get("ANALYZER_MQ_URL") or os.environ.get("RUNNER_MQ_URL") or "amqp://localhost",
            queue_name=os.environ.get("ANALYZER_MQ_QUEUE_ANALYSIS_REQUEST", "analysis.request"),
            callback_base_url=os.environ.get("ANALYZER_CALLBACK_BASE_URL", "http://127.0.0.1:8080"),
            callback_auth_token=os.environ.get("ANALYZER_CALLBACK_AUTH_TOKEN", ""),
            callback_signature_secret=os.environ.get("ANALYZER_CALLBACK_SIGNATURE_SECRET", "local-secret"),
            evidence_base_url=os.environ.get("ANALYZER_EVIDENCE_BASE_URL")
            or os.environ.get("ANALYZER_CALLBACK_BASE_URL", "http://127.0.0.1:8080"),
            evidence_auth_token=os.environ.get("ANALYZER_EVIDENCE_AUTH_TOKEN")
            or os.environ.get("ANALYZER_CALLBACK_AUTH_TOKEN", ""),
            worker_id=os.environ.get("ANALYZER_WORKER_ID", "analyzer_worker"),
            prefetch=int(os.environ.get("ANALYZER_MQ_PREFETCH", "1")),
            requeue_on_failure=os.environ.get("ANALYZER_MQ_REQUEUE_ON_FAILURE", "false").lower() == "true",
            queue_dead_letter_exchange=_optional_env(
                "ANALYZER_MQ_QUEUE_DEAD_LETTER_EXCHANGE",
                "wedge.dlq",
            ),
            queue_dead_letter_routing_key=_optional_env(
                "ANALYZER_MQ_QUEUE_DEAD_LETTER_ROUTING_KEY",
                "analysis.dlq",
            ),
            queue_type=_optional_env("ANALYZER_MQ_QUEUE_TYPE", "classic"),
        )

    def queue_arguments(self) -> dict[str, str]:
        arguments: dict[str, str] = {}
        if self.queue_dead_letter_exchange:
            arguments["x-dead-letter-exchange"] = self.queue_dead_letter_exchange
        if self.queue_dead_letter_routing_key:
            arguments["x-dead-letter-routing-key"] = self.queue_dead_letter_routing_key
        if self.queue_type:
            arguments["x-queue-type"] = self.queue_type
        return arguments


class AckableMessage(Protocol):
    @property
    def body(self) -> bytes:
        ...


class AnalysisRequestConsumer:
    def __init__(
        self,
        *,
        config: AnalysisConsumerConfig,
        callback_client: SpringCallbackClient | None = None,
        evidence_client: EvidencePacketClient | None = None,
    ) -> None:
        self._config = config
        self._callback_client = callback_client or SpringCallbackClient(
            base_url=config.callback_base_url,
            worker_id=config.worker_id,
            service_token=config.callback_auth_token,
            signing_secret=config.callback_signature_secret,
        )
        self._evidence_client = evidence_client or EvidencePacketClient(
            base_url=config.evidence_base_url,
            auth_token=config.evidence_auth_token,
        )

    def process_raw_message(self, raw_message: str) -> dict[str, Any]:
        request = parse_analysis_request_message(raw_message)
        timing_context = PhaseTimingContext(
            run_id=request.run_id,
            analysis_job_id=request.analysis_job_id,
            evidence_packet_id=request.evidence_packet_id,
        )
        try:
            with phase_timer(
                context=timing_context,
                phase="process_message_total",
                extra={"messageType": "analysis.request"},
            ):
                with phase_timer(context=timing_context, phase="fetch_evidence_packet"):
                    evidence_packet = self._fetch_evidence_packet(request)
                return analyze_packet_and_callback(
                    analysis_job_id=request.analysis_job_id,
                    run_id=request.run_id,
                    evidence_packet=evidence_packet,
                    callback_client=self._callback_client,
                    event_id=request.event_id,
                    timing_context=timing_context,
                )
        except Exception as exc:
            failed_payload = build_failed_callback_payload(
                analysis_job_id=request.analysis_job_id,
                run_id=request.run_id,
                error_code="ANALYSIS_FAILED",
                error_message=str(exc),
            )
            self._callback_client.send_failed(
                analysis_job_id=request.analysis_job_id,
                payload=failed_payload,
                event_id=f"{request.event_id}.failed",
            )
            raise

    def _fetch_evidence_packet(self, request: AnalysisRequest) -> dict[str, Any]:
        packet = self._evidence_client.fetch_by_packet_id(request.evidence_packet_id)
        return normalize_evidence_packet(packet, run_id=request.run_id)

    def start(self) -> None:
        import pika

        parameters = pika.URLParameters(self._config.mq_url)
        connection = pika.BlockingConnection(parameters)
        channel = connection.channel()
        channel.basic_qos(prefetch_count=self._config.prefetch)
        channel.queue_declare(
            queue=self._config.queue_name,
            durable=True,
            arguments=self._config.queue_arguments(),
        )

        def on_message(channel: Any, method: Any, _properties: Any, body: bytes) -> None:
            try:
                self.process_raw_message(body.decode("utf-8"))
            except AnalysisRequestValidationError:
                channel.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                return
            except Exception:
                channel.basic_nack(delivery_tag=method.delivery_tag, requeue=self._config.requeue_on_failure)
                return
            channel.basic_ack(delivery_tag=method.delivery_tag)

        channel.basic_consume(queue=self._config.queue_name, on_message_callback=on_message, auto_ack=False)
        print(f"analysis request consumer started: queue={self._config.queue_name}", flush=True)
        channel.start_consuming()


def parse_analysis_request_message(raw_message: str) -> AnalysisRequest:
    try:
        message = json.loads(raw_message)
    except json.JSONDecodeError as exc:
        raise AnalysisRequestValidationError("analysis.request message must be valid JSON.") from exc
    if not isinstance(message, dict):
        raise AnalysisRequestValidationError("analysis.request message must be a JSON object.")

    if "messageType" in message and message.get("messageType") != "analysis.request":
        raise AnalysisRequestValidationError("messageType must be analysis.request.")

    payload = message.get("payload") if isinstance(message.get("payload"), dict) else message
    if not isinstance(payload, dict):
        raise AnalysisRequestValidationError("analysis.request payload must be an object.")

    analysis_job_id = _required_string(payload, "analysisJobId", "analysis_job_id")
    run_id = _required_string(payload, "runId", "run_id")
    evidence_packet_id = _required_string(payload, "evidencePacketId", "evidence_packet_id")

    event_id = (
        _optional_string(message, "idempotencyKey", "messageId")
        or _optional_string(payload, "eventId", "event_id")
        or f"analysis.request.{analysis_job_id}"
    )
    return AnalysisRequest(
        analysis_job_id=analysis_job_id,
        run_id=run_id,
        evidence_packet_id=evidence_packet_id,
        event_id=event_id,
    )


def normalize_evidence_packet(evidence_packet: dict[str, Any], *, run_id: str) -> dict[str, Any]:
    packet = dict(evidence_packet)
    packet.setdefault("schema_version", "0.5")
    packet.setdefault("run_id", run_id)
    packet.setdefault("scenario", {})
    packet.setdefault("checkpoints", [])
    packet.setdefault("aggregate_signals", {})
    packet.setdefault("scenario_fit", None)
    packet.setdefault("artifacts", [])

    normalized_checkpoints: list[dict[str, Any]] = []
    for checkpoint_index, checkpoint in enumerate(packet.get("checkpoints") or [], start=1):
        if not isinstance(checkpoint, dict):
            continue
        normalized_checkpoint = dict(checkpoint)
        normalized_checkpoint.setdefault("checkpoint_id", f"cp_{checkpoint_index:03d}")
        normalized_checkpoint["observations"] = _normalize_observations(normalized_checkpoint.get("observations"))
        normalized_checkpoints.append(normalized_checkpoint)
    packet["checkpoints"] = normalized_checkpoints
    return packet


def _normalize_observations(observations: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for observation_index, observation in enumerate(observations or [], start=1):
        if not isinstance(observation, dict):
            continue
        normalized_observation = dict(observation)
        observation_id = str(normalized_observation.get("observation_id") or f"obs_{observation_index:03d}")
        normalized_observation["observation_id"] = observation_id.rsplit(".", 1)[-1]
        normalized.append(normalized_observation)
    return normalized


def _required_string(payload: dict[str, Any], *keys: str) -> str:
    value = _optional_string(payload, *keys)
    if not value:
        raise AnalysisRequestValidationError(f"analysis.request requires one of: {', '.join(keys)}.")
    return value


def _optional_string(payload: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _optional_env(name: str, default: str) -> str | None:
    value = os.environ.get(name)
    if value is None:
        return default
    value = value.strip()
    return value or None
