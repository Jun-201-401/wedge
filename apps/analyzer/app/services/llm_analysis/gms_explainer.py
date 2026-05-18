from __future__ import annotations

import copy
import json
import os
from dataclasses import dataclass
from typing import Any, Protocol

from app.providers.gms import GMSClient, GMSClientError, GMSConfig


class GMSExplanationClient(Protocol):
    def generate_text(self, *, prompt: str) -> str:
        ...


RULE_OWNED_FIELDS = {
    "issue_id",
    "criterion_id",
    "stage",
    "axis",
    "severity",
    "confidence",
    "priority_score",
    "evidence_refs",
}

EXPLANATION_FIELDS = {
    "title",
    "summary",
    "impact_hypothesis",
    "recommendations",
    "validation_questions",
}

NUDGE_TEXT_FIELDS = {
    "title",
    "rationale",
    "recommendation",
    "expected_effect",
    "validation_question",
}

VALID_DIFFICULTIES = {"LOW", "MEDIUM", "HIGH"}
GMS_REPORT_EXPLAINER_MAX_ATTEMPTS = 2
GMS_REPORT_COMPACT_PROMPT_ENV = "ANALYZER_GMS_REPORT_COMPACT_PROMPT_ENABLED"


@dataclass
class GMSReportExplainerTelemetry:
    """Safe scalar telemetry for report explainer timing logs.

    Keep these values out of JudgeResult so observability cannot change the
    report payload. Counts are intentionally scalar-only; raw prompts and
    responses must never be stored here.
    """

    enabled: bool = False
    client_configured: bool = False
    compact_prompt_enabled: bool = False
    prompt_char_count: int = 0
    full_prompt_char_count: int = 0
    response_char_count: int = 0
    attempt_count: int = 0
    fallback_used: bool = False
    last_error_type: str | None = None

    def to_phase_extra(self) -> dict[str, Any]:
        return {
            "gmsEnabled": self.enabled,
            "clientConfigured": self.client_configured,
            "compactPromptEnabled": self.compact_prompt_enabled,
            "promptCharCount": self.prompt_char_count,
            "fullPromptCharCount": self.full_prompt_char_count,
            "responseCharCount": self.response_char_count,
            "attemptCount": self.attempt_count,
            "fallbackUsed": self.fallback_used,
            "lastErrorType": self.last_error_type,
        }


class GMSReportExplainer:
    """Post-process deterministic JudgeResult text through GMS.

    The Rule Engine remains the owner of final judgment fields. GMS is allowed
    to rewrite report copy only, then the callback sends the polished
    JudgeResult.
    """

    def __init__(
        self,
        *,
        client: GMSExplanationClient | None = None,
        enabled: bool = False,
        model: str = "gpt-4.1-nano",
        compact_prompt_enabled: bool = False,
    ) -> None:
        self._client = client
        self._enabled = enabled
        self._model = model
        self._compact_prompt_enabled = compact_prompt_enabled

    @classmethod
    def from_env(cls) -> "GMSReportExplainer":
        config = GMSConfig.from_env()
        return cls(
            client=GMSClient(config, feature="report_explainer"),
            enabled=config.enabled,
            model=config.model,
            compact_prompt_enabled=_report_compact_prompt_enabled_from_env(),
        )

    def explain(
        self,
        judge_result: dict[str, Any],
        *,
        telemetry: GMSReportExplainerTelemetry | None = None,
    ) -> dict[str, Any]:
        telemetry = telemetry or GMSReportExplainerTelemetry()
        telemetry.enabled = self._enabled
        telemetry.client_configured = self._client is not None
        telemetry.compact_prompt_enabled = self._compact_prompt_enabled
        fallback_result = copy.deepcopy(judge_result)
        if not self._enabled:
            return fallback_result
        if self._client is None:
            telemetry.fallback_used = True
            return _append_llm_note(fallback_result, "GMS report explanation was enabled but no client was configured.")

        last_error: Exception | None = None
        for attempt in range(1, GMS_REPORT_EXPLAINER_MAX_ATTEMPTS + 1):
            result = copy.deepcopy(judge_result)
            try:
                full_prompt = _build_prompt(result)
                prompt = (
                    _build_prompt(result, compact_prompt_enabled=True)
                    if self._compact_prompt_enabled
                    else full_prompt
                )
                telemetry.full_prompt_char_count = len(full_prompt)
                telemetry.prompt_char_count = len(prompt)
                telemetry.attempt_count = attempt
                response_text = self._client.generate_text(prompt=prompt)
                telemetry.response_char_count = len(response_text)
                explanation = _parse_json_object(response_text)
                _apply_explanation(result, explanation)
                result["llm_provider"] = "gms"
                result["llm_model"] = self._model
                note = "GMS generated post-judgment report copy; Rule Engine fields were preserved."
                if attempt > 1:
                    note = f"{note} Succeeded after retry attempt {attempt}."
                return _append_llm_note(result, note)
            except (GMSClientError, ValueError, TypeError, KeyError) as exc:
                last_error = exc
                telemetry.last_error_type = type(exc).__name__

        error_name = type(last_error).__name__ if last_error is not None else "UnknownError"
        telemetry.fallback_used = True
        return _append_llm_note(
            fallback_result,
            f"GMS explanation fallback used deterministic text after {GMS_REPORT_EXPLAINER_MAX_ATTEMPTS} attempts: {error_name}",
        )


def _report_compact_prompt_enabled_from_env() -> bool:
    value = os.environ.get(GMS_REPORT_COMPACT_PROMPT_ENV)
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _build_prompt(judge_result: dict[str, Any], *, compact_prompt_enabled: bool = False) -> str:
    grounding_fields = (
        "evidence_refs and evidence_location_summary"
        if compact_prompt_enabled
        else "evidence_refs and evidence_locations"
    )
    compact = {
        "summary": judge_result.get("summary") or {},
        "issues": [
            {
                "issue_id": issue.get("issue_id"),
                "criterion_id": issue.get("criterion_id"),
                "stage": issue.get("stage"),
                "axis": issue.get("axis"),
                "severity": issue.get("severity"),
                "confidence": issue.get("confidence"),
                "priority_score": issue.get("priority_score"),
                "evidence_refs": issue.get("evidence_refs") or [],
                **_evidence_location_prompt_payload(issue, compact_prompt_enabled=compact_prompt_enabled),
                "title": issue.get("title"),
                "summary": issue.get("summary"),
                "impact_hypothesis": issue.get("impact_hypothesis"),
                "recommendations": issue.get("recommendations") or [],
                "validation_questions": issue.get("validation_questions") or [],
            }
            for issue in judge_result.get("issues") or []
            if isinstance(issue, dict)
        ],
        "decision_map": judge_result.get("decision_map") or [],
        "nudges": judge_result.get("nudges") or [],
        "scenario_mismatch_report": judge_result.get("scenario_mismatch_report"),
    }
    return (
        "You write Korean UX analysis report copy for Wedge.\n"
        "Return valid JSON only. Do not use markdown, code fences, or extra commentary.\n"
        "The input JudgeResult was produced by a deterministic Rule Engine. Do not change the analytical result, "
        "issue order, issue count, or rule-owned fields: issue_id, criterion_id, stage, axis, severity, confidence, "
        "priority_score, evidence_refs.\n"
        "Rewrite only report copy fields: title, summary, impact_hypothesis, recommendations, validation_questions, "
        "and nudge text fields.\n"
        f"Ground every claim in {grounding_fields}. Do not invent unsupported facts or expose internal "
        "ids such as evidence_ref, checkpoint_id, observation_id, selector, raw rule id, or criterion.\n"
        "Write concise natural Korean for non-technical readers such as small business owners, service operators, "
        "or teammates who do not know UX jargon. Explain the problem as if answering someone who asks, "
        "'비전공자도 이해할 수 있게 알려줘'. Avoid internal UX/system terms in user-facing copy: CTA, primary, "
        "primary-like, secondary, UX, evidence, selector, rule, criterion, grouping, target action, conversion, or friction. "
        "Use plain words like '버튼', '가장 중요한 버튼', '보조 버튼', '화면', '선택지', "
        "'사용자가 하려는 일', '헷갈릴 수 있는 부분', '고르기 어려운 상황'.\n"
        "summary must say where the issue appears, which visible components are involved, and how they make it "
        "harder for a user to understand, choose, or continue. Preserve the Rule Engine's original cause.\n"
        "impact_hypothesis must explain the causal chain and include the 'why', using hypothesis tone such as "
        "'~할 수 있습니다'.\n"
        "If component text is missing or garbled, describe it by visible role or location in plain Korean without "
        "guessing or exposing internal fields.\n"
        "Field intent:\n"

        "- title: short issue title, 20-35 Korean characters, problem-focused.\n"
        "- summary: what was observed and why it can confuse users or make the next step harder.\n"
        "- impact_hypothesis: likely user/business impact, stated as a hypothesis.\n"
        "- nudge.title: short improvement action title.\n"
        "- nudge.rationale: why this improvement follows from the evidence.\n"
        "  Do not write nudge.rationale with phrases like evidence id, evidence_ref, 감지되었습니다, primary-like, CTA, "
        "or rule hit. Explain the visible page reason in plain Korean, for example "
        "'첫 화면에서 주요 버튼처럼 보이는 선택지가 여러 개 함께 보여 사용자의 첫 선택이 나뉠 수 있습니다'.\n"
        "- nudge.recommendation: concrete UI/content change a designer or developer can apply.\n"
        "  Write nudge.recommendation as a gentle suggestion in plain Korean, not a command. End it with "
        "'~하는 게 어떤가요?' whenever natural.\n"
        "- nudge.expected_effect: expected improvement after the change.\n"
        "  nudge.expected_effect must start exactly with '위 추천을 통해 ' and must end with '~할 것 같아요.' "
        "Use a soft expectation tone, not firm endings like '~할 가능성이 높아집니다' or '~할 수 있습니다'.\n"
        "- nudge.validation_question: QA/usability question to verify the fix.\n"
        "Return this JSON shape exactly:\n"

        "{\n"
        '  "overall_summary": "string",\n'
        '  "issue_explanations": [\n'
        "    {\n"
        '      "issue_id": "issue_001",\n'
        '      "title": "string",\n'
        '      "summary": "string",\n'
        '      "impact_hypothesis": "string",\n'
        '      "recommendations": ["string"],\n'
        '      "validation_questions": ["string"],\n'
        '      "nudge": {\n'
        '        "title": "string",\n'
        '        "rationale": "string",\n'
        '        "recommendation": "string",\n'
        '        "difficulty": "LOW|MEDIUM|HIGH",\n'
        '        "expected_effect": "string",\n'
        '        "validation_question": "string"\n'
        "      }\n"
        "    }\n"
        "  ]\n"
        "}\n"
        f"JudgeResult JSON:\n{json.dumps(compact, ensure_ascii=False)}"
    )


def _evidence_location_prompt_payload(issue: dict[str, Any], *, compact_prompt_enabled: bool) -> dict[str, Any]:
    evidence_locations = issue.get("evidence_locations") or []
    if not compact_prompt_enabled:
        return {"evidence_locations": evidence_locations}
    return {"evidence_location_summary": _summarize_evidence_locations(evidence_locations)}


def _summarize_evidence_locations(evidence_locations: Any) -> dict[str, Any]:
    if not isinstance(evidence_locations, list):
        return {
            "count": 0,
            "types": [],
            "componentCount": 0,
            "visibleTexts": [],
            "roles": [],
            "hasBounds": False,
        }

    types: list[str] = []
    visible_texts: list[str] = []
    roles: list[str] = []
    component_count = 0
    has_bounds = False
    for location in evidence_locations:
        if not isinstance(location, dict):
            continue
        _append_unique(types, _non_empty_string(location.get("type")), limit=8)
        top_level_had_context = _summarize_evidence_context(
            location,
            visible_texts=visible_texts,
            roles=roles,
        )
        has_bounds = has_bounds or isinstance(location.get("bounds"), dict)

        child_count = 0
        for child_key in ("components", "problem_components", "items", "product_cards"):
            children = location.get(child_key)
            if not isinstance(children, list):
                continue
            for child in children:
                if not isinstance(child, dict):
                    continue
                child_count += 1
                has_bounds = has_bounds or isinstance(child.get("bounds"), dict)
                _summarize_evidence_context(
                    child,
                    visible_texts=visible_texts,
                    roles=roles,
                )

        component_count += child_count
        if child_count == 0 and top_level_had_context:
            component_count += 1

    return {
        "count": len([location for location in evidence_locations if isinstance(location, dict)]),
        "types": types,
        "componentCount": component_count,
        "visibleTexts": visible_texts,
        "roles": roles,
        "hasBounds": has_bounds,
    }


def _summarize_evidence_context(
    payload: dict[str, Any],
    *,
    visible_texts: list[str],
    roles: list[str],
) -> bool:
    """Collect compact, non-coordinate context from one evidence-like payload."""

    has_context = False
    role = _non_empty_string(payload.get("role"))
    _append_unique(roles, role, limit=8)
    if role:
        has_context = True
    for key in (
        "text",
        "visible_text",
        "label",
        "name",
        "accessible_name",
        "aria_label",
        "title",
    ):
        value = _non_empty_string(payload.get(key))
        _append_unique(visible_texts, value, limit=12)
        has_context = has_context or value is not None
    return has_context or isinstance(payload.get("bounds"), dict)


def _parse_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = _strip_code_fence(stripped)
    payload = json.loads(stripped)
    if not isinstance(payload, dict):
        raise ValueError("GMS explanation must be a JSON object")
    return payload


def _strip_code_fence(text: str) -> str:
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _apply_explanation(result: dict[str, Any], explanation: dict[str, Any]) -> None:
    overall_summary = _non_empty_string(explanation.get("overall_summary"))
    if overall_summary:
        summary = result.setdefault("summary", {})
        if isinstance(summary, dict):
            summary["llm_overall_summary"] = overall_summary

    issues = result.get("issues")
    if not isinstance(issues, list):
        return
    issue_by_id = {
        str(issue.get("issue_id")): issue
        for issue in issues
        if isinstance(issue, dict) and issue.get("issue_id")
    }
    raw_explanations = explanation.get("issue_explanations")
    if not isinstance(raw_explanations, list):
        return

    nudge_explanations_by_issue_id: dict[str, dict[str, Any]] = {}
    for raw_item in raw_explanations:
        if not isinstance(raw_item, dict):
            continue
        issue_id = str(raw_item.get("issue_id"))
        issue = issue_by_id.get(issue_id)
        if issue is None:
            continue
        before = {field: copy.deepcopy(issue.get(field)) for field in RULE_OWNED_FIELDS}
        _apply_issue_text(issue, raw_item)
        for field, value in before.items():
            issue[field] = value
        raw_nudge = raw_item.get("nudge")
        if isinstance(raw_nudge, dict):
            nudge_explanations_by_issue_id[issue_id] = raw_nudge

    _sync_nudges_from_issues(result, nudge_explanations_by_issue_id)


def _apply_issue_text(issue: dict[str, Any], raw_item: dict[str, Any]) -> None:
    for field in EXPLANATION_FIELDS:
        if field in {"recommendations", "validation_questions"}:
            values = _string_list(raw_item.get(field))
            if values:
                issue[field] = values
            continue
        value = _non_empty_string(raw_item.get(field))
        if value:
            issue[field] = value


def _sync_nudges_from_issues(
    result: dict[str, Any],
    nudge_explanations_by_issue_id: dict[str, dict[str, Any]] | None = None,
) -> None:
    nudge_explanations_by_issue_id = nudge_explanations_by_issue_id or {}
    issues = {
        str(issue.get("issue_id")): issue
        for issue in result.get("issues") or []
        if isinstance(issue, dict) and issue.get("issue_id")
    }
    nudges = result.get("nudges")
    if not isinstance(nudges, list):
        return
    for nudge in nudges:
        if not isinstance(nudge, dict):
            continue
        issue_id = str(nudge.get("issue_id"))
        issue = issues.get(issue_id)
        if issue is None:
            continue
        applied_fields = _apply_nudge_text(nudge, nudge_explanations_by_issue_id.get(issue_id, {}))
        summary = _non_empty_string(issue.get("title")) or _non_empty_string(issue.get("summary"))
        recommendations = _string_list(issue.get("recommendations"))
        questions = _string_list(issue.get("validation_questions"))
        if summary and "title" not in applied_fields:
            nudge["title"] = summary[:80]
        if recommendations and "recommendation" not in applied_fields:
            nudge["recommendation"] = recommendations[0]
        if questions and "validation_question" not in applied_fields:
            nudge["validation_question"] = questions[0]


def _apply_nudge_text(nudge: dict[str, Any], raw_item: dict[str, Any]) -> set[str]:
    applied_fields: set[str] = set()
    if not isinstance(raw_item, dict):
        return applied_fields

    for field in NUDGE_TEXT_FIELDS:
        value = _non_empty_string(raw_item.get(field))
        if value:
            nudge[field] = value
            applied_fields.add(field)

    difficulty = _non_empty_string(raw_item.get("difficulty"))
    if difficulty in VALID_DIFFICULTIES:
        nudge["difficulty"] = difficulty
        applied_fields.add("difficulty")

    return applied_fields


def _append_llm_note(result: dict[str, Any], note: str) -> dict[str, Any]:
    notes = result.get("llm_notes")
    if not isinstance(notes, list):
        notes = []
    notes.append(note)
    result["llm_notes"] = notes
    return result


def _non_empty_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()][:5]


def _append_unique(values: list[str], value: str | None, *, limit: int) -> None:
    if value is None or value in values or len(values) >= limit:
        return
    values.append(value)
