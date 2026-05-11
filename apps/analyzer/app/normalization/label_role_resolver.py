from __future__ import annotations

import copy
from typing import Any

from app.providers.label_role import LabelRoleIssueResult, LabelRoleProviderPort
from app.stage.stage_resolver import StageResolver


class LabelRoleResolver:
    """Enrich EvidencePacket observations with GMS label-role alignment signals."""

    def __init__(self, provider: LabelRoleProviderPort, resolver: StageResolver | None = None) -> None:
        self._provider = provider
        self._resolver = resolver or StageResolver()

    def enrich_packet(self, packet: dict[str, Any]) -> dict[str, Any]:
        enriched = copy.deepcopy(packet)
        artifacts_by_id = _artifacts_by_id(enriched.get("artifacts"))
        scenario_goal = _scenario_goal(enriched)

        for checkpoint in enriched.get("checkpoints") or []:
            if not isinstance(checkpoint, dict):
                continue
            screenshot_url = _screenshot_url_for_checkpoint(checkpoint, artifacts_by_id)
            if not screenshot_url:
                continue

            checkpoint_id = str(checkpoint.get("checkpoint_id") or "unknown_checkpoint")
            stage = self._resolver.resolve_checkpoint_stage(checkpoint)
            candidates, target_index = self._candidates_for_checkpoint(checkpoint)
            if not candidates:
                continue

            results = self._provider.classify_label_roles(
                scenario_goal=scenario_goal,
                stage=stage,
                checkpoint_id=checkpoint_id,
                screenshot_url=screenshot_url,
                candidates=candidates,
            )
            self._apply_results(results, target_index)
        return enriched

    def _candidates_for_checkpoint(
        self,
        checkpoint: dict[str, Any],
    ) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
        checkpoint_id = str(checkpoint.get("checkpoint_id") or "unknown_checkpoint")
        candidates: list[dict[str, Any]] = []
        target_index: dict[str, dict[str, Any]] = {}

        for observation in checkpoint.get("observations") or []:
            if not isinstance(observation, dict):
                continue
            data = observation.get("data")
            if not isinstance(data, dict):
                continue

            observation_id = str(observation.get("observation_id") or "unknown")
            observation_ref = f"{checkpoint_id}.{observation_id}"
            observation_stage = self._resolver.resolve_observation_stage(observation, checkpoint)

            top_level = _candidate_from_data(
                candidate_id=observation_ref,
                observation_ref=observation_ref,
                stage=observation_stage,
                data=data,
            )
            if top_level is not None:
                candidates.append(top_level)
                target_index[top_level["candidate_id"]] = data

            components = data.get("components")
            if not isinstance(components, list):
                continue
            for index, component in enumerate(components, start=1):
                if not isinstance(component, dict):
                    continue
                component_candidate = _candidate_from_data(
                    candidate_id=f"{observation_ref}.component_{index:03d}",
                    observation_ref=observation_ref,
                    stage=observation_stage,
                    data=component,
                )
                if component_candidate is None:
                    continue
                candidates.append(component_candidate)
                target_index[component_candidate["candidate_id"]] = component

        return candidates, target_index

    def _apply_results(
        self,
        results: list[LabelRoleIssueResult],
        target_index: dict[str, dict[str, Any]],
    ) -> None:
        for result in results:
            target = target_index.get(result.candidate_id)
            if target is None:
                continue
            target["label_role_alignment"] = result.as_alignment_data()
            target["label_issue_type"] = result.issue_type
            target["expected_meaning"] = result.expected_meaning
            target["fix_leverage"] = result.fix_leverage


def _candidate_from_data(
    *,
    candidate_id: str,
    observation_ref: str,
    stage: str,
    data: dict[str, Any],
) -> dict[str, Any] | None:
    text = _visible_text(data)
    if not text:
        return None

    candidate: dict[str, Any] = {
        "candidate_id": candidate_id,
        "observation_ref": observation_ref,
        "stage": stage,
        "text": text,
    }
    for key in (
        "role",
        "tag",
        "selector",
        "component_type",
        "clicked_in_scenario",
        "is_cta_candidate",
        "is_primary_like",
        "bounds",
        "visual_prominence",
        "prominence",
        "expected_meaning",
        "expected_role",
        "expected_intent",
        "expected_function",
    ):
        value = data.get(key)
        if value is not None:
            candidate[key] = value
    return candidate


def _visible_text(data: dict[str, Any]) -> str:
    for key in ("text", "visible_text", "message", "label_text", "placeholder", "accessible_name"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _scenario_goal(packet: dict[str, Any]) -> str:
    scenario = packet.get("scenario")
    if not isinstance(scenario, dict):
        return ""
    for key in ("goal", "scenario_goal", "user_goal", "description"):
        value = scenario.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _artifacts_by_id(value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(value, list):
        return {}
    artifacts: dict[str, dict[str, Any]] = {}
    for artifact in value:
        if not isinstance(artifact, dict):
            continue
        artifact_id = _artifact_id(artifact)
        if artifact_id:
            artifacts[artifact_id] = artifact
    return artifacts


def _screenshot_url_for_checkpoint(
    checkpoint: dict[str, Any],
    artifacts_by_id: dict[str, dict[str, Any]],
) -> str:
    for artifact_ref in checkpoint.get("artifact_refs") or []:
        artifact_id = _normalize_artifact_ref(artifact_ref)
        if not artifact_id:
            continue
        artifact = artifacts_by_id.get(artifact_id)
        if artifact and _is_screenshot_artifact(artifact):
            url = _artifact_signed_url(artifact)
            if url:
                return url
    return ""


def _artifact_id(artifact: dict[str, Any]) -> str:
    for key in ("artifact_id", "artifactId", "id"):
        value = artifact.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _normalize_artifact_ref(value: Any) -> str:
    if not isinstance(value, str) or not value:
        return ""
    return value.removeprefix("artifact:")


def _is_screenshot_artifact(artifact: dict[str, Any]) -> bool:
    raw_type = artifact.get("type") or artifact.get("artifact_type") or artifact.get("artifactType")
    artifact_type = str(raw_type or "").lower()
    if artifact_type not in {"screenshot", "frame"}:
        return False
    mime_type = str(artifact.get("mime_type") or artifact.get("mimeType") or "").lower()
    return not mime_type or mime_type in {"image/png", "image/jpeg", "image/webp"}


def _artifact_signed_url(artifact: dict[str, Any]) -> str:
    for key in ("signed_url", "signedUrl", "presigned_url", "presignedUrl", "url", "public_url", "publicUrl"):
        value = artifact.get(key)
        if _is_http_url(value):
            return str(value)
    return ""


def _is_http_url(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    return value.startswith("https://") or value.startswith("http://")
