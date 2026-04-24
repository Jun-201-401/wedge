from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.contracts.stages import DECISION_STAGES, DecisionStage
from app.stage.stage_resolver import StageResolver


@dataclass(frozen=True)
class ObservationRecord:
    checkpoint_id: str
    observation: dict[str, Any]
    stage: DecisionStage

    @property
    def observation_id(self) -> str:
        value = self.observation.get("observation_id")
        return str(value) if value else "unknown"

    @property
    def ref(self) -> str:
        return f"{self.checkpoint_id}.{self.observation_id}"


@dataclass(frozen=True)
class StageContext:
    stage: DecisionStage
    checkpoints: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    observations: tuple[ObservationRecord, ...] = field(default_factory=tuple)
    aggregate_signals: dict[str, Any] = field(default_factory=dict)
    scenario: dict[str, Any] = field(default_factory=dict)
    scenario_fit: dict[str, Any] | None = None
    decision_stage_summary: dict[str, Any] = field(default_factory=dict)
    semantic_annotations: dict[str, Any] = field(default_factory=dict)

    @property
    def observed(self) -> bool:
        summary = self.decision_stage_summary.get(self.stage, {})
        return bool(self.checkpoints or self.observations or summary.get("status") == "OBSERVED")

    def evidence_refs(self) -> list[str]:
        refs = [record.ref for record in self.observations if record.observation_id != "unknown"]
        if refs:
            return refs

        summary = self.decision_stage_summary.get(self.stage, {})
        checkpoint_ids = summary.get("checkpointIds") or []
        return [f"{checkpoint_id}.stage.{self.stage}" for checkpoint_id in checkpoint_ids]


class StageContextBuilder:
    """Build one context per DecisionStage from an EvidencePacket dict."""

    def __init__(self, resolver: StageResolver | None = None) -> None:
        self._resolver = resolver or StageResolver()

    def build(self, packet: dict[str, Any]) -> dict[DecisionStage, StageContext]:
        checkpoints_by_stage: dict[DecisionStage, list[dict[str, Any]]] = {stage: [] for stage in DECISION_STAGES}
        observations_by_stage: dict[DecisionStage, list[ObservationRecord]] = {stage: [] for stage in DECISION_STAGES}

        for checkpoint in packet.get("checkpoints", []):
            if not isinstance(checkpoint, dict):
                continue
            checkpoint_stage = self._resolver.resolve_checkpoint_stage(checkpoint)
            checkpoints_by_stage[checkpoint_stage].append(checkpoint)
            checkpoint_id = str(checkpoint.get("checkpoint_id") or "unknown_checkpoint")

            for observation in checkpoint.get("observations", []):
                if not isinstance(observation, dict):
                    continue
                observation_stage = self._resolver.resolve_observation_stage(observation, checkpoint)
                observations_by_stage[observation_stage].append(
                    ObservationRecord(
                        checkpoint_id=checkpoint_id,
                        observation=observation,
                        stage=observation_stage,
                    )
                )
                if checkpoint not in checkpoints_by_stage[observation_stage]:
                    checkpoints_by_stage[observation_stage].append(checkpoint)

        return {
            stage: StageContext(
                stage=stage,
                checkpoints=tuple(checkpoints_by_stage[stage]),
                observations=tuple(observations_by_stage[stage]),
                aggregate_signals=dict(packet.get("aggregate_signals") or {}),
                scenario=dict(packet.get("scenario") or {}),
                scenario_fit=packet.get("scenario_fit"),
                decision_stage_summary=dict(packet.get("decisionStageSummary") or {}),
            )
            for stage in DECISION_STAGES
        }
