from __future__ import annotations

import json
import unittest
from pathlib import Path

from app.rule_engine import analyze_evidence_packet
from app.rule_engine.observation_priority import OBSERVATION_PRIORITY_POLICY_ID

REPO_ROOT = Path(__file__).resolve().parents[4]
SAMPLE_EVIDENCE_PATH = REPO_ROOT / "packages/contracts/examples/sample-evidence-packet.json"


def load_sample_packet() -> dict:
    with SAMPLE_EVIDENCE_PATH.open(encoding="utf-8") as file:
        return json.load(file)


def observations_by_stage(result: dict, stage: str) -> list[dict]:
    priorities = result["stage_observation_priorities"]
    stages = priorities["stages"]
    for item in stages:
        if item["stage"] == stage:
            return item["observations"]
    raise AssertionError(f"stage not found: {stage}")


class ComponentPriorityTest(unittest.TestCase):
    def test_judge_result_contains_observation_priority_policy(self) -> None:
        result = analyze_evidence_packet(load_sample_packet())

        priorities = result["stage_observation_priorities"]
        self.assertEqual(priorities["policy_id"], OBSERVATION_PRIORITY_POLICY_ID)
        self.assertEqual([item["stage"] for item in priorities["stages"]], ["FIRST_VIEW", "VALUE", "CTA", "INPUT", "COMMIT"])
        self.assertIn("stage_component_priorities", result)

    def test_same_stage_observations_are_ranked_by_mapped_score(self) -> None:
        packet = load_sample_packet()
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_cta_candidate_secondary",
                "type": "cta_candidate",
                "stage": "CTA",
                "source": ["dom"],
                "data": {"visible_text": "Learn more"},
                "confidence": 0.9,
            }
        )

        result = analyze_evidence_packet(packet)
        cta_observations = observations_by_stage(result, "CTA")

        self.assertGreaterEqual(len(cta_observations), 2)
        self.assertEqual(cta_observations[0]["type"], "cta_cluster")
        self.assertEqual(cta_observations[0]["rank"], 1)
        self.assertEqual(cta_observations[0]["ref"], "cp_001.obs_002")
        self.assertEqual(cta_observations[0]["issueIds"], ["issue_001"])
        self.assertGreater(cta_observations[0]["score"], cta_observations[1]["score"])

    def test_one_checkpoint_can_rank_observations_in_multiple_stages(self) -> None:
        packet = load_sample_packet()
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_inline_email",
                "type": "form_field",
                "stage": "INPUT",
                "source": ["dom", "ax"],
                "data": {"field_key": "Email", "visible": True},
                "confidence": 0.88,
            }
        )

        result = analyze_evidence_packet(packet)

        first_view_observations = observations_by_stage(result, "FIRST_VIEW")
        cta_observations = observations_by_stage(result, "CTA")
        input_observations = observations_by_stage(result, "INPUT")

        self.assertTrue(any(observation["type"] == "heading_structure" for observation in first_view_observations))
        self.assertTrue(any(observation["type"] == "cta_cluster" for observation in cta_observations))
        self.assertTrue(any(observation["ref"] == "cp_001.obs_inline_email" for observation in input_observations))


if __name__ == "__main__":
    unittest.main()
