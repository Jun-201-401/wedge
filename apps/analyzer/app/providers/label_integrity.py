from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.providers.gms import GMSClient, GMSClientError

LABEL_INTEGRITY_SCHEMA_VERSION = "0.1"
LABEL_INTEGRITY_TASK_TYPE = "LABEL_INTEGRITY"
LABEL_INTEGRITY_ISSUE_TYPES = {
    "encoding_broken",
    "low_readability_rendering",
    "placeholder_garbage",
    "replacement_character",
    "text_clipped",
    "text_overlap",
    "text_truncated",
}
FIX_LEVERAGE_VALUES = (0.8, 0.95, 1.0, 1.15, 1.3)
MIN_LABEL_INTEGRITY_CONFIDENCE = 0.6


@dataclass(frozen=True)
class LabelIntegrityIssueResult:
    candidate_id: str
    has_issue: bool
    issue_type: str = "low_readability_rendering"
    reason: str = ""
    fix_leverage: float = 1.0
    confidence: float = 0.0
    source: str = "gms_image"
    affected_bounds: dict[str, Any] = field(default_factory=dict)
    provider_error: str | None = None

    def as_integrity_data(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "schema_version": LABEL_INTEGRITY_SCHEMA_VERSION,
            "task_type": LABEL_INTEGRITY_TASK_TYPE,
            "status": "issue" if self.has_issue else "ok",
            "issue_type": self.issue_type,
            "reason": self.reason,
            "source": self.source,
            "fix_leverage": self.fix_leverage,
            "confidence": self.confidence,
            "provider": {"type": "gms" if self.source == "gms_image" else "deterministic", "name": self.source},
        }
        if self.affected_bounds:
            data["affected_bounds"] = dict(self.affected_bounds)
        if self.provider_error:
            data["provider_error"] = self.provider_error
        return data


class LabelIntegrityProviderPort(Protocol):
    """Provider contract for label GMS enrichment.

    Implementations used with checkpoint parallelism must be safe for concurrent
    calls on the same provider instance or keep parallelism disabled.
    """
    def classify_label_integrity(
        self,
        *,
        scenario_goal: str,
        stage: str,
        checkpoint_id: str,
        screenshot_url: str,
        candidates: list[dict[str, Any]],
    ) -> list[LabelIntegrityIssueResult]:
        ...


class GMSLabelIntegrityProvider:
    provider_name = "gms_label_integrity_provider"

    def __init__(
        self,
        client: GMSClient | None = None,
        *,
        enabled: bool = True,
        min_confidence: float = MIN_LABEL_INTEGRITY_CONFIDENCE,
    ) -> None:
        self._client = client or GMSClient(feature="label_integrity")
        self._enabled = enabled
        self._min_confidence = min_confidence

    @classmethod
    def from_env(cls) -> "GMSLabelIntegrityProvider":
        return cls()

    def classify_label_integrity(
        self,
        *,
        scenario_goal: str,
        stage: str,
        checkpoint_id: str,
        screenshot_url: str,
        candidates: list[dict[str, Any]],
    ) -> list[LabelIntegrityIssueResult]:
        if not self._enabled or not candidates or not screenshot_url:
            return []
        prompt = build_label_integrity_prompt(
            scenario_goal=scenario_goal,
            stage=stage,
            checkpoint_id=checkpoint_id,
            candidates=candidates,
        )
        try:
            raw_text = self._client.generate_with_image(prompt=prompt, image_url=screenshot_url)
        except GMSClientError:
            return []
        return sanitize_label_integrity_response(
            raw_text,
            candidate_ids={str(candidate.get("candidate_id")) for candidate in candidates},
            min_confidence=self._min_confidence,
        )


def build_label_integrity_prompt(
    *,
    scenario_goal: str,
    stage: str,
    checkpoint_id: str,
    candidates: list[dict[str, Any]],
) -> str:
    candidate_json = json.dumps(candidates, ensure_ascii=False, sort_keys=True)
    return (
        "You are Wedge's label integrity judge.\n"
        "Use the screenshot image and observation candidates together.\n"
        "Judge only whether visible text is readable and visually intact.\n"
        "Do not judge whether the label is semantically appropriate for the element role.\n"
        "Do not judge visual beauty, brand tone, marketing quality, vague copy, or label-role mismatch.\n"
        "Do not invent elements that are not visible in the screenshot or not listed in candidates.\n"
        "Return valid JSON only. Do not use markdown or extra commentary.\n"
        "Allowed issue_type values: encoding_broken, replacement_character, placeholder_garbage, "
        "text_truncated, text_clipped, text_overlap, low_readability_rendering.\n"
        "fix_leverage must be exactly one of: 0.8, 0.95, 1.0, 1.15, 1.3.\n"
        "Use fix_leverage as the likely reduction in user confusion or conversion friction if text integrity is fixed:\n"
        "- 0.8: issue is in a low-importance auxiliary area.\n"
        "- 0.95: issue is possible but visual/location evidence is weak.\n"
        "- 1.0: ordinary readability/integrity issue with moderate flow impact.\n"
        "- 1.15: important button/input/click-path text; fixing it likely improves the flow.\n"
        "- 1.3: core action/input/commit text is unreadable, clipped, or overlapped; a small fix can remove major friction.\n"
        f"Scenario goal: {scenario_goal or 'unknown'}\n"
        f"Stage: {stage}\n"
        f"Checkpoint: {checkpoint_id}\n"
        f"Candidates JSON: {candidate_json}\n"
        "Return this JSON shape exactly:\n"
        "{\n"
        '  "issues": [\n'
        "    {\n"
        '      "candidate_id": "string",\n'
        '      "has_issue": true,\n'
        '      "issue_type": "text_clipped",\n'
        '      "reason": "string",\n'
        '      "fix_leverage": 1.15,\n'
        '      "confidence": 0.0,\n'
        '      "affected_bounds": {"x": 0, "y": 0, "width": 0, "height": 0}\n'
        "    }\n"
        "  ]\n"
        "}\n"
    )


def sanitize_label_integrity_response(
    raw_text: str,
    *,
    candidate_ids: set[str],
    min_confidence: float = MIN_LABEL_INTEGRITY_CONFIDENCE,
) -> list[LabelIntegrityIssueResult]:
    payload = _parse_json_object(raw_text)
    raw_issues = payload.get("issues")
    if not isinstance(raw_issues, list):
        return []

    results: list[LabelIntegrityIssueResult] = []
    seen: set[str] = set()
    for raw_issue in raw_issues:
        result = sanitize_label_integrity_issue(
            raw_issue,
            candidate_ids=candidate_ids,
            min_confidence=min_confidence,
        )
        if result is None or result.candidate_id in seen:
            continue
        seen.add(result.candidate_id)
        results.append(result)
    return results


def sanitize_label_integrity_issue(
    raw_issue: Any,
    *,
    candidate_ids: set[str],
    min_confidence: float = MIN_LABEL_INTEGRITY_CONFIDENCE,
) -> LabelIntegrityIssueResult | None:
    if not isinstance(raw_issue, dict):
        return None
    candidate_id = str(raw_issue.get("candidate_id") or "")
    if candidate_id not in candidate_ids:
        return None
    if raw_issue.get("has_issue") is not True:
        return None
    issue_type = str(raw_issue.get("issue_type") or "").strip()
    if issue_type not in LABEL_INTEGRITY_ISSUE_TYPES:
        return None
    confidence = _clamp_confidence(raw_issue.get("confidence"))
    if confidence < min_confidence:
        return None
    fix_leverage = _sanitize_fix_leverage(raw_issue.get("fix_leverage"))
    if fix_leverage is None:
        return None
    return LabelIntegrityIssueResult(
        candidate_id=candidate_id,
        has_issue=True,
        issue_type=issue_type,
        reason=_short_string(raw_issue.get("reason"), max_length=240),
        fix_leverage=fix_leverage,
        confidence=confidence,
        source="gms_image",
        affected_bounds=_sanitize_bounds(raw_issue.get("affected_bounds")),
    )


def _parse_json_object(raw_text: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError:
        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start < 0 or end <= start:
            return {}
        try:
            payload = json.loads(raw_text[start : end + 1])
        except json.JSONDecodeError:
            return {}
    return payload if isinstance(payload, dict) else {}


def _sanitize_fix_leverage(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    for allowed in FIX_LEVERAGE_VALUES:
        if abs(number - allowed) < 0.0001:
            return allowed
    return None


def _clamp_confidence(value: Any) -> float:
    if isinstance(value, bool):
        return 0.0
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(number):
        return 0.0
    return max(0.0, min(1.0, number))


def _short_string(value: Any, *, max_length: int) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_length]


def _sanitize_bounds(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    bounds: dict[str, Any] = {}
    for key in ("x", "y", "width", "height"):
        raw = value.get(key)
        if isinstance(raw, bool):
            continue
        try:
            number = float(raw)
        except (TypeError, ValueError):
            continue
        if math.isfinite(number):
            bounds[key] = int(number) if number.is_integer() else number
    return bounds if {"x", "y", "width", "height"}.issubset(bounds) else {}
