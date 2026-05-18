from __future__ import annotations

import copy
import threading
import unittest

from app.normalization.gms_checkpoint_parallel import GMSCheckpointParallelConfig
from app.normalization.label_integrity_resolver import LabelIntegrityResolver
from app.normalization.label_role_resolver import LabelRoleResolver
from app.providers.label_integrity import LabelIntegrityIssueResult
from app.providers.label_role import LabelRoleIssueResult


class RecordingIntegrityProvider:
    def __init__(self, *, block_first_until_second_enters: bool = False) -> None:
        self.calls: list[dict] = []
        self.active = 0
        self.max_active = 0
        self._lock = threading.Lock()
        self._second_entered = threading.Event()
        self._block_first_until_second_enters = block_first_until_second_enters

    def classify_label_integrity(self, *, scenario_goal: str, stage: str, checkpoint_id: str, screenshot_url: str, candidates: list[dict]):
        candidate_ids = [candidate["candidate_id"] for candidate in candidates]
        with self._lock:
            self.calls.append({"checkpoint_id": checkpoint_id, "candidate_ids": candidate_ids})
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            if self._block_first_until_second_enters:
                if checkpoint_id == "cp_001":
                    self._second_entered.wait(timeout=2)
                elif checkpoint_id == "cp_002":
                    self._second_entered.set()
            return [
                LabelIntegrityIssueResult(
                    candidate_id=candidate_ids[0],
                    has_issue=True,
                    issue_type="text_clipped",
                    reason=f"{checkpoint_id} label is clipped.",
                    fix_leverage=1.15,
                    confidence=0.82,
                    source="gms_image",
                    affected_bounds={"x": 1, "y": 2, "width": 30, "height": 10},
                )
            ]
        finally:
            with self._lock:
                self.active -= 1


class RecordingRoleProvider:
    def __init__(self, *, block_first_until_second_enters: bool = False) -> None:
        self.calls: list[dict] = []
        self.active = 0
        self.max_active = 0
        self._lock = threading.Lock()
        self._second_entered = threading.Event()
        self._block_first_until_second_enters = block_first_until_second_enters

    def classify_label_roles(self, *, scenario_goal: str, stage: str, checkpoint_id: str, screenshot_url: str, candidates: list[dict]):
        candidate_ids = [candidate["candidate_id"] for candidate in candidates]
        with self._lock:
            self.calls.append({"checkpoint_id": checkpoint_id, "candidate_ids": candidate_ids})
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            if self._block_first_until_second_enters:
                if checkpoint_id == "cp_001":
                    self._second_entered.wait(timeout=2)
                elif checkpoint_id == "cp_002":
                    self._second_entered.set()
            return [
                LabelRoleIssueResult(
                    candidate_id=candidate_ids[0],
                    has_issue=True,
                    issue_type="label_role_mismatch",
                    expected_meaning=f"Expected action for {checkpoint_id}",
                    reason=f"{checkpoint_id} label does not match the role.",
                    fix_leverage=1.15,
                    confidence=0.84,
                    affected_bounds={"x": 1, "y": 2, "width": 30, "height": 10},
                )
            ]
        finally:
            with self._lock:
                self.active -= 1


class FailingRoleProvider:
    def classify_label_roles(self, *, scenario_goal: str, stage: str, checkpoint_id: str, screenshot_url: str, candidates: list[dict]):
        if checkpoint_id == "cp_002":
            raise RuntimeError("provider boom")
        return []


class FailingIntegrityProvider:
    def classify_label_integrity(self, *, scenario_goal: str, stage: str, checkpoint_id: str, screenshot_url: str, candidates: list[dict]):
        if checkpoint_id == "cp_002":
            raise RuntimeError("provider boom")
        return []


class GMSCheckpointParallelResolverTest(unittest.TestCase):
    def test_label_integrity_parallel_matches_serial_output(self) -> None:
        packet = multi_checkpoint_packet(3)
        serial = LabelIntegrityResolver(
            RecordingIntegrityProvider(),
            parallel_config=GMSCheckpointParallelConfig(enabled=False, max_concurrency=2),
        ).enrich_packet(copy.deepcopy(packet))
        parallel_provider = RecordingIntegrityProvider(block_first_until_second_enters=True)
        parallel = LabelIntegrityResolver(
            parallel_provider,
            parallel_config=GMSCheckpointParallelConfig(enabled=True, max_concurrency=2),
        ).enrich_packet(copy.deepcopy(packet))

        self.assertEqual(parallel, serial)
        self.assertGreaterEqual(parallel_provider.max_active, 2)
        self.assertLessEqual(parallel_provider.max_active, 2)

    def test_label_integrity_disabled_mode_preserves_serial_call_order(self) -> None:
        provider = RecordingIntegrityProvider()

        LabelIntegrityResolver(
            provider,
            parallel_config=GMSCheckpointParallelConfig(enabled=False, max_concurrency=2),
        ).enrich_packet(multi_checkpoint_packet(3))

        self.assertEqual([call["checkpoint_id"] for call in provider.calls], ["cp_001", "cp_002", "cp_003"])
        self.assertEqual(provider.max_active, 1)

    def test_label_integrity_parallel_does_not_swallow_unexpected_provider_errors(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "provider boom"):
            LabelIntegrityResolver(
                FailingIntegrityProvider(),
                parallel_config=GMSCheckpointParallelConfig(enabled=True, max_concurrency=2),
            ).enrich_packet(multi_checkpoint_packet(3))


    def test_label_role_parallel_matches_serial_output(self) -> None:
        packet = multi_checkpoint_packet(3)
        serial = LabelRoleResolver(
            RecordingRoleProvider(),
            parallel_config=GMSCheckpointParallelConfig(enabled=False, max_concurrency=2),
        ).enrich_packet(copy.deepcopy(packet))
        parallel_provider = RecordingRoleProvider(block_first_until_second_enters=True)
        parallel = LabelRoleResolver(
            parallel_provider,
            parallel_config=GMSCheckpointParallelConfig(enabled=True, max_concurrency=2),
        ).enrich_packet(copy.deepcopy(packet))

        self.assertEqual(parallel, serial)
        self.assertGreaterEqual(parallel_provider.max_active, 2)
        self.assertLessEqual(parallel_provider.max_active, 2)

    def test_label_role_disabled_mode_preserves_serial_call_order(self) -> None:
        provider = RecordingRoleProvider()

        LabelRoleResolver(
            provider,
            parallel_config=GMSCheckpointParallelConfig(enabled=False, max_concurrency=2),
        ).enrich_packet(multi_checkpoint_packet(3))

        self.assertEqual([call["checkpoint_id"] for call in provider.calls], ["cp_001", "cp_002", "cp_003"])
        self.assertEqual(provider.max_active, 1)

    def test_label_role_parallel_does_not_swallow_unexpected_provider_errors(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "provider boom"):
            LabelRoleResolver(
                FailingRoleProvider(),
                parallel_config=GMSCheckpointParallelConfig(enabled=True, max_concurrency=2),
            ).enrich_packet(multi_checkpoint_packet(3))


def multi_checkpoint_packet(count: int) -> dict:
    artifacts = []
    checkpoints = []
    for index in range(1, count + 1):
        checkpoint_id = f"cp_{index:03d}"
        artifact_id = f"artifact_{index:03d}"
        artifacts.append(
            {
                "artifact_id": artifact_id,
                "type": "screenshot",
                "mime_type": "image/png",
                "signed_url": f"https://example.test/{checkpoint_id}.png?sig=redacted",
            }
        )
        checkpoints.append(
            {
                "checkpoint_id": checkpoint_id,
                "stage": "CTA",
                "artifact_refs": [f"artifact:{artifact_id}"],
                "observations": [
                    {
                        "observation_id": "obs_label",
                        "type": "cta_candidate",
                        "stage": "CTA",
                        "data": {
                            "visible_text": f"Continue {index}",
                            "role": "button",
                            "clicked_in_scenario": True,
                            "bounds": {"x": 10, "y": 20, "width": 120, "height": 44},
                        },
                    }
                ],
            }
        )
    return {
        "schema_version": "0.5",
        "run_id": "run-test",
        "scenario": {"goal": "Complete checkout"},
        "artifacts": artifacts,
        "checkpoints": checkpoints,
    }


if __name__ == "__main__":
    unittest.main()
