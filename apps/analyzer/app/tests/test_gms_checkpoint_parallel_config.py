from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.normalization.gms_checkpoint_parallel import (
    DEFAULT_GMS_LABEL_MAX_CONCURRENCY,
    MAX_GMS_LABEL_MAX_CONCURRENCY,
    GMSCheckpointParallelConfig,
)


class GMSCheckpointParallelConfigTest(unittest.TestCase):
    def test_parallelism_is_disabled_by_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            config = GMSCheckpointParallelConfig.from_env()

        self.assertFalse(config.enabled)
        self.assertEqual(config.max_concurrency, DEFAULT_GMS_LABEL_MAX_CONCURRENCY)
        self.assertFalse(config.should_parallelize(3))

    def test_enabled_flag_accepts_explicit_true_values(self) -> None:
        for value in ("true", "1", "yes", "on"):
            with self.subTest(value=value):
                with patch.dict(os.environ, {"ANALYZER_GMS_LABEL_PARALLEL_ENABLED": value}, clear=True):
                    self.assertTrue(GMSCheckpointParallelConfig.from_env().enabled)

    def test_enabled_flag_defaults_false_for_unknown_values(self) -> None:
        with patch.dict(os.environ, {"ANALYZER_GMS_LABEL_PARALLEL_ENABLED": "maybe"}, clear=True):
            self.assertFalse(GMSCheckpointParallelConfig.from_env().enabled)

    def test_max_concurrency_is_clamped_to_safe_range(self) -> None:
        cases = [
            ("0", 1),
            ("-5", 1),
            ("abc", 1),
            ("3", 3),
            ("999", MAX_GMS_LABEL_MAX_CONCURRENCY),
        ]
        for raw_value, expected in cases:
            with self.subTest(raw_value=raw_value):
                with patch.dict(os.environ, {"ANALYZER_GMS_LABEL_MAX_CONCURRENCY": raw_value}, clear=True):
                    self.assertEqual(GMSCheckpointParallelConfig.from_env().max_concurrency, expected)

    def test_parallelization_requires_enabled_multiple_jobs_and_capacity(self) -> None:
        self.assertFalse(GMSCheckpointParallelConfig(enabled=False, max_concurrency=2).should_parallelize(3))
        self.assertFalse(GMSCheckpointParallelConfig(enabled=True, max_concurrency=1).should_parallelize(3))
        self.assertFalse(GMSCheckpointParallelConfig(enabled=True, max_concurrency=2).should_parallelize(1))
        self.assertTrue(GMSCheckpointParallelConfig(enabled=True, max_concurrency=2).should_parallelize(2))

    def test_hard_cap_allows_three_checkpoint_images_per_phase(self) -> None:
        self.assertEqual(MAX_GMS_LABEL_MAX_CONCURRENCY, 3)


if __name__ == "__main__":
    unittest.main()
