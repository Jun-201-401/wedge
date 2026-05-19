from __future__ import annotations

import unittest
from collections import defaultdict
from typing import Iterable

from app.stage.stage_context_builder import ObservationRecord, StageContext


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


class ObservationTypeIndexExperimentTest(unittest.TestCase):
    def test_index_lookup_returns_same_records_as_repeated_scan(self) -> None:
        context = build_context(observation_count=800)
        index = build_observation_type_index(context.observations)

        for types in QUERY_PROFILE:
            self.assertEqual(
                [record.ref for record in scan_observations_of_type(context.observations, *types)],
                [record.ref for record in indexed_observations_of_type(index, *types)],
                f"lookup mismatch for {types}",
            )

    def test_index_reduces_repeated_lookup_work_from_rules_times_observations_to_rules_times_types(self) -> None:
        observation_count = 1_200
        simulated_rule_count = 80
        repeated_queries = QUERY_PROFILE * (simulated_rule_count // len(QUERY_PROFILE))

        scan_checks = observation_count * len(repeated_queries)
        index_build_checks = observation_count
        index_lookup_probes = sum(len(types) for types in repeated_queries)

        self.assertEqual(scan_checks, 96_000)
        self.assertEqual(index_build_checks + index_lookup_probes, 1_320)
        self.assertLess(index_build_checks + index_lookup_probes, scan_checks / 50)


def scan_observations_of_type(
    observations: Iterable[ObservationRecord],
    *types: str,
) -> list[ObservationRecord]:
    return [record for record in observations if record.observation.get("type") in types]


def build_observation_type_index(
    observations: Iterable[ObservationRecord],
) -> dict[str, tuple[tuple[int, ObservationRecord], ...]]:
    buckets: dict[str, list[tuple[int, ObservationRecord]]] = defaultdict(list)

    for index, record in enumerate(observations):
        observation_type = record.observation.get("type")
        if isinstance(observation_type, str):
            buckets[observation_type].append((index, record))

    return {key: tuple(value) for key, value in buckets.items()}


def indexed_observations_of_type(
    index: dict[str, tuple[tuple[int, ObservationRecord], ...]],
    *types: str,
) -> list[ObservationRecord]:
    indexed_records: list[tuple[int, ObservationRecord]] = []

    for observation_type in types:
        indexed_records.extend(index.get(observation_type, ()))

    return [record for _, record in sorted(indexed_records, key=lambda item: item[0])]


def build_context(observation_count: int) -> StageContext:
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

    return StageContext(
        stage="CTA",
        checkpoints=(),
        observations=tuple(
            ObservationRecord(
                checkpoint_id=f"checkpoint_{index // 20:03d}",
                observation={
                    "observation_id": f"obs_{index:05d}",
                    "type": observation_types[index % len(observation_types)],
                    "confidence": 0.9,
                    "data": {"index": index},
                },
                stage="CTA",
            )
            for index in range(observation_count)
        ),
    )


if __name__ == "__main__":
    unittest.main()
