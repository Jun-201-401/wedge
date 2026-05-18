from __future__ import annotations

import json
import unittest

from app.observability.phase_timing import PhaseTimingContext, emit_phase_timing, packet_timing_summary, phase_timer


class PhaseTimingTest(unittest.TestCase):
    def test_emit_phase_timing_outputs_safe_json_context(self) -> None:
        lines: list[str] = []

        emit_phase_timing(
            context=PhaseTimingContext(
                run_id="run-1",
                analysis_job_id="job-1",
                evidence_packet_id="packet-1",
            ),
            phase="fetch_evidence_packet",
            duration_ms=12.7,
            extra={
                "checkpointCount": 3,
                "candidateCount": 9,
                "parallelEnabled": True,
                "maxConcurrency": 2,
                "unexpectedExceptionCount": 0,
            },
            sink=lines.append,
        )

        event = json.loads(lines[0])
        self.assertEqual(event["event"], "analyzer_phase_timing")
        self.assertEqual(event["phase"], "fetch_evidence_packet")
        self.assertEqual(event["durationMs"], 13)
        self.assertEqual(event["status"], "success")
        self.assertEqual(event["runId"], "run-1")
        self.assertEqual(event["analysisJobId"], "job-1")
        self.assertEqual(event["evidencePacketId"], "packet-1")
        self.assertEqual(event["checkpointCount"], 3)
        self.assertEqual(event["candidateCount"], 9)
        self.assertTrue(event["parallelEnabled"])
        self.assertEqual(event["maxConcurrency"], 2)
        self.assertEqual(event["unexpectedExceptionCount"], 0)

    def test_emit_phase_timing_redacts_sensitive_extra_values(self) -> None:
        lines: list[str] = []

        emit_phase_timing(
            context=PhaseTimingContext(run_id="run-1"),
            phase="label_integrity",
            duration_ms=1,
            extra={
                "prompt": "secret prompt",
                "apiKey": "secret key",
                "signedUrl": "https://example.test/private.png?token=secret",
                "rawResponse": "secret response",
                "evidencePacket": {"full": "payload"},
                "checkpointCount": 1,
                "detail": "should be omitted",
            },
            sink=lines.append,
        )

        raw_line = lines[0]
        self.assertNotIn("secret prompt", raw_line)
        self.assertNotIn("secret key", raw_line)
        self.assertNotIn("private.png", raw_line)
        self.assertNotIn("secret response", raw_line)
        self.assertNotIn("payload", raw_line)
        self.assertNotIn("should be omitted", raw_line)
        event = json.loads(raw_line)
        self.assertEqual(event["prompt"], "[REDACTED]")
        self.assertEqual(event["apiKey"], "[REDACTED]")
        self.assertEqual(event["signedUrl"], "[REDACTED]")
        self.assertEqual(event["rawResponse"], "[REDACTED]")
        self.assertEqual(event["evidencePacket"], "[REDACTED]")
        self.assertEqual(event["checkpointCount"], 1)
        self.assertNotIn("detail", event)

    def test_phase_timer_emits_success_duration(self) -> None:
        lines: list[str] = []
        dynamic_extra = {"gmsCallCount": 0}

        with phase_timer(
            context=PhaseTimingContext(run_id="run-1"),
            phase="analysis_core_total",
            extra=lambda: dynamic_extra,
            sink=lines.append,
        ):
            dynamic_extra["gmsCallCount"] = 2
            _ = sum([1, 2, 3])

        event = json.loads(lines[0])
        self.assertEqual(event["phase"], "analysis_core_total")
        self.assertEqual(event["status"], "success")
        self.assertGreaterEqual(event["durationMs"], 0)
        self.assertEqual(event["gmsCallCount"], 2)

    def test_phase_timer_logs_error_and_reraises(self) -> None:
        lines: list[str] = []

        with self.assertRaises(RuntimeError):
            with phase_timer(context=PhaseTimingContext(run_id="run-1"), phase="report_explainer", sink=lines.append):
                raise RuntimeError("boom")

        event = json.loads(lines[0])
        self.assertEqual(event["phase"], "report_explainer")
        self.assertEqual(event["status"], "error")
        self.assertEqual(event["errorType"], "RuntimeError")

    def test_phase_timer_never_lets_telemetry_failure_break_successful_work(self) -> None:
        def failing_sink(_line: str) -> None:
            raise OSError("stdout closed")

        with phase_timer(
            context=PhaseTimingContext(run_id="run-1"),
            phase="analysis_core_total",
            extra=lambda: {"checkpointCount": 1},
            sink=failing_sink,
        ):
            _ = sum([1, 2, 3])

        with phase_timer(
            context=PhaseTimingContext(run_id="run-1"),
            phase="analysis_core_total",
            extra=_raise_extra_error,
        ):
            _ = sum([1, 2, 3])

    def test_phase_timer_preserves_original_exception_when_telemetry_fails(self) -> None:
        def failing_sink(_line: str) -> None:
            raise OSError("stdout closed")

        with self.assertRaisesRegex(ValueError, "business failure"):
            with phase_timer(
                context=PhaseTimingContext(run_id="run-1"),
                phase="analysis_core_total",
                extra=lambda: {"checkpointCount": 1},
                sink=failing_sink,
            ):
                raise ValueError("business failure")

        with self.assertRaisesRegex(ValueError, "business failure"):
            with phase_timer(
                context=PhaseTimingContext(run_id="run-1"),
                phase="analysis_core_total",
                extra=_raise_extra_error,
            ):
                raise ValueError("business failure")

    def test_packet_timing_summary_counts_safe_packet_metadata(self) -> None:
        summary = packet_timing_summary(
            {
                "checkpoints": [
                    {"observations": [{"type": "cta_candidate"}, {"type": "form_field"}]},
                    {"observations": [{"type": "cta_candidate"}]},
                ],
                "artifacts": [{"type": "screenshot"}, {"type": "trace"}],
            }
        )

        self.assertEqual(summary["checkpointCount"], 2)
        self.assertEqual(summary["observationCount"], 3)
        self.assertEqual(summary["artifactCount"], 2)

def _raise_extra_error() -> dict:
    raise RuntimeError("extra failed")


if __name__ == "__main__":
    unittest.main()
