from __future__ import annotations

import json
import sys
import types
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from typing import Any

from app.clients import SpringCallbackError, SpringCallbackResponse
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


def load_choice_overload_packet() -> dict[str, Any]:
    packet = load_sample_packet()
    packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
    packet["checkpoints"][0]["observations"] = [
        observation
        for observation in packet["checkpoints"][0]["observations"]
        if observation["type"] not in {"cta_cluster", "interactive_components"}
    ]
    packet["checkpoints"][0]["observations"].append(
        {
            "observation_id": "obs_shortcut_choices",
            "type": "interactive_components",
            "stage": "CTA",
            "source": ["dom", "layout"],
            "confidence": 0.86,
            "data": {
                "components": [
                    {
                        "text": "검색어를 입력해 주세요.",
                        "selector": "#query",
                        "role": "combobox",
                        "tag": "input",
                        "clickable": True,
                        "visible": True,
                        "bounds": {"x": 330, "y": 92, "width": 480, "height": 58},
                    },
                    {
                        "text": "AD",
                        "selector": "#right-ad-1_tgtLREC",
                        "role": "",
                        "tag": "iframe",
                        "clickable": True,
                        "visible": True,
                        "bounds": {"x": 940, "y": 436, "width": 420, "height": 240},
                    },
                    *[
                        {
                            "text": label,
                            "selector": f"a.shortcut-{index}",
                            "role": "link",
                            "tag": "a",
                            "clickable": True,
                            "visible": True,
                            "bounds": {"x": 320 + (index * 52), "y": 150, "width": 44, "height": 52},
                            "container_role": "list",
                            "container_bounds": {"x": 360, "y": 140, "width": 500, "height": 72},
                            "nearest_target_spacing_px": 4,
                        }
                        for index, label in enumerate(["메일", "카페", "블로그", "쇼핑", "뉴스", "증권", "부동산", "지도", "웹툰"], start=1)
                    ],
                ],
            },
        }
    )
    return packet


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


class StartedFailingCallbackClient(FakeCallbackClient):
    def send_started(
        self,
        *,
        analysis_job_id: str,
        payload: dict[str, Any],
        event_id: str,
    ) -> SpringCallbackResponse:
        self.started.append({"analysisJobId": analysis_job_id, "payload": payload, "eventId": event_id})
        raise SpringCallbackError(404, '{"error":"not found"}')


class FakeEvidenceClient:
    def __init__(self, packet: dict[str, Any]) -> None:
        self.packet = packet
        self.packet_ids: list[str] = []

    def fetch_by_packet_id(self, evidence_packet_id: str) -> dict[str, Any]:
        self.packet_ids.append(evidence_packet_id)
        return self.packet


class FakeMethod:
    delivery_tag = 7


class FakePikaChannel:
    def __init__(self, body: bytes) -> None:
        self.body = body
        self.prefetch_count: int | None = None
        self.queue_name: str | None = None
        self.queue_arguments: dict[str, Any] | None = None
        self.callback: Any = None
        self.acks: list[int] = []
        self.nacks: list[dict[str, Any]] = []

    def basic_qos(self, *, prefetch_count: int) -> None:
        self.prefetch_count = prefetch_count

    def queue_declare(self, *, queue: str, durable: bool, arguments: dict[str, Any]) -> None:
        self.queue_name = queue
        self.queue_arguments = arguments
        self.durable = durable

    def basic_consume(self, *, queue: str, on_message_callback: Any, auto_ack: bool) -> None:
        self.queue_name = queue
        self.callback = on_message_callback
        self.auto_ack = auto_ack

    def start_consuming(self) -> None:
        self.callback(self, FakeMethod(), None, self.body)

    def basic_ack(self, *, delivery_tag: int) -> None:
        self.acks.append(delivery_tag)

    def basic_nack(self, *, delivery_tag: int, requeue: bool) -> None:
        self.nacks.append({"delivery_tag": delivery_tag, "requeue": requeue})


class FakePikaConnection:
    def __init__(self, channel: FakePikaChannel) -> None:
        self._channel = channel

    def channel(self) -> FakePikaChannel:
        return self._channel


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

        stdout = StringIO()
        with redirect_stdout(stdout):
            result = consumer.process_raw_message(raw_message)

        self.assertEqual(result["startedCallbackStatusCode"], 200)
        self.assertIsNone(result["startedCallbackError"])
        self.assertEqual(result["callbackStatusCode"], 200)
        self.assertEqual(evidence_client.packet_ids, ["44444444-4444-4444-4444-444444444444"])
        self.assertEqual(len(callback_client.started), 1)
        self.assertEqual(callback_client.started[0]["eventId"], "analysis.request.22222222-2222-2222-2222-222222222222.started")
        self.assertEqual(callback_client.started[0]["payload"]["analysisJobId"], "22222222-2222-2222-2222-222222222222")
        self.assertEqual(len(callback_client.completed), 1)
        payload = callback_client.completed[0]["payload"]
        self.assertEqual(payload["analysisJobId"], "22222222-2222-2222-2222-222222222222")
        self.assertEqual(payload["runId"], "11111111-1111-1111-1111-111111111111")
        self.assertEqual(
            [issue["criterion_id"] for issue in payload["judgeResult"]["issues"]],
            ["PATH-CTA-002"],
        )
        phases = _phase_names(stdout.getvalue())
        self.assertLess(phases.index("fetch_evidence_packet"), phases.index("started_callback"))
        self.assertLess(phases.index("started_callback"), phases.index("report_explainer"))
        self.assertLess(phases.index("report_explainer"), phases.index("analysis_core_total"))
        self.assertLess(phases.index("analysis_core_total"), phases.index("completed_callback"))
        self.assertLess(phases.index("started_callback"), phases.index("completed_callback"))
        self.assertIn("process_message_total", phases)
        timing_events = _phase_events(stdout.getvalue())
        for event in timing_events:
            self.assertEqual(event["runId"], "11111111-1111-1111-1111-111111111111")
            self.assertEqual(event["analysisJobId"], "22222222-2222-2222-2222-222222222222")
            self.assertEqual(event["evidencePacketId"], "44444444-4444-4444-4444-444444444444")

    def test_process_message_delivers_choice_overload_issue_to_completed_callback(self) -> None:
        packet = load_choice_overload_packet()
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
        payload = callback_client.completed[0]["payload"]
        issues = payload["judgeResult"]["issues"]
        overload = [issue for issue in issues if issue["criterion_id"] == "PATH-CHOICE-OVERLOAD-001"]
        self.assertEqual(len(overload), 1)
        problem_components = overload[0]["problem_components"]
        self.assertEqual(len(problem_components), 1)
        self.assertEqual(problem_components[0]["role"], "group")
        self.assertEqual(
            problem_components[0]["bounding_box"],
            {"x": 360.0, "y": 140.0, "width": 500.0, "height": 72.0, "unit": "css_px"},
        )
        component_key_signal = next(signal for signal in overload[0]["signals"] if signal.startswith("choice_group_component_keys="))
        self.assertIn("a.shortcut-1@", component_key_signal)
        self.assertNotIn("#query", component_key_signal)
        self.assertNotIn("#right-ad-1_tgtLREC", component_key_signal)

    def test_start_consumes_mq_message_sends_completed_callback_and_acks(self) -> None:
        packet = load_choice_overload_packet()
        callback_client = FakeCallbackClient()
        evidence_client = FakeEvidenceClient(packet)
        raw_message = json.dumps(
            {
                "messageType": "analysis.request",
                "payload": {
                    "analysisJobId": "22222222-2222-2222-2222-222222222222",
                    "runId": "11111111-1111-1111-1111-111111111111",
                    "evidencePacketId": "44444444-4444-4444-4444-444444444444",
                },
            }
        ).encode("utf-8")
        fake_channel = FakePikaChannel(raw_message)
        fake_pika = types.SimpleNamespace(
            URLParameters=lambda url: {"url": url},
            BlockingConnection=lambda _params: FakePikaConnection(fake_channel),
        )
        previous_pika = sys.modules.get("pika")
        sys.modules["pika"] = fake_pika  # type: ignore[assignment]
        try:
            consumer = AnalysisRequestConsumer(
                config=_config(),
                callback_client=callback_client,  # type: ignore[arg-type]
                evidence_client=evidence_client,  # type: ignore[arg-type]
            )
            consumer.start()
        finally:
            if previous_pika is None:
                sys.modules.pop("pika", None)
            else:
                sys.modules["pika"] = previous_pika

        self.assertEqual(fake_channel.prefetch_count, 1)
        self.assertEqual(fake_channel.queue_name, "analysis.request")
        self.assertEqual(fake_channel.acks, [7])
        self.assertEqual(fake_channel.nacks, [])
        self.assertEqual(evidence_client.packet_ids, ["44444444-4444-4444-4444-444444444444"])
        self.assertEqual(len(callback_client.started), 1)
        self.assertEqual(len(callback_client.completed), 1)
        issues = callback_client.completed[0]["payload"]["judgeResult"]["issues"]
        self.assertIn("PATH-CHOICE-OVERLOAD-001", [issue["criterion_id"] for issue in issues])

    def test_started_callback_failure_does_not_block_completed_callback(self) -> None:
        packet = load_sample_packet()
        callback_client = StartedFailingCallbackClient()
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

        stdout = StringIO()
        with redirect_stdout(stdout):
            result = consumer.process_raw_message(raw_message)

        self.assertIsNone(result["startedCallbackStatusCode"])
        self.assertIn("HTTP 404", result["startedCallbackError"])
        self.assertEqual(result["callbackStatusCode"], 200)
        self.assertEqual(len(callback_client.started), 1)
        self.assertEqual(len(callback_client.completed), 1)
        self.assertEqual(len(callback_client.failed), 0)
        started_event = next(event for event in _phase_events(stdout.getvalue()) if event["phase"] == "started_callback")
        self.assertEqual(started_event["status"], "error")
        self.assertEqual(started_event["errorType"], "SpringCallbackError")

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


def _phase_events(output: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for line in output.splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("event") == "analyzer_phase_timing":
            events.append(event)
    return events


def _phase_names(output: str) -> list[str]:
    return [str(event["phase"]) for event in _phase_events(output)]
