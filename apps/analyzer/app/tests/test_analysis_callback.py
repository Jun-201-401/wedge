from __future__ import annotations

import json
import threading
import unittest
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from app.clients import SpringCallbackClient
from app.services.analysis_service import build_completed_callback_payload


class AnalysisCallbackPayloadTest(unittest.TestCase):
    def test_completed_payload_matches_spring_required_shape(self) -> None:
        payload = build_completed_callback_payload(
            analysis_job_id="22222222-2222-2222-2222-222222222222",
            run_id="11111111-1111-1111-1111-111111111111",
            judge_result={
                "schema_version": "0.5",
                "run_id": "11111111-1111-1111-1111-111111111111",
                "rule_registry_id": "registry_p0_v0_1",
                "summary": {"friction_score": 60.0},
                "issues": [
                    {
                        "issue_id": "issue_001",
                        "criterion_id": "PATH-CTA-002",
                        "stage": "CTA",
                        "severity": 2,
                        "confidence": 0.81,
                        "priority_score": 2.03,
                        "evidence_refs": ["cp_001.obs_002"],
                        "summary": "CTA competition was detected.",
                        "impact_hypothesis": "Primary action may be harder to choose.",
                    }
                ],
                "decision_map": [],
                "nudges": [
                    {
                        "title": "Reduce competing CTA emphasis",
                        "rationale": "PATH-CTA-002 rule hit.",
                        "difficulty": "MEDIUM",
                        "expected_effect": "Decision friction can decrease.",
                        "validation_question": "Is the primary CTA visually dominant?",
                    }
                ],
            },
            completed_at=datetime(2026, 4, 29, 1, 2, 3, tzinfo=UTC),
        )

        self.assertEqual(payload["analysisJobId"], "22222222-2222-2222-2222-222222222222")
        self.assertEqual(payload["runId"], "11111111-1111-1111-1111-111111111111")
        self.assertEqual(payload["completedAt"], "2026-04-29T01:02:03Z")
        self.assertEqual(payload["topFindings"][0]["category"], "PATH-CTA-002")
        self.assertEqual(payload["topFindings"][0]["impact"], "MEDIUM")
        self.assertEqual(payload["nudges"][0]["followUpQuestion"], "Is the primary CTA visually dominant?")
        self.assertEqual(payload["judgeResult"]["issues"][0]["stage"], "CTA")


class SpringCallbackClientTest(unittest.TestCase):
    def test_send_completed_posts_to_spring_internal_endpoint(self) -> None:
        captured: dict[str, Any] = {}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers["Content-Length"])
                body = self.rfile.read(length)
                captured["path"] = self.path
                captured["headers"] = dict(self.headers)
                captured["body"] = json.loads(body.decode("utf-8"))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"data":{"status":"COMPLETED"}}')

            def log_message(self, format: str, *args: object) -> None:
                return

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = SpringCallbackClient(
                base_url=f"http://127.0.0.1:{server.server_port}",
                worker_id="analyzer_test",
                service_token="local-token",
                signing_secret="local-secret",
            )
            response = client.send_completed(
                analysis_job_id="22222222-2222-2222-2222-222222222222",
                event_id="evt_test_001",
                payload={
                    "analysisJobId": "22222222-2222-2222-2222-222222222222",
                    "runId": "11111111-1111-1111-1111-111111111111",
                },
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            captured["path"],
            "/internal/analysis/jobs/22222222-2222-2222-2222-222222222222/completed",
        )
        self.assertEqual(captured["headers"]["Authorization"], "Bearer local-token")
        self.assertEqual(captured["headers"]["X-Worker-Id"], "analyzer_test")
        self.assertEqual(captured["headers"]["X-Event-Id"], "evt_test_001")
        self.assertTrue(captured["headers"]["X-Signature"].startswith("hmac-sha256="))
        self.assertEqual(captured["body"]["analysisJobId"], "22222222-2222-2222-2222-222222222222")
