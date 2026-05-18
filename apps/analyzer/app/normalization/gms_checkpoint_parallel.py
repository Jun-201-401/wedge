from __future__ import annotations

import os
from dataclasses import dataclass

GMS_LABEL_PARALLEL_ENABLED_ENV = "ANALYZER_GMS_LABEL_PARALLEL_ENABLED"
GMS_LABEL_MAX_CONCURRENCY_ENV = "ANALYZER_GMS_LABEL_MAX_CONCURRENCY"
DEFAULT_GMS_LABEL_MAX_CONCURRENCY = 2
MAX_GMS_LABEL_MAX_CONCURRENCY = 8

_TRUE_VALUES = {"1", "true", "yes", "y", "on"}
_FALSE_VALUES = {"0", "false", "no", "n", "off", ""}


@dataclass(frozen=True)
class GMSCheckpointParallelConfig:
    """Controls opt-in checkpoint-level parallel GMS calls for label resolvers."""

    enabled: bool = False
    max_concurrency: int = DEFAULT_GMS_LABEL_MAX_CONCURRENCY

    @classmethod
    def from_env(cls) -> "GMSCheckpointParallelConfig":
        return cls(
            enabled=_env_bool(GMS_LABEL_PARALLEL_ENABLED_ENV, default=False),
            max_concurrency=_env_int(
                GMS_LABEL_MAX_CONCURRENCY_ENV,
                default=DEFAULT_GMS_LABEL_MAX_CONCURRENCY,
                minimum=1,
                maximum=MAX_GMS_LABEL_MAX_CONCURRENCY,
            ),
        )

    def should_parallelize(self, job_count: int) -> bool:
        return self.enabled and self.max_concurrency > 1 and job_count > 1


def _env_bool(name: str, *, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in _TRUE_VALUES:
        return True
    if normalized in _FALSE_VALUES:
        return False
    return default


def _env_int(name: str, *, default: int, minimum: int, maximum: int) -> int:
    raw_value = os.environ.get(name)
    if raw_value is None:
        value = default
    else:
        try:
            value = int(raw_value)
        except (TypeError, ValueError):
            value = minimum
    return min(max(value, minimum), maximum)
