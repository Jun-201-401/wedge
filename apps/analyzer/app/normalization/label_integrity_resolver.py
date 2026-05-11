from __future__ import annotations

import copy
import re
from typing import Any

from app.providers import LabelIntegrityIssueResult, LabelIntegrityProviderPort
from app.stage.stage_resolver import StageResolver

LABEL_INTEGRITY_OBSERVATION_TYPES = {
    "first_view_message",
    "value_proposition",
    "feature_summary",
    "cta_candidate",
    "interactive_components",
    "form_field",
    "form_error",
    "required_field",
    "missing_label",
    "error_recovery",
    "final_submit_candidate",
    "other",
}
HIGH_IMPACT_STAGES = {"CTA", "INPUT", "COMMIT"}
MOJIBAKE_PATTERN = re.compile(r"(?:Ã.|Â.|ì.|ë.|í.|ê.)")


class LabelIntegrityResolver:
    """Add deterministic and optional GMS image text-integrity signals."""

    def __init__(
        self,
        provider: LabelIntegrityProviderPort | None = None,
        resolver: StageResolver | None = None,
    ) -> None:
        self._provider = provider
        self._resolver = resolver or StageResolver()

    def enrich_packet(self, packet: dict[str, Any]) -> dict[str, Any]:
        enriched = copy.deepcopy(packet)
        artifacts_by_id = _artifacts_by_id(enriched.get("artifacts"))
        scenario_goal = _scenario_goal(enriched)

        for checkpoint in enriched.get("checkpoints") or []:
            if not isinstance(checkpoint, dict):
                continue
            checkpoint_id = str(checkpoint.get("checkpoint_id") or "unknown_checkpoint")
            stage = self._resolver.resolve_checkpoint_stage(checkpoint)
            candidates, target_index = self._candidates_for_checkpoint(checkpoint)
            if not candidates:
                continue

            deterministic_ids = self._apply_deterministic_results(candidates, target_index)
            if self._provider is None:
                continue

            screenshot_url = _screenshot_url_for_checkpoint(checkpoint, artifacts_by_id)
            if not screenshot_url:
                continue
            gms_candidates = [
                candidate
                for candidate in candidates
                if candidate["candidate_id"] not in deterministic_ids and isinstance(candidate.get("bounds"), dict)
            ]
            if not gms_candidates:
                continue
            results = self._provider.classify_label_integrity(
                scenario_goal=scenario_goal,
                stage=stage,
                checkpoint_id=checkpoint_id,
                screenshot_url=screenshot_url,
                candidates=gms_candidates,
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
            if observation.get("type") not in LABEL_INTEGRITY_OBSERVATION_TYPES:
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

    def _apply_deterministic_results(
        self,
        candidates: list[dict[str, Any]],
        target_index: dict[str, dict[str, Any]],
    ) -> set[str]:
        applied_ids: set[str] = set()
        for candidate in candidates:
            target = target_index.get(str(candidate.get("candidate_id") or ""))
            if target is None:
                continue
            result = _deterministic_integrity_issue(candidate, target)
            if result is None:
                continue
            target["label_integrity"] = result.as_integrity_data()
            target["integrity_issue_type"] = result.issue_type
            target["fix_leverage"] = result.fix_leverage
            applied_ids.add(result.candidate_id)
        return applied_ids

    def _apply_results(
        self,
        results: list[LabelIntegrityIssueResult],
        target_index: dict[str, dict[str, Any]],
    ) -> None:
        for result in results:
            target = target_index.get(result.candidate_id)
            if target is None:
                continue
            target["label_integrity"] = result.as_integrity_data()
            target["integrity_issue_type"] = result.issue_type
            target["fix_leverage"] = result.fix_leverage


def _deterministic_integrity_issue(
    candidate: dict[str, Any],
    data: dict[str, Any],
) -> LabelIntegrityIssueResult | None:
    text = str(candidate.get("text") or "")
    issue_type: str | None = None
    reason = ""
    confidence = 0.9

    if "\ufffd" in text:
        issue_type = "replacement_character"
        reason = "라벨에 대체 문자가 포함되어 문구를 정상적으로 읽기 어렵습니다."
    elif _looks_like_mojibake(text):
        issue_type = "encoding_broken"
        reason = "라벨에 인코딩이 깨진 흔적이 있어 의미를 읽기 어렵습니다."
    elif _looks_like_placeholder_garbage(text):
        issue_type = "placeholder_garbage"
        reason = "라벨이 반복 기호나 의미 없는 대체 문자처럼 보여 기능을 읽기 어렵습니다."
    elif _bool_value(data, "text_overlap") or _bool_value(data, "overlaps_text"):
        issue_type = "text_overlap"
        reason = "라벨이 다른 텍스트와 겹치는 신호가 있어 읽기 어렵습니다."
    elif _bool_value(data, "text_clipped") or _bool_value(data, "clipped_text"):
        issue_type = "text_clipped"
        reason = "라벨이 요소 영역 안에서 잘린 신호가 있어 전체 문구를 읽기 어렵습니다."
    elif _bool_value(data, "is_truncated") or _bool_value(data, "text_truncated") or _bool_value(data, "text_overflow"):
        issue_type = "text_truncated"
        reason = "라벨이 말줄임 또는 넘침 처리되어 전체 행동을 읽기 어렵습니다."
    elif _looks_truncated(text) and _is_actionable(candidate):
        issue_type = "text_truncated"
        reason = "행동 요소의 라벨이 말줄임으로 끝나 전체 행동을 읽기 어렵습니다."
        confidence = 0.78

    if issue_type is None:
        return None

    return LabelIntegrityIssueResult(
        candidate_id=str(candidate.get("candidate_id") or ""),
        has_issue=True,
        issue_type=issue_type,
        reason=reason,
        fix_leverage=_fix_leverage(candidate),
        confidence=confidence,
        source="deterministic",
        affected_bounds=_bounds(candidate.get("bounds")),
    )


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


def _looks_like_mojibake(text: str) -> bool:
    return bool(MOJIBAKE_PATTERN.search(text))


def _looks_like_placeholder_garbage(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    if any(char in stripped for char in ("□", "�")):
        return True
    if stripped.count("?") >= 3 and len(stripped.replace("?", "").strip()) <= 1:
        return True
    symbol_count = sum(1 for char in stripped if not char.isalnum() and not char.isspace())
    return len(stripped) <= 6 and symbol_count / max(len(stripped), 1) >= 0.8


def _looks_truncated(text: str) -> bool:
    stripped = text.strip()
    return stripped.endswith("...") or stripped.endswith("…")


def _is_actionable(candidate: dict[str, Any]) -> bool:
    role = str(candidate.get("role") or "").lower()
    tag = str(candidate.get("tag") or "").lower()
    component_type = str(candidate.get("component_type") or "").lower()
    return (
        role in {"button", "link", "textbox", "combobox", "checkbox", "radio"}
        or tag in {"button", "a", "input", "select", "textarea"}
        or component_type in {"button", "link", "input", "field"}
        or candidate.get("is_cta_candidate") is True
        or candidate.get("clicked_in_scenario") is True
    )


def _fix_leverage(candidate: dict[str, Any]) -> float:
    provided = _allowed_fix_leverage(candidate.get("fix_leverage"))
    if provided is not None:
        return provided

    stage = str(candidate.get("stage") or "")
    prominence = _visual_prominence(candidate)
    path_related = candidate.get("clicked_in_scenario") is True or candidate.get("is_primary_like") is True
    has_position = isinstance(candidate.get("bounds"), dict)

    if prominence == "low" and not path_related:
        return 0.8
    if not has_position:
        return 0.95
    if stage in HIGH_IMPACT_STAGES and path_related and prominence == "high":
        return 1.3
    if path_related or prominence == "high" or stage in {"CTA", "COMMIT"}:
        return 1.15
    return 1.0


def _visual_prominence(candidate: dict[str, Any]) -> str:
    value = str(candidate.get("visual_prominence") or candidate.get("prominence") or "").lower()
    if value in {"low", "medium", "high"}:
        return value
    if candidate.get("clicked_in_scenario") is True or candidate.get("is_primary_like") is True:
        return "high"
    return "medium"


def _allowed_fix_leverage(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    for allowed in (0.8, 0.95, 1.0, 1.15, 1.3):
        if abs(number - allowed) < 0.0001:
            return allowed
    return None


def _bounds(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _bool_value(data: dict[str, Any], key: str) -> bool:
    return data.get(key) is True


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
