from __future__ import annotations

from collections import defaultdict
from contextlib import nullcontext
import time
from threading import Lock
from typing import Any

from app.contracts.stages import DECISION_STAGE_DISPLAY_NAMES, DECISION_STAGES, DecisionStage
from app.observability.phase_timing import PhaseTimingContext, packet_timing_summary, phase_timer, safe_emit_phase_timing
from app.providers import SemanticProviderPort
from app.providers.label_integrity import LabelIntegrityProviderPort
from app.providers.label_role import LabelRoleProviderPort
from app.normalization.gms_checkpoint_parallel import GMSCheckpointParallelConfig
from app.normalization.label_integrity_resolver import LabelIntegrityResolver
from app.normalization.label_role_resolver import LabelRoleResolver
from app.normalization import SemanticLabelResolver
from app.rule_engine.evaluator import RuleEngine
from app.rule_engine.models import RuleHit
from app.rule_engine.observation_priority import legacy_component_priorities, stage_observation_priorities
from app.rule_engine.registry_loader import load_default_registry
from app.rule_engine.scoring import friction_score, overall_risk, stage_scores_from_issues
from app.stage.stage_context_builder import StageContext, StageContextBuilder

RELIABILITY_ACTION_CONTEXT_CRITERION_IDS = {
    "RELIABILITY-TECH-001",
    "RELIABILITY-LOADING-STUCK-001",
    "FEEDBACK-ACTION-RESULT-001",
    "FEEDBACK-SYSTEM-STATUS-001",
}
RELIABILITY_LOCATION_TYPES = {
    "network_failure",
    "console_error",
    "loading_state",
    "page_ready_timing",
    "settle_response",
    "goal_action_result",
}
TOP_LEVEL_BOUNDS_COMPONENT_CRITERION_IDS = {"COPY-LABEL-INTEGRITY-001", "FORM-REQUIRED-OPTIONAL-001"}
PATH_CHOICE_OVERLOAD_CRITERION_IDS = {"PATH-CHOICE-OVERLOAD-001"}
TARGET_SIZE_CRITERION_IDS = {"TECH-TARGET-SIZE-001"}
PRODUCT_IMAGE_LOAD_CRITERION_IDS = {"TECH-PRODUCT-IMAGE-LOAD-001"}
COMPONENT_MARKER_CRITERION_IDS = {
    "PATH-CTA-002",
    *RELIABILITY_ACTION_CONTEXT_CRITERION_IDS,
    *TOP_LEVEL_BOUNDS_COMPONENT_CRITERION_IDS,
    *PATH_CHOICE_OVERLOAD_CRITERION_IDS,
    *TARGET_SIZE_CRITERION_IDS,
    *PRODUCT_IMAGE_LOAD_CRITERION_IDS,
}


def analyze_evidence_packet(
    packet: dict[str, Any],
    registry: dict[str, Any] | None = None,
    semantic_provider: SemanticProviderPort | None = None,
    label_role_provider: LabelRoleProviderPort | None = None,
    label_integrity_provider: LabelIntegrityProviderPort | None = None,
    timing_context: PhaseTimingContext | None = None,
    gms_checkpoint_parallel_config: GMSCheckpointParallelConfig | None = None,
) -> dict[str, Any]:
    registry = registry or load_default_registry()
    gms_parallel_config = gms_checkpoint_parallel_config or GMSCheckpointParallelConfig.from_env()
    if label_integrity_provider is not None:
        counting_provider = _CountingLabelIntegrityProvider(
            label_integrity_provider,
            timing_context=timing_context,
            parallel_config=gms_parallel_config,
        )
        with _phase_timer(
            timing_context=timing_context,
            phase="label_integrity",
            extra=lambda: {
                **packet_timing_summary(packet),
                "gmsCallCount": counting_provider.call_count,
                "candidateCount": counting_provider.candidate_count,
                "parallelEnabled": gms_parallel_config.enabled,
                "maxConcurrency": gms_parallel_config.max_concurrency,
                "failedCallCount": counting_provider.failed_call_count,
            },
        ):
            packet = LabelIntegrityResolver(counting_provider, parallel_config=gms_parallel_config).enrich_packet(packet)
    if label_role_provider is not None:
        counting_provider = _CountingLabelRoleProvider(
            label_role_provider,
            timing_context=timing_context,
            parallel_config=gms_parallel_config,
        )
        with _phase_timer(
            timing_context=timing_context,
            phase="label_role",
            extra=lambda: {
                **packet_timing_summary(packet),
                "gmsCallCount": counting_provider.call_count,
                "candidateCount": counting_provider.candidate_count,
                "parallelEnabled": gms_parallel_config.enabled,
                "maxConcurrency": gms_parallel_config.max_concurrency,
                "failedCallCount": counting_provider.failed_call_count,
            },
        ):
            packet = LabelRoleResolver(counting_provider, parallel_config=gms_parallel_config).enrich_packet(packet)
    with _phase_timer(
        timing_context=timing_context,
        phase="stage_context_build",
        extra=lambda: packet_timing_summary(packet),
    ):
        contexts = StageContextBuilder().build(packet)
    if semantic_provider is not None:
        counting_provider = _CountingSemanticProvider(semantic_provider)
        with _phase_timer(
            timing_context=timing_context,
            phase="semantic_cta",
            extra=lambda: {
                "stageCount": len(contexts),
                "gmsCallCount": counting_provider.call_count,
                "candidateCount": counting_provider.call_count,
            },
        ):
            contexts = SemanticLabelResolver(counting_provider).enrich(contexts)
    with _phase_timer(
        timing_context=timing_context,
        phase="rule_engine_eval",
        extra=lambda: {
            "stageCount": len(contexts),
            "ruleCount": len(registry.get("rules") or []),
        },
    ):
        hits = RuleEngine().evaluate(contexts=contexts, registry=registry)
    issues = _issues_from_hits(hits)
    issues = _attach_evidence_locations(issues, contexts, _screenshot_artifact_ids(packet))
    observation_priorities = stage_observation_priorities(contexts, issues)
    stage_scores = stage_scores_from_issues(issues)
    friction = friction_score(stage_scores)

    result: dict[str, Any] = {
        "schema_version": "0.5",
        "run_id": packet.get("run_id") or "",
        "evidence_schema_version": packet.get("schema_version") or "unknown",
        "rule_registry_id": registry.get("registry_id") or "unknown",
        "summary": {
            "overall_risk": overall_risk(friction),
            "friction_score": friction,
            "top_issues_count": len(issues),
            "task_success": _task_success(packet, issues),
        },
        "stage_scores": stage_scores,
        "issues": issues,
        "decision_map": _decision_map(contexts, issues),
        "stage_observation_priorities": observation_priorities,
        "stage_component_priorities": legacy_component_priorities(observation_priorities),
        "scenario_mismatch_report": _scenario_mismatch_report(packet),
        "nudges": _nudges_from_issues(issues),
        "llm_notes": [
            "Rule Engine generated deterministic stage/severity/confidence/priority values.",
            "LLM/MCP providers are constrained to semantic labels or post-judgment explanation drafts.",
        ],
    }
    return result


class _CountingLabelIntegrityProvider:
    def __init__(
        self,
        delegate: LabelIntegrityProviderPort,
        *,
        timing_context: PhaseTimingContext | None = None,
        parallel_config: GMSCheckpointParallelConfig | None = None,
    ) -> None:
        self._delegate = delegate
        self._timing_context = timing_context
        self._parallel_config = parallel_config or GMSCheckpointParallelConfig()
        self._lock = Lock()
        self.call_count = 0
        self.candidate_count = 0
        self.failed_call_count = 0

    def classify_label_integrity(
        self,
        *,
        scenario_goal: str,
        stage: str,
        checkpoint_id: str,
        screenshot_url: str,
        candidates: list[dict[str, Any]],
    ):
        with self._lock:
            self.call_count += 1
            self.candidate_count += len(candidates)
        started_at = time.perf_counter()
        try:
            results = self._delegate.classify_label_integrity(
                scenario_goal=scenario_goal,
                stage=stage,
                checkpoint_id=checkpoint_id,
                screenshot_url=screenshot_url,
                candidates=candidates,
            )
        except Exception as exc:
            with self._lock:
                self.failed_call_count += 1
            self._emit_checkpoint_timing(
                checkpoint_id=checkpoint_id,
                candidate_count=len(candidates),
                duration_ms=(time.perf_counter() - started_at) * 1000,
                status="error",
                error_type=type(exc).__name__,
            )
            raise
        self._emit_checkpoint_timing(
            checkpoint_id=checkpoint_id,
            candidate_count=len(candidates),
            duration_ms=(time.perf_counter() - started_at) * 1000,
            result_count=len(results),
        )
        return results

    def _emit_checkpoint_timing(
        self,
        *,
        checkpoint_id: str,
        candidate_count: int,
        duration_ms: float,
        status: str = "success",
        error_type: str | None = None,
        result_count: int = 0,
    ) -> None:
        if self._timing_context is None:
            return
        safe_emit_phase_timing(
            context=self._timing_context,
            phase="label_integrity_gms_checkpoint",
            duration_ms=duration_ms,
            status=status,
            error_type=error_type,
            extra={
                "checkpointId": checkpoint_id,
                "candidateCount": candidate_count,
                "resultCount": result_count,
                "parallelEnabled": self._parallel_config.enabled,
                "maxConcurrency": self._parallel_config.max_concurrency,
            },
        )


class _CountingLabelRoleProvider:
    def __init__(
        self,
        delegate: LabelRoleProviderPort,
        *,
        timing_context: PhaseTimingContext | None = None,
        parallel_config: GMSCheckpointParallelConfig | None = None,
    ) -> None:
        self._delegate = delegate
        self._timing_context = timing_context
        self._parallel_config = parallel_config or GMSCheckpointParallelConfig()
        self._lock = Lock()
        self.call_count = 0
        self.candidate_count = 0
        self.failed_call_count = 0

    def classify_label_roles(
        self,
        *,
        scenario_goal: str,
        stage: str,
        checkpoint_id: str,
        screenshot_url: str,
        candidates: list[dict[str, Any]],
    ):
        with self._lock:
            self.call_count += 1
            self.candidate_count += len(candidates)
        started_at = time.perf_counter()
        try:
            results = self._delegate.classify_label_roles(
                scenario_goal=scenario_goal,
                stage=stage,
                checkpoint_id=checkpoint_id,
                screenshot_url=screenshot_url,
                candidates=candidates,
            )
        except Exception as exc:
            with self._lock:
                self.failed_call_count += 1
            self._emit_checkpoint_timing(
                checkpoint_id=checkpoint_id,
                candidate_count=len(candidates),
                duration_ms=(time.perf_counter() - started_at) * 1000,
                status="error",
                error_type=type(exc).__name__,
            )
            raise
        self._emit_checkpoint_timing(
            checkpoint_id=checkpoint_id,
            candidate_count=len(candidates),
            duration_ms=(time.perf_counter() - started_at) * 1000,
            result_count=len(results),
        )
        return results

    def _emit_checkpoint_timing(
        self,
        *,
        checkpoint_id: str,
        candidate_count: int,
        duration_ms: float,
        status: str = "success",
        error_type: str | None = None,
        result_count: int = 0,
    ) -> None:
        if self._timing_context is None:
            return
        safe_emit_phase_timing(
            context=self._timing_context,
            phase="label_role_gms_checkpoint",
            duration_ms=duration_ms,
            status=status,
            error_type=error_type,
            extra={
                "checkpointId": checkpoint_id,
                "candidateCount": candidate_count,
                "resultCount": result_count,
                "parallelEnabled": self._parallel_config.enabled,
                "maxConcurrency": self._parallel_config.max_concurrency,
            },
        )


class _CountingSemanticProvider:
    def __init__(self, delegate: SemanticProviderPort) -> None:
        self._delegate = delegate
        self.call_count = 0

    def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str):
        self.call_count += 1
        return self._delegate.classify_cta(text=text, scenario_goal=scenario_goal, target_ref=target_ref)


def _phase_timer(
    *,
    timing_context: PhaseTimingContext | None,
    phase: str,
    extra: Any = None,
):
    if timing_context is None:
        return nullcontext()
    return phase_timer(context=timing_context, phase=phase, extra=extra)


def _issues_from_hits(hits: list[RuleHit]) -> list[dict[str, Any]]:
    return [hit.to_issue(f"issue_{index:03d}") for index, hit in enumerate(hits, start=1)]


def _attach_evidence_locations(
    issues: list[dict[str, Any]],
    contexts: dict[DecisionStage, StageContext],
    screenshot_artifact_ids: set[str],
) -> list[dict[str, Any]]:
    location_index = _evidence_location_index(contexts)
    location_index.update(_checkpoint_state_location_index(contexts))
    action_locations_by_checkpoint = _action_target_locations_by_checkpoint(location_index.values())
    located_issues: list[dict[str, Any]] = []
    for issue in issues:
        criterion_id = issue.get("criterion_id")
        supports_component_marker = criterion_id in COMPONENT_MARKER_CRITERION_IDS
        locations = [
            location_index[ref]
            for ref in issue.get("evidence_refs") or []
            if isinstance(ref, str) and ref in location_index
        ]
        if criterion_id in RELIABILITY_ACTION_CONTEXT_CRITERION_IDS:
            locations = _with_related_action_locations(locations, action_locations_by_checkpoint)
        if criterion_id in TOP_LEVEL_BOUNDS_COMPONENT_CRITERION_IDS:
            locations = _with_top_level_bounds_problem_components(locations)
        if criterion_id in PATH_CHOICE_OVERLOAD_CRITERION_IDS:
            locations = _with_path_choice_overload_problem_components(issue, locations)
        if criterion_id in TARGET_SIZE_CRITERION_IDS:
            locations = _with_target_size_problem_components(issue, locations)
        if criterion_id in PRODUCT_IMAGE_LOAD_CRITERION_IDS:
            locations = _with_product_image_problem_components(locations)
        if not supports_component_marker:
            locations = _without_problem_components(locations)
        problem_components = (
            _problem_components_from_locations(locations, screenshot_artifact_ids)
            if supports_component_marker
            else []
        )
        if locations:
            located_issue = {**issue, "evidence_locations": locations}
            if problem_components:
                located_issue["problem_components"] = problem_components
            located_issues.append(located_issue)
        else:
            located_issues.append(issue)
    return located_issues


def _action_target_locations_by_checkpoint(locations: Any) -> dict[str, list[dict[str, Any]]]:
    locations_by_checkpoint: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for location in locations:
        if not isinstance(location, dict) or location.get("type") != "interactive_components":
            continue
        checkpoint_id = location.get("checkpoint_id")
        if not isinstance(checkpoint_id, str) or not checkpoint_id:
            continue
        clicked_components = [
            component
            for component in location.get("components") or []
            if isinstance(component, dict)
            and component.get("clicked_in_scenario") is True
            and isinstance(component.get("bounds"), dict)
        ]
        if not clicked_components:
            continue
        locations_by_checkpoint[checkpoint_id].append({**location, "problem_components": clicked_components})
    return locations_by_checkpoint


def _checkpoint_state_location_index(contexts: dict[DecisionStage, StageContext]) -> dict[str, dict[str, Any]]:
    locations: dict[str, dict[str, Any]] = {}
    seen_checkpoints: set[str] = set()
    for context in contexts.values():
        for checkpoint in context.checkpoints:
            checkpoint_id = str(checkpoint.get("checkpoint_id") or "")
            if not checkpoint_id or checkpoint_id in seen_checkpoints:
                continue
            seen_checkpoints.add(checkpoint_id)
            state = checkpoint.get("state")
            if not isinstance(state, dict):
                continue
            network = state.get("network_summary")
            if isinstance(network, dict) and int(network.get("failed_request_count") or 0) > 0:
                ref = f"{checkpoint_id}.state.network_summary"
                locations[ref] = _checkpoint_state_location(checkpoint, ref, "network_failure", ["network"])
            console = state.get("console_summary")
            if isinstance(console, dict) and int(console.get("error_count") or 0) > 0:
                ref = f"{checkpoint_id}.state.console_summary"
                locations[ref] = _checkpoint_state_location(checkpoint, ref, "console_error", ["console"])
    return locations


def _checkpoint_state_location(
    checkpoint: dict[str, Any],
    evidence_ref: str,
    location_type: str,
    source: list[str],
) -> dict[str, Any]:
    location: dict[str, Any] = {
        "evidence_ref": evidence_ref,
        "checkpoint_id": str(checkpoint.get("checkpoint_id") or ""),
        "observation_id": evidence_ref.split(".", 1)[1],
        "type": location_type,
        "stage": checkpoint.get("primaryStage") or checkpoint.get("stage"),
        "source": source,
    }
    artifact_refs = checkpoint.get("artifact_refs")
    if isinstance(artifact_refs, list):
        location["artifact_refs"] = artifact_refs
    viewport = _viewport_from_checkpoint(checkpoint)
    if viewport:
        location["viewport"] = viewport
    return location


def _with_related_action_locations(
    locations: list[dict[str, Any]],
    action_locations_by_checkpoint: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    if not any(location.get("type") in RELIABILITY_LOCATION_TYPES for location in locations):
        return locations

    result = list(locations)
    seen_refs = {
        location.get("evidence_ref")
        for location in result
        if isinstance(location.get("evidence_ref"), str)
    }
    for location in locations:
        if location.get("type") not in RELIABILITY_LOCATION_TYPES:
            continue
        checkpoint_id = location.get("checkpoint_id")
        if not isinstance(checkpoint_id, str):
            continue
        for action_location in action_locations_by_checkpoint.get(checkpoint_id, []):
            evidence_ref = action_location.get("evidence_ref")
            if not isinstance(evidence_ref, str) or evidence_ref in seen_refs:
                continue
            result.append(action_location)
            seen_refs.add(evidence_ref)
    return result


def _with_top_level_bounds_problem_components(locations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for location in locations:
        if not isinstance(location.get("bounds"), dict) or location.get("problem_components"):
            result.append(location)
            continue
        component: dict[str, Any] = {"bounds": location["bounds"]}
        for key in ("text", "visible_text", "selector", "role"):
            value = location.get(key)
            if isinstance(value, str) and value:
                component["text" if key == "visible_text" else key] = value
        result.append({**location, "problem_components": [component]})
    return result


def _with_path_choice_overload_problem_components(issue: dict[str, Any], locations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    group_key = _choice_group_key_from_issue(issue)
    component_keys = _choice_group_component_keys_from_issue(issue)
    result: list[dict[str, Any]] = []
    for location in locations:
        if location.get("type") != "interactive_components":
            result.append(location)
            continue
        components = [
            component
            for component in location.get("components") or []
            if isinstance(component, dict)
            and isinstance(component.get("bounds"), dict)
            and (
                _component_matches_choice_key(component, component_keys)
                if component_keys
                else _component_matches_choice_group(component, group_key)
            )
        ]
        if not components and not component_keys and group_key and group_key.startswith("layout:"):
            components = [
                component
                for component in location.get("components") or []
                if isinstance(component, dict) and isinstance(component.get("bounds"), dict)
            ]
        if components:
            result.append({**location, "problem_components": [_path_choice_group_component(components, group_key)]})
        else:
            result.append(location)
    return result


def _path_choice_group_component(components: list[dict[str, Any]], group_key: str | None) -> dict[str, Any]:
    container_component = _path_choice_container_component(components, group_key)
    if container_component is not None:
        return container_component

    union_bounds = _union_component_bounds(components)
    if union_bounds is not None:
        return {
            "label": "choice group",
            "role": "group",
            "text": "choice group",
            "bounds": union_bounds,
        }
    return components[0]


def _path_choice_container_component(components: list[dict[str, Any]], group_key: str | None) -> dict[str, Any] | None:
    for component in components:
        container_bounds = _bounds_with_unit(component.get("container_bounds"))
        if container_bounds is None:
            continue
        if group_key and group_key.startswith("container:") and _component_container_group_key(component) != group_key:
            continue
        label = component.get("container_heading")
        label_text = label.strip() if isinstance(label, str) and label.strip() else "choice group"
        return {
            "label": label_text,
            "role": "group",
            "text": label_text,
            "bounds": container_bounds,
        }
    return None


def _union_component_bounds(components: list[dict[str, Any]]) -> dict[str, Any] | None:
    bounds_values = [
        bounds
        for component in components
        for bounds in [_numeric_bounds(component.get("bounds"))]
        if bounds is not None
    ]
    if not bounds_values:
        return None
    x1 = min(bounds["x"] for bounds in bounds_values)
    y1 = min(bounds["y"] for bounds in bounds_values)
    x2 = max(bounds["x"] + bounds["width"] for bounds in bounds_values)
    y2 = max(bounds["y"] + bounds["height"] for bounds in bounds_values)
    return {"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1, "unit": "css_px"}


def _with_target_size_problem_components(issue: dict[str, Any], locations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selectors = _target_size_selectors_from_issue(issue)
    result: list[dict[str, Any]] = []
    for location in locations:
        if location.get("type") != "interactive_components":
            result.append(location)
            continue
        components = [
            component
            for component in location.get("components") or []
            if isinstance(component, dict)
            and isinstance(component.get("bounds"), dict)
            and _component_matches_target_size_issue(component, selectors)
        ]
        if components:
            result.append({**location, "problem_components": components[:20]})
        else:
            result.append(location)
    return result


def _with_product_image_problem_components(locations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for location in locations:
        if location.get("type") != "product_card":
            result.append(location)
            continue
        components = [
            component
            for component in location.get("product_cards") or []
            if isinstance(component, dict)
            and component.get("visible_product_image") is False
            and isinstance(component.get("bounds"), dict)
        ]
        if components:
            result.append({**location, "problem_components": components[:20]})
        else:
            result.append(location)
    return result


def _target_size_selectors_from_issue(issue: dict[str, Any]) -> set[str]:
    for signal in issue.get("signals") or []:
        if not isinstance(signal, str) or not signal.startswith("target_size_problem_selectors="):
            continue
        raw_selectors = signal.split("=", 1)[1]
        return {selector for selector in raw_selectors.split("|") if selector}
    return set()


def _component_matches_target_size_issue(component: dict[str, Any], selectors: set[str]) -> bool:
    selector = component.get("selector")
    if selectors and isinstance(selector, str):
        return selector in selectors
    bounds = _numeric_bounds(component.get("bounds"))
    if bounds is None:
        return False
    min_dim = min(bounds["width"], bounds["height"])
    spacing = _number(component.get("nearest_target_spacing_px"))
    tight = spacing is not None and spacing < 8
    return min_dim < 24 or (min_dim < 44 and tight)


def _choice_group_key_from_issue(issue: dict[str, Any]) -> str | None:
    for signal in issue.get("signals") or []:
        if not isinstance(signal, str) or not signal.startswith("choice_group_key="):
            continue
        value = signal.split("=", 1)[1].strip()
        return value or None
    return None


def _choice_group_component_keys_from_issue(issue: dict[str, Any]) -> set[str]:
    for signal in issue.get("signals") or []:
        if not isinstance(signal, str) or not signal.startswith("choice_group_component_keys="):
            continue
        raw_keys = signal.split("=", 1)[1]
        return {key for key in raw_keys.split("|") if key}
    return set()


def _component_matches_choice_key(component: dict[str, Any], keys: set[str]) -> bool:
    return _component_choice_match_key(component) in keys


def _component_matches_choice_group(component: dict[str, Any], group_key: str | None) -> bool:
    if not group_key:
        return True
    if group_key.startswith("container:"):
        return _component_container_group_key(component) == group_key
    if group_key.startswith("heading:"):
        return _component_heading_group_key(component) == group_key
    return True


def _component_choice_match_key(component: dict[str, Any]) -> str | None:
    selector = component.get("selector")
    bounds = _numeric_bounds(component.get("bounds"))
    if not isinstance(selector, str) or not selector or bounds is None:
        return None
    return "@".join(
        [
            selector.replace("|", "").replace("@", ""),
            str(round(bounds["x"])),
            str(round(bounds["y"])),
            str(round(bounds["width"])),
            str(round(bounds["height"])),
        ]
    )


def _component_container_group_key(component: dict[str, Any]) -> str | None:
    role = str(component.get("container_role") or component.get("decision_area_role") or "").strip().lower()
    bounds = _numeric_bounds(component.get("container_bounds"))
    if bounds is None:
        return None
    return "container:" + ":".join(
        [
            role,
            _bucket(bounds["x"]),
            _bucket(bounds["y"]),
            _bucket(bounds["width"]),
            _bucket(bounds["height"]),
        ]
    )


def _component_heading_group_key(component: dict[str, Any]) -> str | None:
    heading = component.get("container_heading")
    if not isinstance(heading, str) or not heading.strip():
        return None
    bounds = _numeric_bounds(component.get("bounds"))
    if bounds is None:
        return None
    return f"heading:{heading.strip().lower()}:{_bucket(bounds['y'])}"


def _numeric_bounds(value: Any) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    try:
        x = float(value.get("x"))
        y = float(value.get("y"))
        width = float(value.get("width"))
        height = float(value.get("height"))
    except (TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    return {"x": x, "y": y, "width": width, "height": height}


def _bounds_with_unit(value: Any) -> dict[str, Any] | None:
    bounds = _numeric_bounds(value)
    if bounds is None:
        return None
    unit = value.get("unit") if isinstance(value, dict) else None
    return {**bounds, "unit": unit if isinstance(unit, str) and unit else "css_px"}


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _bucket(value: float) -> str:
    return str(round(value / 24))


def _without_problem_components(locations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for location in locations:
        if "problem_components" not in location:
            result.append(location)
            continue
        sanitized_location = {**location}
        sanitized_location.pop("problem_components", None)
        result.append(sanitized_location)
    return result


def _problem_components_from_locations(
    locations: list[dict[str, Any]],
    screenshot_artifact_ids: set[str],
) -> list[dict[str, Any]]:
    components: list[dict[str, Any]] = []
    for location in locations:
        evidence_ref = location.get("evidence_ref")
        if not isinstance(evidence_ref, str) or not evidence_ref:
            continue
        for index, component in enumerate(location.get("problem_components") or [], start=1):
            if not isinstance(component, dict):
                continue
            bounds = component.get("bounds")
            if not isinstance(bounds, dict):
                continue
            screenshot_artifact_id = _screenshot_artifact_id(location, screenshot_artifact_ids)
            if not screenshot_artifact_id:
                continue
            item: dict[str, Any] = {
                "component_id": f"{evidence_ref}.component_{index:03d}",
                "evidence_ref": evidence_ref,
                "coordinate_space": "viewport",
                "bounding_box": {**bounds, "unit": bounds.get("unit") or "css_px"},
            }
            for key in ("label", "role", "text", "selector"):
                value = component.get(key)
                if isinstance(value, str) and value:
                    item[key] = value
            viewport = location.get("viewport")
            if isinstance(viewport, dict):
                item["viewport"] = viewport
            item["screenshot_artifact_id"] = screenshot_artifact_id
            components.append(item)
    return components


def _screenshot_artifact_ids(packet: dict[str, Any]) -> set[str]:
    artifacts = packet.get("artifacts")
    if not isinstance(artifacts, list):
        return set()
    screenshot_ids: set[str] = set()
    for artifact in artifacts:
        if not isinstance(artifact, dict) or artifact.get("type") != "screenshot":
            continue
        artifact_id = _normalize_artifact_ref(artifact.get("artifact_id"))
        if artifact_id:
            screenshot_ids.add(artifact_id)
    return screenshot_ids


def _screenshot_artifact_id(location: dict[str, Any], screenshot_artifact_ids: set[str]) -> str | None:
    explicit = location.get("screenshot_artifact_id")
    normalized_explicit = _normalize_artifact_ref(explicit)
    if normalized_explicit and (not screenshot_artifact_ids or normalized_explicit in screenshot_artifact_ids):
        return normalized_explicit
    artifact_refs = location.get("artifact_refs")
    if isinstance(artifact_refs, list):
        for artifact_ref in artifact_refs:
            normalized_ref = _normalize_artifact_ref(artifact_ref)
            if normalized_ref and normalized_ref in screenshot_artifact_ids:
                return normalized_ref
    return None


def _normalize_artifact_ref(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    return value.removeprefix("artifact:")


def _evidence_location_index(contexts: dict[DecisionStage, StageContext]) -> dict[str, dict[str, Any]]:
    checkpoint_by_id: dict[str, dict[str, Any]] = {}
    for context in contexts.values():
        for checkpoint in context.checkpoints:
            checkpoint_id = str(checkpoint.get("checkpoint_id") or "")
            if checkpoint_id:
                checkpoint_by_id[checkpoint_id] = checkpoint

    locations: dict[str, dict[str, Any]] = {}
    for context in contexts.values():
        for record in context.observations:
            location = _location_from_observation_record(record, checkpoint_by_id.get(record.checkpoint_id))
            locations[record.ref] = location
    return locations


def _location_from_observation_record(record: Any, checkpoint: dict[str, Any] | None) -> dict[str, Any]:
    observation = record.observation
    data = observation.get("data") if isinstance(observation.get("data"), dict) else observation
    location: dict[str, Any] = {
        "evidence_ref": record.ref,
        "checkpoint_id": record.checkpoint_id,
        "observation_id": record.observation_id,
        "type": observation.get("type"),
        "stage": observation.get("stage") or record.stage,
        "source": observation.get("source") or [],
    }
    if observation.get("confidence") is not None:
        location["confidence"] = observation.get("confidence")
    if checkpoint:
        artifact_refs = checkpoint.get("artifact_refs")
        if isinstance(artifact_refs, list):
            location["artifact_refs"] = artifact_refs
        viewport = _viewport_from_checkpoint(checkpoint)
        if viewport:
            location["viewport"] = viewport

    for key in ("text", "visible_text", "selector", "role", "tag", "bounds"):
        value = data.get(key)
        if value is not None:
            location[key] = value
    if location.get("type") == "loading_state" and isinstance(data.get("bounds"), dict):
        component = {"bounds": data["bounds"]}
        for key in ("text", "selector", "role"):
            value = data.get(key)
            if isinstance(value, str) and value:
                component[key] = value
        loading_role = data.get("loading_role")
        if "role" not in component and isinstance(loading_role, str) and loading_role:
            component["role"] = loading_role
        location["problem_components"] = [component]

    components = _component_locations(data.get("components"))
    if components:
        location["components"] = components
        problem_components = [
            component
            for component in components
            if component.get("is_primary_like") is True or component.get("clicked_in_scenario") is True
        ]
        if problem_components:
            location["problem_components"] = problem_components
    items = _component_locations(data.get("items"))
    if items:
        location["items"] = items
    product_cards = _product_card_locations(data.get("cards"))
    if product_cards:
        location["product_cards"] = product_cards
        screenshot_artifact_id = _first_product_card_screenshot_id(data.get("cards"))
        if screenshot_artifact_id:
            location["screenshot_artifact_id"] = screenshot_artifact_id
    return location


def _product_card_locations(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    cards: list[dict[str, Any]] = []
    for index, card in enumerate(value, start=1):
        if not isinstance(card, dict):
            continue
        bounds = card.get("bbox")
        if not isinstance(bounds, dict):
            continue
        item: dict[str, Any] = {
            "card_index": index,
            "role": "product_card",
            "bounds": bounds,
        }
        text = card.get("element_text")
        if isinstance(text, str) and text:
            item["text"] = text
            item["label"] = text
        selector = card.get("clicked_selector")
        if isinstance(selector, str) and selector:
            item["selector"] = selector
        visible_price = card.get("visible_price")
        if isinstance(visible_price, str) and visible_price:
            item["visible_price"] = visible_price
        if "visible_product_image" in card:
            item["visible_product_image"] = card.get("visible_product_image")
        cards.append(item)
    return cards


def _first_product_card_screenshot_id(value: Any) -> str | None:
    if not isinstance(value, list):
        return None
    for card in value:
        if not isinstance(card, dict):
            continue
        screenshot_artifact_id = _normalize_artifact_ref(card.get("screenshot_artifact_id"))
        if screenshot_artifact_id:
            return screenshot_artifact_id
    return None


def _component_locations(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    components: list[dict[str, Any]] = []
    for component in value:
        if not isinstance(component, dict):
            continue
        item = {
            key: component[key]
            for key in (
                "text",
                "selector",
                "role",
                "tag",
                "clickable",
                "clicked_in_scenario",
                "is_cta_candidate",
                "is_primary_like",
                "bounds",
                "container_role",
                "container_bounds",
                "container_heading",
                "nearest_target_spacing_px",
                "visible",
                "disabled",
                "is_form_control",
            )
            if key in component
        }
        if item:
            components.append(item)
    return components


def _viewport_from_checkpoint(checkpoint: dict[str, Any]) -> dict[str, Any] | None:
    state = checkpoint.get("state")
    if not isinstance(state, dict):
        return None
    viewport = state.get("viewport")
    if isinstance(viewport, dict):
        return viewport
    layout_summary = state.get("layout_summary")
    if isinstance(layout_summary, dict):
        first_view = layout_summary.get("first_view")
        if isinstance(first_view, dict):
            return first_view
    return None


def _task_success(packet: dict[str, Any], issues: list[dict[str, Any]]) -> str:
    aggregate_value = (packet.get("aggregate_signals") or {}).get("task_success")
    if aggregate_value in {"success", "partial", "failed", "blocked"}:
        return str(aggregate_value)
    if any(int(issue.get("severity", 0)) >= 3 for issue in issues):
        return "blocked"
    if issues:
        return "partial"
    return "success"


def _decision_map(
    contexts: dict[DecisionStage, StageContext],
    issues: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    issues_by_stage: dict[DecisionStage, list[dict[str, Any]]] = defaultdict(list)
    for issue in issues:
        stage = issue.get("stage")
        if stage in DECISION_STAGES:
            issues_by_stage[stage].append(issue)  # type: ignore[index]

    items: list[dict[str, Any]] = []
    for stage in DECISION_STAGES:
        context = contexts[stage]
        stage_issues = issues_by_stage[stage]
        summary_item = context.decision_stage_summary.get(stage, {})
        evidence_refs = _stage_evidence_refs(context, stage_issues)

        if stage_issues:
            status = "WARNING"
            summary = _warning_summary(stage, stage_issues)
        elif summary_item.get("status") == "NOT_APPLICABLE":
            status = "NOT_APPLICABLE"
            summary = _stage_not_applicable_summary(stage)
        elif summary_item.get("status") == "BLOCKED":
            status = "BLOCKED"
            summary = f"{DECISION_STAGE_DISPLAY_NAMES[stage]} 단계가 사이트 상태로 인해 차단되었습니다."
        elif context.observed:
            status = "PASS"
            summary = _stage_pass_summary(stage)
        else:
            status = "NOT_OBSERVED"
            summary = f"{DECISION_STAGE_DISPLAY_NAMES[stage]} 단계 evidence가 아직 관찰되지 않았습니다."

        items.append(
            {
                "stage": stage,
                "displayName": DECISION_STAGE_DISPLAY_NAMES[stage],
                "status": status,
                "issueIds": [str(issue["issue_id"]) for issue in stage_issues],
                "summary": summary,
                "evidenceRefs": evidence_refs,
            }
        )
    return items


def _stage_evidence_refs(context: StageContext, issues: list[dict[str, Any]]) -> list[str]:
    refs: list[str] = []
    for issue in issues:
        refs.extend(str(ref) for ref in issue.get("evidence_refs", []))
    if not refs:
        refs.extend(context.evidence_refs())
    return list(dict.fromkeys(refs))


def _warning_summary(stage: DecisionStage, issues: list[dict[str, Any]]) -> str:
    if len(issues) == 1:
        return str(issues[0].get("summary") or f"{DECISION_STAGE_DISPLAY_NAMES[stage]} 단계에서 개선 신호가 관찰되었습니다.")
    return f"{DECISION_STAGE_DISPLAY_NAMES[stage]} 단계에서 {len(issues)}개의 개선 신호가 관찰되었습니다."


def _stage_pass_summary(stage: DecisionStage) -> str:
    return {
        "FIRST_VIEW": "첫 화면에서 판단에 필요한 화면 정보가 확인되었고 큰 문제는 발견되지 않았습니다.",
        "VALUE": "가치 이해 단계에서 판단에 필요한 화면 정보가 확인되었고 큰 문제는 발견되지 않았습니다.",
        "CTA": "행동 선택 단계에서 판단에 필요한 화면 정보가 확인되었고 큰 문제는 발견되지 않았습니다.",
        "INPUT": "입력 진행 단계에서 판단에 필요한 화면 정보가 확인되었고 큰 문제는 발견되지 않았습니다.",
        "COMMIT": "최종 확정 단계에서 판단에 필요한 화면 정보가 확인되었고 큰 문제는 발견되지 않았습니다.",
    }[stage]


def _stage_not_applicable_summary(stage: DecisionStage) -> str:
    return f"현재 실행에서는 {DECISION_STAGE_DISPLAY_NAMES[stage]} 단계가 적용되지 않습니다."


def _scenario_mismatch_report(packet: dict[str, Any]) -> dict[str, Any] | None:
    scenario_fit = packet.get("scenario_fit")
    if not isinstance(scenario_fit, dict):
        return None
    if scenario_fit.get("scenario_fit_status") not in {"NOT_APPLICABLE", "BLOCKED_BY_SITE", "UNSAFE_OR_RESTRICTED"}:
        return None
    return {
        "scenario_type": scenario_fit.get("scenario_type") or "CONTENT_ONLY",
        "scenario_fit_status": scenario_fit.get("scenario_fit_status") or "UNKNOWN",
        "block_reason": scenario_fit.get("reason") or "선택한 점검 시나리오가 현재 페이지에서 확인된 흐름과 맞지 않습니다.",
        "evidence_refs": list(scenario_fit.get("evidence_refs") or []),
        "recommended_alternatives": list(scenario_fit.get("recommended_alternatives") or []),
        "user_message": "선택한 시나리오가 현재 페이지와 맞지 않아 일반 개선 항목과 분리해 보고합니다.",
    }


REPORT_COPY_REPLACEMENTS = (
    ("핵심 CTA를 decision area 안에 하나의 primary 스타일로 노출하기", "가장 중요한 행동 버튼을 결정 영역 안에서 하나만 명확하게 강조하기"),
    ("핵심 CTA를 1개로 정하고 보조 CTA는 secondary 스타일로 낮추기", "핵심 행동 버튼은 하나만 강조하고 보조 행동은 덜 눈에 띄는 스타일로 정리하기"),
    ("여러 primary급 CTA가 경쟁해", "강조된 행동 버튼이 여러 개 경쟁해"),
    ("primary-like CTA", "강조된 행동 버튼"),
    ("primary급 CTA가", "강조된 행동 버튼이"),
    ("primary급 CTA", "강조된 행동 버튼"),
    ("primary CTA가", "핵심 행동 버튼이"),
    ("primary CTA를", "핵심 행동 버튼을"),
    ("primary CTA", "핵심 행동 버튼"),
    ("primary 스타일", "강조 스타일"),
    ("CTA cluster evidence", "행동 버튼 묶음"),
    ("CTA를", "행동 버튼을"),
    ("CTA는", "행동 버튼은"),
    ("CTA가", "행동 버튼이"),
    ("CTA", "행동 버튼"),
    ("secondary", "보조"),
    ("decision area", "결정 영역"),
    ("decision stage", "결정 순간"),
)


def _plain_report_text(text: str) -> str:
    normalized = text
    for source, replacement in REPORT_COPY_REPLACEMENTS:
        normalized = normalized.replace(source, replacement)
    return normalized


def _text_items(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_plain_report_text(str(item).strip()) for item in value if str(item).strip()]


def _first_text(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return _plain_report_text(value.strip())
    return None


def _nudge_rationale(issue: dict[str, Any]) -> str:
    summary = _first_text(issue.get("summary"))
    impact = _first_text(issue.get("impact_hypothesis"))
    observations = _text_items(issue.get("observations"))
    if summary and impact and impact != summary:
        return f"{summary} {impact}"
    if summary:
        return summary
    if impact:
        return impact
    if observations:
        return f"{observations[0]} 이 신호는 사용자가 다음 행동을 판단하는 데 방해가 될 수 있습니다."
    return "분석 중 사용자가 다음 행동을 판단하기 어렵게 만들 수 있는 신호가 관찰되었습니다."


def _nudge_expected_effect(issue: dict[str, Any]) -> str:
    stage = str(issue.get("stage") or "")
    if stage == "FIRST_VIEW":
        return "첫 화면에서 사용자가 핵심 내용을 더 빠르게 이해할 수 있습니다."
    if stage == "VALUE":
        return "사용자가 서비스의 가치와 다음 행동 이유를 더 쉽게 판단할 수 있습니다."
    if stage == "CTA":
        return "사용자가 중요한 행동을 더 명확하게 선택할 수 있습니다."
    if stage == "INPUT":
        return "입력 과정에서 망설임과 오류 가능성을 줄일 수 있습니다."
    if stage == "COMMIT":
        return "최종 확인 단계에서 이탈 가능성을 줄이고 진행 신뢰도를 높일 수 있습니다."
    return "사용자가 다음 행동을 더 명확하게 판단할 수 있습니다."


def _nudges_from_issues(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    nudges: list[dict[str, Any]] = []
    for index, issue in enumerate(issues, start=1):
        recommendations = _text_items(issue.get("recommendations"))
        recommendation = recommendations[0] if recommendations else "가장 중요한 행동과 보조 정보를 구분해 사용자가 다음 단계를 쉽게 선택할 수 있도록 정리하기"
        questions = _text_items(issue.get("validation_questions"))
        nudges.append(
            {
                "nudge_id": f"nudge_{index:03d}",
                "issue_id": issue["issue_id"],
                "title": (_first_text(issue.get("summary")) or "개선 제안")[:80],
                "rationale": _nudge_rationale(issue),
                "recommendation": recommendation,
                "difficulty": "LOW" if int(issue.get("severity", 1)) <= 1 else "MEDIUM",
                "expected_effect": _nudge_expected_effect(issue),
                "validation_question": questions[0] if questions else "수정 후 사용자가 같은 화면에서 다음 행동을 더 명확하게 이해할 수 있는가?",
            }
        )
    return nudges
