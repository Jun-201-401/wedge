from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.providers.gms import GMSClient, GMSClientError

LABEL_ROLE_SCHEMA_VERSION = "0.1"
LABEL_ROLE_TASK_TYPE = "LABEL_ROLE_ALIGNMENT"
LABEL_ROLE_ISSUE_TYPES = {
    "intent_mismatch",
    "irrelevant_label",
    "label_role_mismatch",
    "misleading_copy",
    "misleading_label",
    "unclear_label",
}
FIX_LEVERAGE_VALUES = (0.8, 0.95, 1.0, 1.15, 1.3)
MIN_LABEL_ROLE_CONFIDENCE = 0.6


@dataclass(frozen=True)
class LabelRoleIssueResult:
    candidate_id: str
    has_issue: bool
    issue_type: str = "label_role_mismatch"
    expected_meaning: str = ""
    reason: str = ""
    fix_leverage: float = 1.0
    confidence: float = 0.0
    affected_bounds: dict[str, Any] = field(default_factory=dict)
    provider_error: str | None = None

    def as_alignment_data(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "schema_version": LABEL_ROLE_SCHEMA_VERSION,
            "task_type": LABEL_ROLE_TASK_TYPE,
            "status": "mismatch" if self.has_issue else "aligned",
            "issue_type": self.issue_type,
            "expected_meaning": self.expected_meaning,
            "reason": self.reason,
            "fix_leverage": self.fix_leverage,
            "confidence": self.confidence,
            "provider": {"type": "gms", "name": "gms_label_role_provider"},
        }
        if self.affected_bounds:
            data["affected_bounds"] = dict(self.affected_bounds)
        if self.provider_error:
            data["provider_error"] = self.provider_error
        return data


class LabelRoleProviderPort(Protocol):
    """Provider contract for label GMS enrichment.

    Implementations used with checkpoint parallelism must be safe for concurrent
    calls on the same provider instance or keep parallelism disabled.
    """
    def classify_label_roles(
        self,
        *,
        scenario_goal: str,
        stage: str,
        checkpoint_id: str,
        screenshot_url: str,
        candidates: list[dict[str, Any]],
    ) -> list[LabelRoleIssueResult]:
        ...


class GMSLabelRoleProvider:
    provider_name = "gms_label_role_provider"

    def __init__(
        self,
        client: GMSClient | None = None,
        *,
        enabled: bool = True,
        min_confidence: float = MIN_LABEL_ROLE_CONFIDENCE,
    ) -> None:
        self._client = client or GMSClient(feature="label_role")
        self._enabled = enabled
        self._min_confidence = min_confidence

    @classmethod
    def from_env(cls) -> "GMSLabelRoleProvider":
        return cls()

    def classify_label_roles(
        self,
        *,
        scenario_goal: str,
        stage: str,
        checkpoint_id: str,
        screenshot_url: str,
        candidates: list[dict[str, Any]],
    ) -> list[LabelRoleIssueResult]:
        if not self._enabled or not candidates or not screenshot_url:
            return []
        prompt = build_label_role_prompt(
            scenario_goal=scenario_goal,
            stage=stage,
            checkpoint_id=checkpoint_id,
            candidates=candidates,
        )
        try:
            raw_text = self._client.generate_with_image(prompt=prompt, image_url=screenshot_url)
        except GMSClientError:
            return []
        return sanitize_label_role_response(
            raw_text,
            candidate_ids={str(candidate.get("candidate_id")) for candidate in candidates},
            min_confidence=self._min_confidence,
        )


def build_label_role_prompt(
    *,
    scenario_goal: str,
    stage: str,
    checkpoint_id: str,
    candidates: list[dict[str, Any]],
) -> str:
    candidate_json = json.dumps(candidates, ensure_ascii=False, sort_keys=True)
    return (
        "You are Wedge's label-role alignment judge.\n"
        "Use the screenshot image and the observation candidates together.\n"
        "Judge only whether a visible label correctly explains the UI element's role, function, or surrounding context.\n"
        "Do not judge visual beauty, marketing copy quality, broken text, encoding errors, OCR errors, or clipped text.\n"
        "Do not invent elements that are not visible in the screenshot or not listed in candidates.\n"
        "Return valid JSON only. Do not use markdown or extra commentary.\n"
        "Allowed issue_type values: intent_mismatch, irrelevant_label, label_role_mismatch, misleading_copy, "
        "misleading_label, unclear_label.\n"
        "fix_leverage must be exactly one of: 0.8, 0.95, 1.0, 1.15, 1.3.\n"
        "Use fix_leverage as the likely reduction in user confusion or conversion friction if this label is fixed:\n"
        "- 0.8: issue is in a low-importance auxiliary area.\n"
        "- 0.95: mismatch is possible but role/location evidence is weak.\n"
        "- 1.0: ordinary label-role mismatch with moderate flow impact.\n"
        "- 1.15: important button/input/click-path label; fixing it likely improves the flow.\n"
        "- 1.3: core action/input/commit label strongly contradicts its role; a small fix can remove major friction.\n"
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
        '      "issue_type": "label_role_mismatch",\n'
        '      "expected_meaning": "string",\n'
        '      "reason": "string",\n'
        '      "fix_leverage": 1.15,\n'
        '      "confidence": 0.0,\n'
        '      "affected_bounds": {"x": 0, "y": 0, "width": 0, "height": 0}\n'
        "    }\n"
        "  ]\n"
        "}\n"
    )


def sanitize_label_role_response(
    raw_text: str,
    *,
    candidate_ids: set[str],
    min_confidence: float = MIN_LABEL_ROLE_CONFIDENCE,
) -> list[LabelRoleIssueResult]:
    payload = _parse_json_object(raw_text)
    raw_issues = payload.get("issues")
    if not isinstance(raw_issues, list):
        return []

    results: list[LabelRoleIssueResult] = []
    seen: set[str] = set()
    for raw_issue in raw_issues:
        result = sanitize_label_role_issue(
            raw_issue,
            candidate_ids=candidate_ids,
            min_confidence=min_confidence,
        )
        if result is None or result.candidate_id in seen:
            continue
        seen.add(result.candidate_id)
        results.append(result)
    return results


def sanitize_label_role_issue(
    raw_issue: Any,
    *,
    candidate_ids: set[str],
    min_confidence: float = MIN_LABEL_ROLE_CONFIDENCE,
) -> LabelRoleIssueResult | None:
    if not isinstance(raw_issue, dict):
        return None
    candidate_id = str(raw_issue.get("candidate_id") or "")
    if candidate_id not in candidate_ids:
        return None
    if raw_issue.get("has_issue") is not True:
        return None
    issue_type = str(raw_issue.get("issue_type") or "").strip()
    if issue_type not in LABEL_ROLE_ISSUE_TYPES:
        return None
    confidence = _clamp_confidence(raw_issue.get("confidence"))
    if confidence < min_confidence:
        return None
    fix_leverage = _sanitize_fix_leverage(raw_issue.get("fix_leverage"))
    if fix_leverage is None:
        return None
    return LabelRoleIssueResult(
        candidate_id=candidate_id,
        has_issue=True,
        issue_type=issue_type,
        expected_meaning=_short_string(raw_issue.get("expected_meaning"), max_length=80),
        reason=_short_string(raw_issue.get("reason"), max_length=240),
        fix_leverage=fix_leverage,
        confidence=confidence,
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
