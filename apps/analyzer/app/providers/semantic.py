from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from app.contracts import semantic_enum, semantic_label_keys, semantic_schema_version, semantic_task_type

SEMANTIC_CLASSIFICATION_SCHEMA_VERSION = semantic_schema_version()
SEMANTIC_TASK_TYPE_CTA = semantic_task_type()
SCENARIO_RELEVANCE_LABELS = semantic_enum("scenario_relevance_label")
ACTION_SPECIFICITY_LABELS = semantic_enum("action_specificity_label")
PAGE_TYPE_LABELS = semantic_enum("page_type_label")
PROVIDER_TYPES = semantic_enum("provider_type")

_LABEL_ALLOWLISTS = {
    key: semantic_enum(key)
    for key in semantic_label_keys()
}

_UNKNOWN_LABELS = {
    "scenario_relevance_label": "UNKNOWN",
    "action_specificity_label": "UNKNOWN",
}

SEMANTIC_FALLBACK_CONFIDENCE_MIN = 0.60
UnsafeSemanticClassifier = Callable[..., Any]


@dataclass(frozen=True)
class SemanticLabelResult:
    """Provider output limited to labels and provider confidence.

    The Rule Engine owns final stage/severity/confidence/priority/evidence_refs.
    """

    target_observation_ref: str
    provider_type: str
    provider_name: str
    labels: dict[str, str] = field(default_factory=dict)
    confidence: float = 0.0
    provider_error: str | None = None

    def as_observation_data(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "schema_version": SEMANTIC_CLASSIFICATION_SCHEMA_VERSION,
            "task_type": SEMANTIC_TASK_TYPE_CTA,
            "target_observation_ref": self.target_observation_ref,
            "provider": {
                "type": self.provider_type,
                "name": self.provider_name,
            },
            "confidence": self.confidence,
            "labels": dict(self.labels),
        }
        if self.provider_error:
            data["provider_error"] = self.provider_error
        return data


class SemanticProviderPort(Protocol):
    """Trusted semantic normalization port.

    Public providers return sanitized label results. Adapter classes may wrap an
    unsafe dict-producing callable, but raw dicts do not cross this port.
    """

    def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str) -> SemanticLabelResult:
        ...


class FastPathLexiconProvider:
    """High-precision lexical provider for obvious CTA phrases.

    This is intentionally not a recall-oriented normalizer. Ambiguous or unseen
    copy should remain UNKNOWN so an LLM/MCP fallback can classify it behind the
    label-only sanitizer.
    """

    provider_type = "deterministic"
    provider_name = "fast_path_lexicon_v1"

    _direct_terms = (
        "무료 가입",
        "무료 체험",
        "무료 체험 시작",
        "상담 신청",
        "상담 예약",
        "데모 예약",
        "book demo",
        "contact sales",
        "start free trial",
        "sign up free",
    )
    _irrelevant_terms = ("채용", "블로그", "회사소개", "blog", "careers")
    _auxiliary_terms = ("로그인", "login")
    _exploratory_terms = ("더 알아보기", "자세히", "혜택 보기", "learn more", "see benefits")

    def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str) -> SemanticLabelResult:
        normalized = text.strip().lower()
        labels: dict[str, str]
        confidence: float

        if not normalized:
            labels = {
                "scenario_relevance_label": "UNKNOWN",
                "action_specificity_label": "NO_LABEL",
            }
            confidence = 0.4
        elif any(term in normalized for term in self._irrelevant_terms):
            labels = {
                "scenario_relevance_label": "IRRELEVANT_ACTION",
                "action_specificity_label": "EXPLORATORY_LABEL",
            }
            confidence = 0.85
        elif any(term in normalized for term in self._auxiliary_terms):
            labels = {
                "scenario_relevance_label": "AUXILIARY_ACTION",
                "action_specificity_label": "PROGRESSION_ONLY",
            }
            confidence = 0.85
        elif any(term in normalized for term in self._direct_terms):
            labels = {
                "scenario_relevance_label": "DIRECT_GOAL_ACTION",
                "action_specificity_label": "SPECIFIC_ACTION",
            }
            confidence = 0.9
        elif any(term in normalized for term in self._exploratory_terms):
            labels = dict(_UNKNOWN_LABELS)
            confidence = 0.5
        else:
            labels = dict(_UNKNOWN_LABELS)
            confidence = 0.5

        return SemanticLabelResult(
            target_observation_ref=target_ref,
            provider_type=self.provider_type,
            provider_name=self.provider_name,
            labels=labels,
            confidence=confidence,
        )


class DeterministicLexiconProvider(FastPathLexiconProvider):
    """Backward-compatible name for the fast-path lexical provider."""


class InternalLLMProvider:
    """Adapter boundary for an internal LLM semantic classifier."""

    provider_type = "internal_llm"
    provider_name = "internal_llm_semantic_provider"

    def __init__(self, classifier: UnsafeSemanticClassifier | None = None) -> None:
        self._classifier = classifier

    def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str) -> SemanticLabelResult:
        if self._classifier is None:
            raise RuntimeError("InternalLLMProvider is not configured")
        return sanitize_semantic_label_result(
            self._classifier(text=text, scenario_goal=scenario_goal, target_ref=target_ref),
            target_ref=target_ref,
            provider_type=self.provider_type,
            provider_name=self.provider_name,
        )


class MCPSemanticProvider:
    """Adapter boundary for MCP semantic classification tools.

    MCP is restricted to label-only normalization and must not control browser
    actions or emit final Rule Engine fields.
    """

    provider_type = "mcp"
    provider_name = "mcp_semantic_provider"

    def __init__(self, classifier: UnsafeSemanticClassifier | None = None) -> None:
        self._classifier = classifier

    def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str) -> SemanticLabelResult:
        if self._classifier is None:
            raise RuntimeError("MCPSemanticProvider is not configured")
        return sanitize_semantic_label_result(
            self._classifier(text=text, scenario_goal=scenario_goal, target_ref=target_ref),
            target_ref=target_ref,
            provider_type=self.provider_type,
            provider_name=self.provider_name,
        )


class SemanticProviderChain:
    """Fast-path provider with optional semantic fallback for unknown labels."""

    def __init__(
        self,
        fast_path: SemanticProviderPort | None = None,
        fallback: SemanticProviderPort | None = None,
        *,
        min_confidence: float = SEMANTIC_FALLBACK_CONFIDENCE_MIN,
    ) -> None:
        self._fast_path = fast_path or FastPathLexiconProvider()
        self._fallback = fallback
        self._min_confidence = min_confidence

    def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str) -> SemanticLabelResult:
        fast_result = self._fast_path.classify_cta(text=text, scenario_goal=scenario_goal, target_ref=target_ref)
        if self._fallback is None or not should_fallback_to_semantic_provider(fast_result, min_confidence=self._min_confidence):
            return fast_result

        try:
            return self._fallback.classify_cta(text=text, scenario_goal=scenario_goal, target_ref=target_ref)
        except Exception:
            return SemanticLabelResult(
                target_observation_ref=target_ref,
                provider_type=fast_result.provider_type,
                provider_name=fast_result.provider_name,
                labels=dict(fast_result.labels),
                confidence=min(fast_result.confidence, self._min_confidence),
                provider_error="provider_unavailable",
            )


class MockSemanticProvider:
    def __init__(self, results: dict[str, SemanticLabelResult | dict[str, Any]] | None = None) -> None:
        self._results = results or {}
        self.calls: list[dict[str, str]] = []

    def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str) -> SemanticLabelResult:
        self.calls.append({"text": text, "scenario_goal": scenario_goal, "target_ref": target_ref})
        raw = self._results.get(
            target_ref,
            SemanticLabelResult(
                target_observation_ref=target_ref,
                provider_type="mock",
                provider_name="mock_semantic_provider",
                labels=dict(_UNKNOWN_LABELS),
                confidence=0.5,
            ),
        )
        return sanitize_semantic_label_result(
            raw,
            target_ref=target_ref,
            provider_type="mock",
            provider_name="mock_semantic_provider",
        )


def should_fallback_to_semantic_provider(
    result: SemanticLabelResult,
    *,
    min_confidence: float = SEMANTIC_FALLBACK_CONFIDENCE_MIN,
) -> bool:
    labels = result.labels
    return (
        result.confidence < min_confidence
        or labels.get("scenario_relevance_label") == "UNKNOWN"
        or labels.get("action_specificity_label") == "UNKNOWN"
    )


def sanitize_semantic_label_result(
    raw: Any,
    *,
    target_ref: str,
    provider_type: str = "unknown",
    provider_name: str = "unknown_provider",
) -> SemanticLabelResult:
    """Convert provider output to the label-only annotation contract.

    Unsupported top-level fields such as stage/severity/priority/evidence_refs
    are intentionally ignored by reading only the allowlisted fields below.
    Provider-controlled error details are also ignored at this boundary.
    """

    if isinstance(raw, SemanticLabelResult):
        labels = raw.labels
        confidence = raw.confidence
        sanitized_provider_type = _sanitize_provider_type(provider_type if provider_type != "unknown" else raw.provider_type)
        raw_provider_name = provider_name if provider_name != "unknown_provider" else raw.provider_name
        provider_error = _sanitize_provider_error(raw.provider_error)
    elif isinstance(raw, dict):
        labels = raw.get("labels") if isinstance(raw.get("labels"), dict) else raw
        confidence = raw.get("confidence", 0.0)
        sanitized_provider_type = _sanitize_provider_type(provider_type)
        raw_provider_name = provider_name
        provider_error = None
    else:
        labels = getattr(raw, "labels", {})
        confidence = getattr(raw, "confidence", 0.0)
        sanitized_provider_type = _sanitize_provider_type(provider_type)
        raw_provider_name = provider_name
        provider_error = None

    sanitized_labels = _sanitize_labels(labels)
    return SemanticLabelResult(
        target_observation_ref=target_ref,
        provider_type=sanitized_provider_type,
        provider_name=raw_provider_name,
        labels=sanitized_labels,
        confidence=_clamp_confidence(confidence),
        provider_error=provider_error,
    )


def _sanitize_provider_type(value: Any) -> str:
    if isinstance(value, str) and value in PROVIDER_TYPES:
        return value
    return "unknown"


def _sanitize_provider_error(value: Any) -> str | None:
    if value == "provider_unavailable":
        return "provider_unavailable"
    return None


def _sanitize_labels(raw_labels: Any) -> dict[str, str]:
    if not isinstance(raw_labels, dict):
        raw_labels = {}

    labels = dict(_UNKNOWN_LABELS)
    for key, allowed_values in _LABEL_ALLOWLISTS.items():
        value = raw_labels.get(key)
        if isinstance(value, str) and value in allowed_values:
            labels[key] = value
    return labels


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
