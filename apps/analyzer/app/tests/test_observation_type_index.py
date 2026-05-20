from __future__ import annotations

import unittest
from dataclasses import replace

from app.rule_engine.handler_utils import observations_of_type
from app.stage.stage_context_builder import (
    ObservationRecord,
    StageContext,
    StageContextBuilder,
)


QUERY_PROFILE = (
    ("cta_candidate",),
    ("form_field",),
    ("network_failure", "console_error", "network_timeline"),
    ("interactive_components",),
    ("loading_state", "settle_response"),
    ("cta_cluster", "interactive_components"),
    ("product_card",),
    ("runner_failure",),
)


class ObservationTypeIndexTest(unittest.TestCase):
    def test_indexed_lookup_returns_same_records_as_repeated_scan(self) -> None:
        context = build_context(observation_count=800)

        self.assertTrue(context.observation_type_index)
        for types in QUERY_PROFILE:
            self.assertEqual(
                [record.ref for record in scan_observations_of_type(context, *types)],
                [record.ref for record in observations_of_type(context, *types)],
                f"lookup mismatch for {types}",
            )

    def test_multi_type_lookup_preserves_original_observation_order(self) -> None:
        context = context_from_records(
            [
                observation_record("checkpoint_001", "a", "network_failure"),
                observation_record("checkpoint_001", "b", "console_error"),
                observation_record("checkpoint_001", "c", "network_failure"),
            ]
        )

        self.assertEqual(
            ["checkpoint_001.a", "checkpoint_001.b", "checkpoint_001.c"],
            [record.ref for record in observations_of_type(context, "network_failure", "console_error")],
        )

    def test_duplicate_type_arguments_match_scan_behavior(self) -> None:
        context = context_from_records(
            [
                observation_record("checkpoint_001", "a", "network_failure"),
                observation_record("checkpoint_001", "b", "network_failure"),
            ]
        )

        self.assertEqual(
            ["checkpoint_001.a", "checkpoint_001.b"],
            [record.ref for record in observations_of_type(context, "network_failure", "network_failure")],
        )

    def test_index_is_rebuilt_when_observations_are_replaced(self) -> None:
        context = StageContext(
            stage="CTA",
            observations=(
                observation_record("checkpoint_001", "a", "network_failure"),
            ),
        )
        replaced_context = replace(
            context,
            observations=(observation_record("checkpoint_001", "b", "console_error"),),
        )

        self.assertEqual(
            [],
            [record.ref for record in observations_of_type(replaced_context, "network_failure")],
        )
        self.assertEqual(
            ["checkpoint_001.b"],
            [record.ref for record in observations_of_type(replaced_context, "console_error")],
        )

    def test_index_reduces_repeated_lookup_work_from_rules_times_observations_to_build_plus_probe_work(self) -> None:
        observation_count = 1_200
        simulated_rule_count = 80
        repeated_queries = QUERY_PROFILE * (simulated_rule_count // len(QUERY_PROFILE))

        scan_checks = observation_count * len(repeated_queries)
        index_build_checks = observation_count
        index_lookup_probes = sum(len(set(types)) for types in repeated_queries)

        self.assertEqual(scan_checks, 96_000)
        self.assertEqual(index_build_checks + index_lookup_probes, 1_320)
        self.assertLess(index_build_checks + index_lookup_probes, scan_checks / 50)


def scan_observations_of_type(context: StageContext, *types: str) -> list[ObservationRecord]:
    requested_types = set(types)
    return [record for record in context.observations if record.observation.get("type") in requested_types]


def build_context(observation_count: int) -> StageContext:
    contexts = StageContextBuilder().build(
        {
            "checkpoints": [
                {
                    "checkpoint_id": "checkpoint_001",
                    "primaryStage": "CTA",
                    "observations": [
                        {
                            "observation_id": f"obs_{index:05d}",
                            "type": observation_type_for(index),
                            "stage": "CTA",
                            "confidence": 0.9,
                            "data": {"index": index},
                        }
                        for index in range(observation_count)
                    ],
                }
            ]
        }
    )
    return contexts["CTA"]


def context_from_records(records: list[ObservationRecord]) -> StageContext:
    return StageContext(
        stage="CTA",
        observations=tuple(records),
    )


def observation_record(checkpoint_id: str, observation_id: str, observation_type: str) -> ObservationRecord:
    return ObservationRecord(
        checkpoint_id=checkpoint_id,
        observation={
            "observation_id": observation_id,
            "type": observation_type,
            "stage": "CTA",
        },
        stage="CTA",
    )


def observation_type_for(index: int) -> str:
    observation_types = (
        "cta_candidate",
        "form_field",
        "network_failure",
        "console_error",
        "network_timeline",
        "interactive_components",
        "loading_state",
        "settle_response",
        "cta_cluster",
        "product_card",
        "runner_failure",
        "visible_text_block",
        "layout_summary",
        "journey_action_raw",
    )
    return observation_types[index % len(observation_types)]


if __name__ == "__main__":
    unittest.main()
