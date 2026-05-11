from __future__ import annotations

import json
import unittest

from app.providers.label_integrity import GMSLabelIntegrityProvider, sanitize_label_integrity_response


class FakeImageGMSClient:
    def __init__(self, response_text: str) -> None:
        self.response_text = response_text
        self.calls: list[dict[str, str]] = []

    def generate_with_image(self, *, prompt: str, image_url: str) -> str:
        self.calls.append({"prompt": prompt, "image_url": image_url})
        return self.response_text


class LabelIntegrityProviderTest(unittest.TestCase):
    def test_gms_label_integrity_provider_uses_image_url_and_sanitizes_response(self) -> None:
        response = {
            "issues": [
                {
                    "candidate_id": "cp_001.obs_label",
                    "has_issue": True,
                    "issue_type": "text_clipped",
                    "reason": "버튼 라벨 하단이 잘려 보입니다.",
                    "fix_leverage": 1.15,
                    "confidence": 0.82,
                    "affected_bounds": {"x": 10, "y": 20, "width": 30, "height": 40},
                }
            ]
        }
        client = FakeImageGMSClient(json.dumps(response, ensure_ascii=False))
        provider = GMSLabelIntegrityProvider(client=client)  # type: ignore[arg-type]

        results = provider.classify_label_integrity(
            scenario_goal="설정 변경",
            stage="CTA",
            checkpoint_id="cp_001",
            screenshot_url="https://cdn.example.com/cp_001.png?sig=test",
            candidates=[
                {
                    "candidate_id": "cp_001.obs_label",
                    "observation_ref": "cp_001.obs_label",
                    "stage": "CTA",
                    "text": "설정",
                    "role": "button",
                    "bounds": {"x": 10, "y": 20, "width": 30, "height": 40},
                }
            ],
        )

        self.assertEqual(client.calls[0]["image_url"], "https://cdn.example.com/cp_001.png?sig=test")
        self.assertIn("Judge only whether visible text is readable and visually intact", client.calls[0]["prompt"])
        self.assertIn("Do not judge whether the label is semantically appropriate", client.calls[0]["prompt"])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].candidate_id, "cp_001.obs_label")
        self.assertEqual(results[0].issue_type, "text_clipped")
        self.assertEqual(results[0].fix_leverage, 1.15)
        self.assertEqual(results[0].confidence, 0.82)

    def test_label_integrity_response_rejects_role_mismatch_and_bad_scores(self) -> None:
        raw = json.dumps(
            {
                "issues": [
                    {
                        "candidate_id": "cp_001.obs_bad_type",
                        "has_issue": True,
                        "issue_type": "label_role_mismatch",
                        "fix_leverage": 1.15,
                        "confidence": 0.9,
                    },
                    {
                        "candidate_id": "cp_001.obs_bad_score",
                        "has_issue": True,
                        "issue_type": "text_clipped",
                        "fix_leverage": 1.2,
                        "confidence": 0.9,
                    },
                    {
                        "candidate_id": "cp_001.obs_low_confidence",
                        "has_issue": True,
                        "issue_type": "text_overlap",
                        "fix_leverage": 1.15,
                        "confidence": 0.2,
                    },
                ]
            }
        )

        results = sanitize_label_integrity_response(
            raw,
            candidate_ids={"cp_001.obs_bad_type", "cp_001.obs_bad_score", "cp_001.obs_low_confidence"},
        )

        self.assertEqual(results, [])


if __name__ == "__main__":
    unittest.main()
