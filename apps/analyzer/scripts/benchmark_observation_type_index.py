from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import sys
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.rule_engine.handler_utils import observations_of_type
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


def main() -> None:
    print("| observations | rule lookups | scan avg ms | indexed avg ms | speedup |")
    print("| ---: | ---: | ---: | ---: | ---: |")

    for observation_count in (100, 500, 1_000, 5_000, 10_000):
        for rule_lookup_count in (20, 80, 200):
            result = benchmark_case(
                observation_count=observation_count,
                rule_lookup_count=rule_lookup_count,
                iterations=iterations_for(observation_count, rule_lookup_count),
            )
            print(
                f"| {observation_count} | {rule_lookup_count} | "
                f"{result['scan_ms']:.4f} | {result['indexed_ms']:.4f} | {result['speedup']:.2f}x |"
            )


def benchmark_case(
    *,
    observation_count: int,
    rule_lookup_count: int,
    iterations: int,
) -> dict[str, float]:
    context = build_context(observation_count)
    queries = [QUERY_PROFILE[index % len(QUERY_PROFILE)] for index in range(rule_lookup_count)]

    scan_checksum = run_scan(context, queries)
    indexed_checksum = run_indexed(context, queries)
    if scan_checksum != indexed_checksum:
        raise RuntimeError("indexed lookup returned different records from repeated scan")

    scan_start = perf_counter()
    scan_total = 0
    for _ in range(iterations):
        scan_total += run_scan(context, queries)
    scan_elapsed = perf_counter() - scan_start

    indexed_start = perf_counter()
    indexed_total = 0
    for _ in range(iterations):
        indexed_total += run_indexed(context, queries)
    indexed_elapsed = perf_counter() - indexed_start

    if scan_total != indexed_total:
        raise RuntimeError("benchmark checksums diverged")

    scan_ms = scan_elapsed * 1_000 / iterations
    indexed_ms = indexed_elapsed * 1_000 / iterations

    return {
        "scan_ms": scan_ms,
        "indexed_ms": indexed_ms,
        "speedup": scan_ms / indexed_ms if indexed_ms else float("inf"),
    }


def iterations_for(observation_count: int, rule_lookup_count: int) -> int:
    work = observation_count * rule_lookup_count
    if work <= 50_000:
        return 300
    if work <= 250_000:
        return 120
    if work <= 1_000_000:
        return 50
    return 15


def run_scan(context: StageContext, queries: list[tuple[str, ...]]) -> int:
    checksum = 0

    for types in queries:
        checksum += len(scan_observations_of_type(context.observations, *types))

    return checksum


def run_indexed(context: StageContext, queries: list[tuple[str, ...]]) -> int:
    indexed_context = replace(context, observations=context.observations)
    checksum = 0

    for types in queries:
        checksum += len(observations_of_type(indexed_context, *types))

    return checksum


def scan_observations_of_type(observations: tuple[ObservationRecord, ...], *types: str) -> list[ObservationRecord]:
    requested_types = set(types)
    return [record for record in observations if record.observation.get("type") in requested_types]


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
    main()
