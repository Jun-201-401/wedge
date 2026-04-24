from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

SCENARIO_RELEVANCE_LABELS = {
    "DIRECT_GOAL_ACTION",
    "RELATED_GOAL_ACTION",
    "PREREQUISITE_ACTION",
    "EXPLORATORY_ACTION",
    "AUXILIARY_ACTION",
    "IRRELEVANT_ACTION",
    "UNKNOWN",
}

ACTION_SPECIFICITY_LABELS = {
    "SPECIFIC_ACTION",
    "GENERIC_BUT_ACTIONABLE",
    "PROGRESSION_ONLY",
    "EXPLORATORY_LABEL",
    "WEAK_OR_ICON_ONLY",
    "NO_LABEL",
    "UNKNOWN",
}


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

    def as_observation_data(self) -> dict[str, Any]:
        return {
            "target_observation_ref": self.target_observation_ref,
            "provider_type": self.provider_type,
            "provider_name": self.provider_name,
            "confidence": self.confidence,
            "labels": dict(self.labels),
        }


class SemanticProviderPort(Protocol):
    """Semantic normalization port.

    Implementations may use lexicons, internal LLMs, MCP, or mocks, but they must
    only return labels. They must not return UX issues or rule scores.
    """

    def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str) -> SemanticLabelResult:
        ...


class DeterministicLexiconProvider:
    provider_type = "deterministic"
    provider_name = "deterministic_lexicon_v0"

    _direct_terms = (
        "무료 가입",
        "무료 체험",
        "가입",
        "구매",
        "문의",
        "데모",
        "상담",
        "시작",
        "start free",
        "book demo",
        "contact sales",
        "sign up",
    )
    _irrelevant_terms = ("채용", "블로그", "회사소개", "로그인", "blog", "careers", "login")
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
        elif any(term in normalized for term in self._direct_terms):
            labels = {
                "scenario_relevance_label": "DIRECT_GOAL_ACTION",
                "action_specificity_label": "SPECIFIC_ACTION",
            }
            confidence = 0.9
        elif any(term in normalized for term in self._exploratory_terms):
            labels = {
                "scenario_relevance_label": "RELATED_GOAL_ACTION",
                "action_specificity_label": "EXPLORATORY_LABEL",
            }
            confidence = 0.75
        else:
            labels = {
                "scenario_relevance_label": "UNKNOWN",
                "action_specificity_label": "UNKNOWN",
            }
            confidence = 0.5

        return SemanticLabelResult(
            target_observation_ref=target_ref,
            provider_type=self.provider_type,
            provider_name=self.provider_name,
            labels=labels,
            confidence=confidence,
        )


class MockSemanticProvider:
    def __init__(self, results: dict[str, SemanticLabelResult] | None = None) -> None:
        self._results = results or {}

    def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str) -> SemanticLabelResult:
        return self._results.get(
            target_ref,
            SemanticLabelResult(
                target_observation_ref=target_ref,
                provider_type="mock",
                provider_name="mock_semantic_provider",
                labels={
                    "scenario_relevance_label": "UNKNOWN",
                    "action_specificity_label": "UNKNOWN",
                },
                confidence=0.5,
            ),
        )
