from __future__ import annotations

import json
import unittest

from app.providers.semantic import GMSSemanticProvider


class FakeTextGMSClient:
    def __init__(self, response_text: str) -> None:
        self.response_text = response_text
        self.calls: list[dict[str, str]] = []

    def generate_text(self, *, prompt: str) -> str:
        self.calls.append({"prompt": prompt})
        return self.response_text


class GMSSemanticProviderTest(unittest.TestCase):
    def test_gms_semantic_provider_returns_sanitized_label_only_result(self) -> None:
        response = {
            "labels": {
                "scenario_relevance_label": "IRRELEVANT_ACTION",
                "action_specificity_label": "EXPLORATORY_LABEL",
            },
            "confidence": 0.87,
            "severity": 3,
            "priority_score": 999,
            "evidence_refs": ["provider.must.not.control.refs"],
        }
        client = FakeTextGMSClient(json.dumps(response))
        provider = GMSSemanticProvider(client=client)  # type: ignore[arg-type]

        result = provider.classify_cta(
            text="Careers",
            scenario_goal="Start a free trial",
            target_ref="cp_001.obs_cta",
        )
        data = result.as_observation_data()

        self.assertIn("Return label-only JSON", client.calls[0]["prompt"])
        self.assertIn("Start a free trial", client.calls[0]["prompt"])
        self.assertEqual(result.provider_type, "internal_llm")
        self.assertEqual(result.provider_name, "gms_semantic_provider")
        self.assertEqual(result.labels["scenario_relevance_label"], "IRRELEVANT_ACTION")
        self.assertEqual(result.labels["action_specificity_label"], "EXPLORATORY_LABEL")
        self.assertEqual(result.confidence, 0.87)
        self.assertNotIn("severity", data)
        self.assertNotIn("priority_score", data)
        self.assertNotIn("evidence_refs", data)

    def test_disabled_gms_semantic_provider_degrades_to_unknown(self) -> None:
        provider = GMSSemanticProvider(client=FakeTextGMSClient("{}"), enabled=False)  # type: ignore[arg-type]

        result = provider.classify_cta(
            text="Careers",
            scenario_goal="Start a free trial",
            target_ref="cp_001.obs_cta",
        )

        self.assertEqual(result.labels["scenario_relevance_label"], "UNKNOWN")
        self.assertEqual(result.labels["action_specificity_label"], "UNKNOWN")
        self.assertEqual(result.confidence, 0.0)
        self.assertEqual(result.provider_error, "provider_unavailable")


if __name__ == "__main__":
    unittest.main()
