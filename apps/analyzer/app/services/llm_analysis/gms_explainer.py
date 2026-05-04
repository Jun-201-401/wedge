from __future__ import annotations

import copy
import json
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
    "summary",
    "impact_hypothesis",
    "recommendations",
    "validation_questions",
}


class GMSReportExplainer:
    """Post-process deterministic JudgeResult text through GMS.

    The Rule Engine remains the owner of final judgment fields. GMS is allowed
    to rewrite explanation text only, then the callback sends the polished
    JudgeResult.
    """

    def __init__(
        self,
        *,
        client: GMSExplanationClient | None = None,
        enabled: bool = False,
        model: str = "gpt-4.1-nano",
    ) -> None:
        self._client = client
        self._enabled = enabled
        self._model = model

    @classmethod
    def from_env(cls) -> "GMSReportExplainer":
        config = GMSConfig.from_env()
        return cls(
            client=GMSClient(config),
            enabled=config.enabled,
            model=config.model,
        )

    def explain(self, judge_result: dict[str, Any]) -> dict[str, Any]:
        result = copy.deepcopy(judge_result)
        if not self._enabled:
            return result
        if self._client is None:
            return _append_llm_note(result, "GMS report explanation was enabled but no client was configured.")

        try:
            response_text = self._client.generate_text(prompt=_build_prompt(result))
            explanation = _parse_json_object(response_text)
            _apply_explanation(result, explanation)
            result["llm_provider"] = "gms"
            result["llm_model"] = self._model
            return _append_llm_note(result, "GMS generated post-judgment explanation text; Rule Engine fields were preserved.")
        except (GMSClientError, ValueError, TypeError, KeyError) as exc:
            return _append_llm_note(result, f"GMS explanation fallback used deterministic text: {type(exc).__name__}")


def _build_prompt(judge_result: dict[str, Any]) -> str:
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
                "summary": issue.get("summary"),
                "impact_hypothesis": issue.get("impact_hypothesis"),
                "recommendations": issue.get("recommendations") or [],
                "validation_questions": issue.get("validation_questions") or [],
            }
            for issue in judge_result.get("issues") or []
            if isinstance(issue, dict)
        ],
        "decision_map": judge_result.get("decision_map") or [],
        "scenario_mismatch_report": judge_result.get("scenario_mismatch_report"),
    }
    return (
        "당신은 한국 제품팀을 위한 UX 분석 리포트를 다듬는 역할입니다.\n"
        "아래 JudgeResult는 deterministic Rule Engine이 만든 결과입니다.\n"
        "반드시 유효한 JSON만 반환하세요. markdown, 코드블록, 추가 설명은 넣지 마세요.\n"
        "모든 출력 문장은 자연스러운 한국어로 작성하세요.\n"
        "Rule Engine이 소유한 판단값은 절대 바꾸지 마세요: issue_id, criterion_id, stage, axis, severity, "
        "confidence, priority_score, evidence_refs.\n"
        "당신이 다듬을 수 있는 필드는 설명 문장뿐입니다: summary, impact_hypothesis, "
        "recommendations, validation_questions.\n"
        "문장은 짧고 실무적으로 작성하세요. 과장하지 말고 evidence에 근거해 말하세요.\n"
        "반환 형식은 반드시 아래 JSON 구조를 따르세요:\n"
        "{\n"
        '  "overall_summary": "string",\n'
        '  "issue_explanations": [\n'
        "    {\n"
        '      "issue_id": "issue_001",\n'
        '      "summary": "string",\n'
        '      "impact_hypothesis": "string",\n'
        '      "recommendations": ["string"],\n'
        '      "validation_questions": ["string"]\n'
        "    }\n"
        "  ]\n"
        "}\n"
        f"JudgeResult JSON:\n{json.dumps(compact, ensure_ascii=False)}"
    )


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

    for raw_item in raw_explanations:
        if not isinstance(raw_item, dict):
            continue
        issue = issue_by_id.get(str(raw_item.get("issue_id")))
        if issue is None:
            continue
        before = {field: copy.deepcopy(issue.get(field)) for field in RULE_OWNED_FIELDS}
        _apply_issue_text(issue, raw_item)
        for field, value in before.items():
            issue[field] = value

    _sync_nudges_from_issues(result)


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


def _sync_nudges_from_issues(result: dict[str, Any]) -> None:
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
        issue = issues.get(str(nudge.get("issue_id")))
        if issue is None:
            continue
        summary = _non_empty_string(issue.get("summary"))
        recommendations = _string_list(issue.get("recommendations"))
        questions = _string_list(issue.get("validation_questions"))
        if summary:
            nudge["title"] = summary[:80]
        if recommendations:
            nudge["recommendation"] = recommendations[0]
        if questions:
            nudge["validation_question"] = questions[0]


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
