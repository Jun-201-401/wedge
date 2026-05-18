from __future__ import annotations

import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from typing import Any
from unittest.mock import patch

from app.observability.phase_timing import PhaseTimingContext
from app.services import analysis_service


class FakeReportExplainer:
    def explain(self, judge_result: dict[str, Any], *, telemetry: Any | None = None) -> dict[str, Any]:
        if telemetry is not None:
            telemetry.enabled = True
            telemetry.client_configured = True
            telemetry.compact_prompt_enabled = False
            telemetry.prompt_char_count = 1234
            telemetry.full_prompt_char_count = 4321
            telemetry.response_char_count = 234
            telemetry.attempt_count = 1
            telemetry.fallback_used = False
            telemetry.last_error_type = None
        result = dict(judge_result)
        result["llm_provider"] = "gms"
        return result


class AnalysisServiceReportExplainerTimingTest(unittest.TestCase):
    def test_report_explainer_phase_emits_safe_gms_telemetry(self) -> None:
        judge_result = {
            "summary": {},
            "issues": [{"issue_id": "issue_001"}],
            "nudges": [],
            "decision_map": [],
        }
        output = StringIO()

        with (
            patch.object(analysis_service.GMSSemanticProvider, "from_env", return_value=object()),
            patch.object(analysis_service.GMSLabelIntegrityProvider, "from_env", return_value=object()),
            patch.object(analysis_service.GMSLabelRoleProvider, "from_env", return_value=object()),
            patch.object(analysis_service, "analyze_evidence_packet", return_value=judge_result),
            patch.object(analysis_service.GMSReportExplainer, "from_env", return_value=FakeReportExplainer()),
            redirect_stdout(output),
        ):
            result = analysis_service.analyze_packet(
                {"runId": "run-1", "checkpoints": [], "artifacts": []},
                timing_context=PhaseTimingContext(run_id="run-1", analysis_job_id="job-1"),
            )

        self.assertEqual(result["llm_provider"], "gms")
        events = [json.loads(line) for line in output.getvalue().splitlines() if line.strip()]
        report_event = next(event for event in events if event["phase"] == "report_explainer")
        self.assertEqual(report_event["issueCount"], 1)
        self.assertEqual(report_event["promptCharCount"], 1234)
        self.assertEqual(report_event["fullPromptCharCount"], 4321)
        self.assertEqual(report_event["responseCharCount"], 234)
        self.assertEqual(report_event["attemptCount"], 1)
        self.assertFalse(report_event["fallbackUsed"])
        self.assertFalse(report_event["compactPromptEnabled"])
        self.assertTrue(report_event["gmsEnabled"])
        self.assertTrue(report_event["clientConfigured"])


if __name__ == "__main__":
    unittest.main()
