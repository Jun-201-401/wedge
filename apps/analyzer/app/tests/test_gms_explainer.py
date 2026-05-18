from __future__ import annotations

import copy
import json
import os
import unittest
from typing import Any
from unittest.mock import patch

from app.providers.gms import GMSClientError, extract_openai_response_text, extract_openai_response_text_from_body
from app.services.analysis_service import build_completed_callback_payload
from app.services.llm_analysis import GMSReportExplainer
from app.services.llm_analysis.gms_explainer import (
    GMS_REPORT_COMPACT_PROMPT_ENV,
    GMSReportExplainerTelemetry,
    _build_prompt,
    _report_compact_prompt_enabled_from_env,
)


class FakeGMSClient:
    def __init__(self, response_text: str | Exception | list[str | Exception]) -> None:
        self.responses = response_text if isinstance(response_text, list) else [response_text]
        self.prompts: list[str] = []

    def generate_text(self, *, prompt: str) -> str:
        self.prompts.append(prompt)
        response = self.responses[min(len(self.prompts) - 1, len(self.responses) - 1)]
        if isinstance(response, Exception):
            raise response
        return response


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
    def test_report_compact_prompt_config_is_disabled_by_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(_report_compact_prompt_enabled_from_env())

    def test_report_compact_prompt_config_parses_true_values(self) -> None:
        for value in ("1", "true", "TRUE", "yes", "on"):
            with self.subTest(value=value), patch.dict(os.environ, {GMS_REPORT_COMPACT_PROMPT_ENV: value}, clear=True):
                self.assertTrue(_report_compact_prompt_enabled_from_env())

    def test_report_compact_prompt_config_treats_invalid_values_as_false(self) -> None:
        for value in ("", "0", "false", "no", "off", "unexpected"):
            with self.subTest(value=value), patch.dict(os.environ, {GMS_REPORT_COMPACT_PROMPT_ENV: value}, clear=True):
                self.assertFalse(_report_compact_prompt_enabled_from_env())

    def test_compact_prompt_off_uses_existing_prompt(self) -> None:
        original = sample_judge_result()

        self.assertEqual(_build_prompt(original), _build_prompt(original, compact_prompt_enabled=False))

    def test_compact_prompt_reduces_evidence_location_payload_without_losing_visible_context(self) -> None:
        original = sample_judge_result()
        original["issues"][0]["evidence_locations"][0]["components"][0].update(
            {
                "text": "무료 체험 시작",
                "role": "button",
                "aria_label": "무료 체험 신청",
            }
        )

        full_prompt = _build_prompt(original)
        compact_prompt = _build_prompt(original, compact_prompt_enabled=True)

        self.assertLess(len(compact_prompt), len(full_prompt))
        self.assertIn('"issue_id": "issue_001"', compact_prompt)
        self.assertIn('"criterion_id": "PATH-CTA-002"', compact_prompt)
        self.assertIn('"evidence_refs": ["cp_001.obs_002"]', compact_prompt)
        self.assertIn("evidence_location_summary", compact_prompt)
        self.assertIn("Ground every claim in evidence_refs and evidence_location_summary", compact_prompt)
        self.assertIn("무료 체험 시작", compact_prompt)
        self.assertIn("button", compact_prompt)
        self.assertNotIn("a.hero-start", compact_prompt)
        self.assertNotIn('"selector"', compact_prompt)
        self.assertNotIn('"bounds"', compact_prompt)

    def test_compact_prompt_summarizes_non_component_evidence_shapes(self) -> None:
        original = sample_judge_result()
        original["issues"][0]["evidence_locations"] = [
            {
                "evidence_ref": "cp_001.obs_loading",
                "type": "loading_state",
                "visible_text": "로딩 중",
                "role": "status",
                "bounds": {"x": 20, "y": 40, "width": 180, "height": 32},
                "problem_components": [
                    {
                        "text": "로딩 중",
                        "role": "status",
                        "bounds": {"x": 20, "y": 40, "width": 180, "height": 32},
                    }
                ],
            },
            {
                "evidence_ref": "cp_001.obs_cards",
                "type": "product_card",
                "product_cards": [
                    {
                        "text": "초코칩 쿠키",
                        "role": "product_card",
                        "bounds": {"x": 170, "y": 395, "width": 285, "height": 281},
                    }
                ],
            },
            {
                "evidence_ref": "cp_001.obs_items",
                "type": "choice_list",
                "items": [
                    {
                        "label": "방문 포장",
                        "role": "option",
                        "bounds": {"x": 80, "y": 200, "width": 200, "height": 44},
                    }
                ],
            },
        ]

        compact_prompt = _build_prompt(original, compact_prompt_enabled=True)

        self.assertIn("로딩 중", compact_prompt)
        self.assertIn("초코칩 쿠키", compact_prompt)
        self.assertIn("방문 포장", compact_prompt)
        self.assertIn("status", compact_prompt)
        self.assertIn("product_card", compact_prompt)
        self.assertIn("option", compact_prompt)
        self.assertIn('"hasBounds": true', compact_prompt)
        self.assertNotIn('"bounds"', compact_prompt)

    def test_compact_prompt_keeps_textless_evidence_refs_without_coordinates(self) -> None:
        original = sample_judge_result()
        original["issues"][0]["evidence_refs"] = ["cp_001.obs_selector_only"]
        original["issues"][0]["evidence_locations"] = [
            {
                "evidence_ref": "cp_001.obs_selector_only",
                "type": "selector_only",
                "selector": ".checkout-primary",
                "bounds": {"x": 64, "y": 128, "width": 240, "height": 48},
            }
        ]

        compact_prompt = _build_prompt(original, compact_prompt_enabled=True)

        self.assertIn('"evidence_refs": ["cp_001.obs_selector_only"]', compact_prompt)
        self.assertIn('"types": ["selector_only"]', compact_prompt)
        self.assertIn('"componentCount": 1', compact_prompt)
        self.assertIn('"hasBounds": true', compact_prompt)
        self.assertNotIn(".checkout-primary", compact_prompt)
        self.assertNotIn('"selector"', compact_prompt)
        self.assertNotIn('"bounds"', compact_prompt)

    def test_compact_prompt_records_compact_and_full_prompt_sizes(self) -> None:
        original = sample_judge_result()
        original["issues"][0]["evidence_locations"][0]["components"][0]["text"] = "무료 체험 시작"
        response = {
            "overall_summary": "큰 입력을 줄인 뒤에도 문장 정리에 성공했습니다.",
            "issue_explanations": [],
        }
        client = FakeGMSClient(json.dumps(response, ensure_ascii=False))
        telemetry = GMSReportExplainerTelemetry()

        result = GMSReportExplainer(
            client=client,
            enabled=True,
            compact_prompt_enabled=True,
        ).explain(original, telemetry=telemetry)

        self.assertEqual(result["llm_provider"], "gms")
        self.assertEqual(client.prompts[0], _build_prompt(original, compact_prompt_enabled=True))
        self.assertTrue(telemetry.compact_prompt_enabled)
        self.assertEqual(telemetry.prompt_char_count, len(client.prompts[0]))
        self.assertEqual(telemetry.full_prompt_char_count, len(_build_prompt(original)))
        self.assertLess(telemetry.prompt_char_count, telemetry.full_prompt_char_count)

    def test_compact_prompt_preserves_completed_callback_shape_after_gms_response(self) -> None:
        original = sample_judge_result()
        response = {
            "overall_summary": "요약 문장을 정리했습니다.",
            "issue_explanations": [
                {
                    "issue_id": "issue_001",
                    "title": "가장 중요한 버튼이 흐려집니다",
                    "summary": "주요 버튼과 보조 선택지가 함께 보여 다음 행동이 헷갈릴 수 있습니다.",
                    "recommendations": ["가장 중요한 버튼 하나만 더 또렷하게 보여주세요."],
                }
            ],
        }

        result = GMSReportExplainer(
            client=FakeGMSClient(json.dumps(response, ensure_ascii=False)),
            enabled=True,
            compact_prompt_enabled=True,
            model="gpt-4.1-nano",
        ).explain(original)
        payload = build_completed_callback_payload(
            analysis_job_id="job_001",
            run_id="run_001",
            judge_result=result,
        )

        self.assertEqual(payload["modelInfo"]["llm"], "gpt-4.1-nano")
        self.assertEqual(payload["topFindings"][0]["category"], "PATH-CTA-002")
        self.assertEqual(payload["topFindings"][0]["evidenceRefs"], [{"type": "evidence", "id": "cp_001.obs_002"}])
        self.assertEqual(payload["judgeResult"]["issues"][0]["severity"], 2)
        self.assertEqual(payload["judgeResult"]["issues"][0]["confidence"], 0.81)
        self.assertEqual(payload["nudges"][0]["title"], "가장 중요한 버튼이 흐려집니다")

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

    def test_disabled_explainer_records_safe_telemetry_without_changing_result(self) -> None:
        original = sample_judge_result()
        telemetry = GMSReportExplainerTelemetry()

        result = GMSReportExplainer(
            client=FakeGMSClient("{}"),
            enabled=False,
        ).explain(original, telemetry=telemetry)

        self.assertEqual(result, original)
        self.assertEqual(
            telemetry.to_phase_extra(),
            {
                "gmsEnabled": False,
                "clientConfigured": True,
                "compactPromptEnabled": False,
                "promptCharCount": 0,
                "fullPromptCharCount": 0,
                "responseCharCount": 0,
                "attemptCount": 0,
                "fallbackUsed": False,
                "lastErrorType": None,
            },
        )

    def test_invalid_gms_response_falls_back_to_rule_engine_text(self) -> None:
        original = sample_judge_result()
        result = GMSReportExplainer(
            client=FakeGMSClient("not-json"),
            enabled=True,
        ).explain(original)

        self.assertEqual(result["issues"], original["issues"])
        self.assertIn("GMS explanation fallback used deterministic text", result["llm_notes"][-1])
        self.assertIn("after 2 attempts", result["llm_notes"][-1])

    def test_gms_explainer_retries_once_before_fallback(self) -> None:
        original = sample_judge_result()
        response = {
            "overall_summary": "재시도 후 문장 정리에 성공했습니다.",
            "issue_explanations": [
                {
                    "issue_id": "issue_001",
                    "title": "주요 버튼이 서로 경쟁합니다",
                    "summary": "여러 버튼이 비슷하게 강조되어 첫 행동 선택이 어려울 수 있습니다.",
                }
            ],
        }
        client = FakeGMSClient([
            GMSClientError("temporary failure"),
            json.dumps(response, ensure_ascii=False),
        ])

        result = GMSReportExplainer(
            client=client,
            enabled=True,
            model="gpt-4.1-nano",
        ).explain(original)

        self.assertEqual(len(client.prompts), 2)
        self.assertEqual(result["issues"][0]["title"], "주요 버튼이 서로 경쟁합니다")
        self.assertEqual(result["summary"]["llm_overall_summary"], "재시도 후 문장 정리에 성공했습니다.")
        self.assertEqual(result["llm_provider"], "gms")
        self.assertIn("Succeeded after retry attempt 2", result["llm_notes"][-1])

    def test_gms_explainer_records_retry_success_telemetry(self) -> None:
        original = sample_judge_result()
        response = {
            "overall_summary": "재시도 후 문장 정리에 성공했습니다.",
            "issue_explanations": [],
        }
        client = FakeGMSClient([
            GMSClientError("temporary failure"),
            json.dumps(response, ensure_ascii=False),
        ])
        telemetry = GMSReportExplainerTelemetry()

        result = GMSReportExplainer(
            client=client,
            enabled=True,
            model="gpt-4.1-nano",
        ).explain(original, telemetry=telemetry)

        self.assertEqual(result["llm_provider"], "gms")
        self.assertEqual(telemetry.attempt_count, 2)
        self.assertFalse(telemetry.fallback_used)
        self.assertEqual(telemetry.last_error_type, "GMSClientError")
        self.assertEqual(telemetry.prompt_char_count, len(client.prompts[-1]))
        self.assertEqual(telemetry.response_char_count, len(json.dumps(response, ensure_ascii=False)))
        self.assertEqual(client.prompts[0], _build_prompt(original))
        self.assertEqual(client.prompts[1], _build_prompt(original))

    def test_gms_explainer_falls_back_after_retry_is_exhausted(self) -> None:
        original = sample_judge_result()
        client = FakeGMSClient([
            GMSClientError("temporary failure"),
            GMSClientError("still failing"),
        ])
        telemetry = GMSReportExplainerTelemetry()

        result = GMSReportExplainer(
            client=client,
            enabled=True,
        ).explain(original, telemetry=telemetry)

        self.assertEqual(len(client.prompts), 2)
        self.assertEqual(result["issues"], original["issues"])
        self.assertNotIn("llm_provider", result)
        self.assertIn("after 2 attempts", result["llm_notes"][-1])
        self.assertEqual(telemetry.attempt_count, 2)
        self.assertTrue(telemetry.fallback_used)
        self.assertEqual(telemetry.last_error_type, "GMSClientError")
        self.assertEqual(telemetry.prompt_char_count, len(client.prompts[-1]))

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

        self.assertIn("Do not change the analytical result", client.prompts[0])
        self.assertIn("issue order, issue count, or rule-owned fields", client.prompts[0])
        self.assertIn("Rewrite only report copy fields", client.prompts[0])
        self.assertIn("Ground every claim in evidence_refs and evidence_locations", client.prompts[0])
        self.assertIn("Do not invent unsupported facts", client.prompts[0])
        self.assertIn("non-technical readers", client.prompts[0])
        self.assertIn("비전공자도 이해할 수 있게 알려줘", client.prompts[0])
        self.assertIn("Avoid internal UX/system terms", client.prompts[0])
        self.assertIn("CTA, primary, primary-like", client.prompts[0])
        self.assertIn("grouping, target action, conversion, or friction", client.prompts[0])
        self.assertIn("'버튼', '가장 중요한 버튼', '보조 버튼'", client.prompts[0])
        self.assertIn("사용자가 하려는 일", client.prompts[0])
        self.assertIn("summary must say where the issue appears", client.prompts[0])
        self.assertIn("harder for a user to understand, choose, or continue", client.prompts[0])
        self.assertIn("why it can confuse users or make the next step harder", client.prompts[0])
        self.assertIn("impact_hypothesis must explain the causal chain", client.prompts[0])
        self.assertIn("include the 'why'", client.prompts[0])
        self.assertIn("If component text is missing or garbled", client.prompts[0])
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
