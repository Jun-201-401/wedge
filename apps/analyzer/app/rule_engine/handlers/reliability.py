from __future__ import annotations

from typing import Any

from app.rule_engine.handler_utils import base_hit, checkpoint_primary_stage, observations_of_type
from app.rule_engine.models import RuleHit
from app.stage.stage_context_builder import StageContext


def evaluate_reliability(rule: dict[str, Any], context: StageContext) -> RuleHit | None:
    refs: list[str] = []
    failed_count = 0
    console_count = 0

    for record in observations_of_type(context, "network_failure", "console_error"):
        if record.observation.get("type") == "network_failure":
            failed_count += 1
        if record.observation.get("type") == "console_error":
            console_count += 1
        refs.append(record.ref)

    for checkpoint in context.checkpoints:
        # Checkpoint-level state belongs to the checkpoint primary stage. A
        # checkpoint can appear in additional StageContexts because it contains
        # cross-stage observations; do not treat the same state summary as
        # evidence for those derived observation stages.
        if checkpoint_primary_stage(checkpoint) != context.stage:
            continue
        checkpoint_id = str(checkpoint.get("checkpoint_id") or "unknown_checkpoint")
        state = checkpoint.get("state") or {}
        network = state.get("network_summary") or {}
        console = state.get("console_summary") or {}
        checkpoint_failed = int(network.get("failed_request_count") or 0)
        checkpoint_console = int(console.get("error_count") or 0)
        if checkpoint_failed:
            failed_count += checkpoint_failed
            refs.append(f"{checkpoint_id}.state.network_summary")
        if checkpoint_console:
            console_count += checkpoint_console
            refs.append(f"{checkpoint_id}.state.console_summary")

    # Run-level aggregate reliability counters are not stage-attributed
    # evidence. They remain diagnostic until an upstream producer supplies
    # stage-specific observations or checkpoint state.

    refs = list(dict.fromkeys(refs))
    if failed_count == 0 and console_count == 0:
        return None
    return base_hit(
        rule=rule,
        context=context,
        severity=2,
        confidence=0.86 if any(not ref.startswith("aggregate.") for ref in refs) else 0.72,
        evidence_refs=refs,
        observations=[f"failed request {failed_count}건, console error {console_count}건이 관찰됨"],
        signals=["failed_request_count>0" if failed_count else "console_error_count>0"],
        summary="사용자 행동 직후 기술 오류가 관찰되어 진행 신뢰성이 낮아질 수 있습니다.",
        impact_hypothesis="오류가 행동 결과 피드백을 방해해 사용자가 흐름을 재시도하거나 중단할 수 있습니다.",
        recommendations=["행동 직후 실패 요청과 콘솔 오류를 우선 재현하고 사용자-facing fallback을 제공하기"],
        validation_questions=["오류 상황에서도 사용자는 다음 행동 또는 재시도 방법을 이해하는가?"],
    )
