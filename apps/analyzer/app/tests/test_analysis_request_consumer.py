from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any

from app.clients import SpringCallbackResponse
from app.workers import (
    AnalysisConsumerConfig,
    AnalysisRequestConsumer,
    AnalysisRequestValidationError,
    parse_analysis_request_message,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
SAMPLE_EVIDENCE_PATH = REPO_ROOT / "packages/contracts/examples/sample-evidence-packet.json"


def load_sample_packet() -> dict[str, Any]:
    return json.loads(SAMPLE_EVIDENCE_PATH.read_text(encoding="utf-8"))


class FakeCallbackClient:
    def __init__(self) -> None:
        self.started: list[dict[str, Any]] = []
        self.completed: list[dict[str, Any]] = []
        self.failed: list[dict[str, Any]] = []

    def send_started(
        self,
        *,
        analysis_job_id: str,
        payload: dict[str, Any],
        event_id: str,
    ) -> SpringCallbackResponse:
        self.started.append({"analysisJobId": analysis_job_id, "payload": payload, "eventId": event_id})
        return SpringCallbackResponse(status_code=200, body={"data": {"status": "RUNNING"}})

    def send_completed(
        self,
        *,
        analysis_job_id: str,
        payload: dict[str, Any],
        event_id: str,
    ) -> SpringCallbackResponse:
        self.completed.append({"analysisJobId": analysis_job_id, "payload": payload, "eventId": event_id})
        return SpringCallbackResponse(status_code=200, body={"data": {"status": "COMPLETED"}})

    def send_failed(
        self,
        *,
        analysis_job_id: str,
        payload: dict[str, Any],
        event_id: str,
    ) -> SpringCallbackResponse:
        self.failed.append({"analysisJobId": analysis_job_id, "payload": payload, "eventId": event_id})
        return SpringCallbackResponse(status_code=200, body={"data": {"status": "FAILED"}})


class FakeEvidenceClient:
    def __init__(self, packet: dict[str, Any]) -> None:
        self.packet = packet
        self.packet_ids: list[str] = []

    def fetch_by_packet_id(self, evidence_packet_id: str) -> dict[str, Any]:
        self.packet_ids.append(evidence_packet_id)
        return self.packet


class AnalysisRequestConsumerTest(unittest.TestCase):
    def test_default_queue_arguments_match_dev_topology(self) -> None:
        config = _config()

        self.assertEqual(
            config.queue_arguments(),
            {
                "x-dead-letter-exchange": "wedge.dlq",
                "x-dead-letter-routing-key": "analysis.dlq",
                "x-queue-type": "classic",
            },
        )

    def test_parse_evidence_packet_id_request(self) -> None:
        raw_message = json.dumps(
            {
                "messageId": "33333333-3333-3333-3333-333333333333",
                "messageType": "analysis.request",
                "schemaVersion": "0.5",
                "createdAt": "2026-04-29T00:00:00Z",
                "producer": "spring-api",
                "payload": {
                    "analysisJobId": "22222222-2222-2222-2222-222222222222",
                    "runId": "11111111-1111-1111-1111-111111111111",
                    "analysisType": "PRIMARY",
                    "forceRebuildEvidenceBundle": False,
                    "evidencePacketId": "44444444-4444-4444-4444-444444444444",
                },
            }
        )

        request = parse_analysis_request_message(raw_message)

        self.assertEqual(request.analysis_job_id, "22222222-2222-2222-2222-222222222222")
        self.assertEqual(request.run_id, "11111111-1111-1111-1111-111111111111")
        self.assertEqual(request.evidence_packet_id, "44444444-4444-4444-4444-444444444444")
        self.assertEqual(request.event_id, "33333333-3333-3333-3333-333333333333")

    def test_process_message_fetches_snapshot_packet_and_sends_completed_callback(self) -> None:
        packet = load_sample_packet()
        callback_client = FakeCallbackClient()
        evidence_client = FakeEvidenceClient(packet)
        consumer = AnalysisRequestConsumer(
            config=_config(),
            callback_client=callback_client,  # type: ignore[arg-type]
            evidence_client=evidence_client,  # type: ignore[arg-type]
        )
        raw_message = json.dumps(
            {
                "messageType": "analysis.request",
                "payload": {
                    "analysisJobId": "22222222-2222-2222-2222-222222222222",
                    "runId": "11111111-1111-1111-1111-111111111111",
                    "evidencePacketId": "44444444-4444-4444-4444-444444444444",
                },
            }
        )

        result = consumer.process_raw_message(raw_message)

        self.assertEqual(result["startedCallbackStatusCode"], 200)
        self.assertEqual(result["callbackStatusCode"], 200)
        self.assertEqual(evidence_client.packet_ids, ["44444444-4444-4444-4444-444444444444"])
        self.assertEqual(len(callback_client.started), 1)
        self.assertEqual(callback_client.started[0]["eventId"], "analysis.request.22222222-2222-2222-2222-222222222222.started")
        self.assertEqual(callback_client.started[0]["payload"]["analysisJobId"], "22222222-2222-2222-2222-222222222222")
        self.assertEqual(len(callback_client.completed), 1)
        payload = callback_client.completed[0]["payload"]
        self.assertEqual(payload["analysisJobId"], "22222222-2222-2222-2222-222222222222")
        self.assertEqual(payload["runId"], "11111111-1111-1111-1111-111111111111")
        self.assertEqual([issue["criterion_id"] for issue in payload["judgeResult"]["issues"]], ["PATH-CTA-002"])

    def test_inline_evidence_packet_without_id_is_rejected(self) -> None:
        raw_message = json.dumps(
            {
                "messageType": "analysis.request",
                "payload": {
                    "analysisJobId": "22222222-2222-2222-2222-222222222222",
                    "runId": "11111111-1111-1111-1111-111111111111",
                    "evidencePacket": load_sample_packet(),
                },
            }
        )

        with self.assertRaisesRegex(AnalysisRequestValidationError, "evidencePacketId"):
            parse_analysis_request_message(raw_message)


def _config():
    return AnalysisConsumerConfig(
        mq_url="amqp://localhost",
        queue_name="analysis.request",
        callback_base_url="http://127.0.0.1:18080",
        callback_auth_token="local-token",
        callback_signature_secret="local-secret",
        evidence_base_url="http://127.0.0.1:8080",
        evidence_auth_token="local-token",
    )
