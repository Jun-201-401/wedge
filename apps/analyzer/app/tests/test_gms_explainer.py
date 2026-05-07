from __future__ import annotations

import copy
import json
import unittest
from typing import Any

from app.providers.gms import extract_openai_response_text, extract_openai_response_text_from_body
from app.services.analysis_service import build_completed_callback_payload
from app.services.llm_analysis import GMSReportExplainer


class FakeGMSClient:
    def __init__(self, response_text: str | Exception) -> None:
        self.response_text = response_text
        self.prompts: list[str] = []

    def generate_text(self, *, prompt: str) -> str:
        self.prompts.append(prompt)
        if isinstance(self.response_text, Exception):
            raise self.response_text
        return self.response_text


def sample_judge_result() -> dict[str, Any]:
    return {
        "schema_version": "0.5",
        "run_id": "run_001",
        "rule_registry_id": "registry_p0_v0_1",
        "summary": {
            "overall_risk": "medium",
            "friction_score": 41.0,
            "top_issues_count": 1,
            "task_success": "partial",
        },
        "stage_scores": [],
        "issues": [
            {
                "issue_id": "issue_001",
                "criterion_id": "PATH-CTA-002",
                "stage": "CTA",
                "axis": "Path",
                "severity": 2,
                "confidence": 0.81,
                "priority_score": 2.03,
                "evidence_refs": ["cp_001.obs_002"],
                "evidence_locations": [
                    {
                        "evidence_ref": "cp_001.obs_002",
                        "type": "interactive_components",
                        "components": [
                            {
                                "selector": "a.hero-start",
                                "bounds": {"x": 520, "y": 360, "width": 220, "height": 56},
                            }
                        ],
                    }
                ],
                "summary": "CTA competition was detected.",
                "impact_hypothesis": "Primary action may be harder to choose.",
                "recommendations": ["Reduce CTA competition."],
                "validation_questions": ["Is one CTA visually dominant?"],
            }
        ],
        "decision_map": [],
        "nudges": [
            {
                "nudge_id": "nudge_001",
                "issue_id": "issue_001",
                "title": "CTA competition was detected.",
                "rationale": "PATH-CTA-002 rule hit.",
                "recommendation": "Reduce CTA competition.",
                "difficulty": "MEDIUM",
                "expected_effect": "Decision friction can decrease.",
                "validation_question": "Is one CTA visually dominant?",
            }
        ],
        "llm_notes": [
            "Rule Engine generated deterministic stage/severity/confidence/priority values.",
        ],
    }


class GMSReportExplainerTest(unittest.TestCase):
    def test_gms_polishes_explanation_fields_only(self) -> None:
        original = sample_judge_result()
        response = {
            "overall_summary": "Users may hesitate because several CTAs look equally important.",
            "issue_explanations": [
                {
                    "issue_id": "issue_001",
                    "stage": "COMMIT",
                    "severity": 3,
                    "confidence": 0.1,
                    "evidence_refs": ["unsafe.ref"],
                    "title": "Competing primary CTAs",
                    "summary": "Several primary CTAs compete in the same decision area.",
                    "impact_hypothesis": "The user may delay the first conversion action.",
                    "recommendations": ["Pick one primary CTA and demote the others."],
                    "validation_questions": ["Can a user identify the main CTA within three seconds?"],
                    "nudge": {
                        "title": "Make one CTA primary",
                        "rationale": "The issue evidence shows multiple primary-looking CTA components.",
                        "recommendation": "Keep one CTA visually primary and demote the others.",
                        "difficulty": "LOW",
                        "expected_effect": "Users can choose the first action faster.",
                        "validation_question": "Is only one CTA visually dominant after the change?",
                    },
                }
            ],
        }

        result = GMSReportExplainer(
            client=FakeGMSClient(json.dumps(response)),
            enabled=True,
            model="gpt-4.1-nano",
        ).explain(original)

        issue = result["issues"][0]
        self.assertEqual(issue["title"], "Competing primary CTAs")
        self.assertEqual(issue["summary"], "Several primary CTAs compete in the same decision area.")
        self.assertEqual(issue["recommendations"], ["Pick one primary CTA and demote the others."])
        self.assertEqual(issue["stage"], "CTA")
        self.assertEqual(issue["severity"], 2)
        self.assertEqual(issue["confidence"], 0.81)
        self.assertEqual(issue["evidence_refs"], ["cp_001.obs_002"])
        self.assertEqual(issue["evidence_locations"][0]["components"][0]["bounds"], {"x": 520, "y": 360, "width": 220, "height": 56})
        self.assertEqual(result["summary"]["llm_overall_summary"], response["overall_summary"])
        self.assertEqual(result["nudges"][0]["title"], "Make one CTA primary")
        self.assertEqual(result["nudges"][0]["rationale"], "The issue evidence shows multiple primary-looking CTA components.")
        self.assertEqual(result["nudges"][0]["recommendation"], "Keep one CTA visually primary and demote the others.")
        self.assertEqual(result["nudges"][0]["difficulty"], "LOW")
        self.assertEqual(result["nudges"][0]["expected_effect"], "Users can choose the first action faster.")
        self.assertEqual(result["nudges"][0]["validation_question"], "Is only one CTA visually dominant after the change?")
        self.assertEqual(result["llm_provider"], "gms")
        self.assertEqual(result["llm_model"], "gpt-4.1-nano")

    def test_disabled_explainer_returns_deterministic_result(self) -> None:
        original = sample_judge_result()
        result = GMSReportExplainer(
            client=FakeGMSClient("{}"),
            enabled=False,
        ).explain(original)

        self.assertEqual(result, original)
        self.assertIsNot(result, original)

    def test_invalid_gms_response_falls_back_to_rule_engine_text(self) -> None:
        original = sample_judge_result()
        result = GMSReportExplainer(
            client=FakeGMSClient("not-json"),
            enabled=True,
        ).explain(original)

        self.assertEqual(result["issues"], original["issues"])
        self.assertIn("GMS explanation fallback used deterministic text", result["llm_notes"][-1])

    def test_callback_model_info_reflects_gms_model_when_used(self) -> None:
        result = sample_judge_result()
        result["llm_provider"] = "gms"
        result["llm_model"] = "gpt-4.1-nano"
        result["issues"][0]["title"] = "Competing primary CTAs"

        payload = build_completed_callback_payload(
            analysis_job_id="job_001",
            run_id="run_001",
            judge_result=result,
        )

        self.assertEqual(payload["modelInfo"]["llm"], "gpt-4.1-nano")
        self.assertEqual(payload["topFindings"][0]["title"], "Competing primary CTAs")

    def test_prompt_requires_preserving_analysis_result(self) -> None:
        client = FakeGMSClient('{"overall_summary":"ok","issue_explanations":[]}')

        GMSReportExplainer(client=client, enabled=True).explain(sample_judge_result())

        self.assertIn("Do not change the analytical result or conclusion.", client.prompts[0])
        self.assertIn("Do not add new issues, remove issues, merge issues, split issues, or change issue order.", client.prompts[0])
        self.assertIn("where the issue appears, which observed components or elements are involved", client.prompts[0])
        self.assertIn("do not rewrite it as a simple color/emphasis problem", client.prompts[0])
        self.assertIn("explain the causal chain in one or two sentences", client.prompts[0])
        self.assertIn("Include the 'why', not only the final business metric.", client.prompts[0])
        self.assertIn("Avoid jargon in report copy", client.prompts[0])
        self.assertIn("must not contain internal UX/system terms", client.prompts[0])
        self.assertIn("CTA, primary, primary-like, secondary", client.prompts[0])
        self.assertIn("'버튼', '가장 중요한 버튼', '보조 버튼'", client.prompts[0])
        self.assertIn("사용자가 어떤 버튼을 먼저 눌러야 할지 망설일 수 있습니다", client.prompts[0])
        self.assertIn("Do not expose internal identifiers", client.prompts[0])
        self.assertIn("describe the visible page behavior in plain Korean", client.prompts[0])
        self.assertIn("Do not expose selector, role, or evidence_ref in the final user-facing copy", client.prompts[0])
        self.assertIn("Do not write nudge.rationale with phrases like evidence id, evidence_ref, 감지되었습니다", client.prompts[0])
        self.assertIn("not a command", client.prompts[0])
        self.assertIn("~하는 게 어떤가요?", client.prompts[0])
        self.assertIn("must start exactly with '위 추천을 통해 '", client.prompts[0])
        self.assertIn("must end with '~할 것 같아요.'", client.prompts[0])
        self.assertIn("not firm endings like '~할 가능성이 높아집니다'", client.prompts[0])

    def test_openai_response_text_extractor_accepts_responses_shape(self) -> None:
        payload = {
            "output": [
                {
                    "content": [
                        {
                            "type": "output_text",
                            "text": '{"overall_summary":"ok","issue_explanations":[]}',
                        }
                    ]
                }
            ]
        }

        self.assertEqual(
            extract_openai_response_text(payload),
            '{"overall_summary":"ok","issue_explanations":[]}',
        )

    def test_openai_response_text_extractor_accepts_partial_body(self) -> None:
        body = 'null, "output": [{"content": [{"type": "output_text", "text": "{\\"ok\\": true}"}]}], "usage": {"total'

        self.assertEqual(
            extract_openai_response_text_from_body(body),
            '{"ok": true}',
        )

    def test_gms_result_is_a_copy(self) -> None:
        original = sample_judge_result()
        frozen = copy.deepcopy(original)

        GMSReportExplainer(
            client=FakeGMSClient(
                json.dumps(
                    {
                        "overall_summary": "ok",
                        "issue_explanations": [
                            {
                                "issue_id": "issue_001",
                                "summary": "Changed",
                            }
                        ],
                    }
                )
            ),
            enabled=True,
        ).explain(original)

        self.assertEqual(original, frozen)


if __name__ == "__main__":
    unittest.main()
