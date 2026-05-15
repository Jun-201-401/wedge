from __future__ import annotations

import copy
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from app.contracts import semantic_enum, semantic_label_keys, semantic_response_properties, semantic_schema_version, semantic_task_type, semantic_task_types
from app.normalization import SemanticLabelResolver
from app.observability.phase_timing import PhaseTimingContext
from app.providers import (
    ACTION_SPECIFICITY_LABELS,
    PAGE_TYPE_LABELS,
    PROVIDER_TYPES,
    SCENARIO_RELEVANCE_LABELS,
    SEMANTIC_CLASSIFICATION_SCHEMA_VERSION,
    SEMANTIC_TASK_TYPE_CTA,
    DeterministicLexiconProvider,
    FastPathLexiconProvider,
    InternalLLMProvider,
    MCPSemanticProvider,
    MockSemanticProvider,
    SemanticLabelResult,
    SemanticProviderChain,
    sanitize_semantic_label_result,
)
from app.providers.label_integrity import LabelIntegrityIssueResult
from app.providers.label_role import LabelRoleIssueResult
from app.rule_engine import analyze_evidence_packet, load_default_registry
from app.rule_engine.contract_schema import schema_enum, schema_properties
from app.rule_engine.evaluator import RuleEngine, RuleHandlerMissing
from app.rule_engine.registry_loader import RuleRegistryError, validate_registry
from app.rule_engine.scoring import DEFAULT_SCORING_POLICY, ScoringPolicy, overall_risk, priority_score
from app.stage import StageContextBuilder, StageResolver

REPO_ROOT = Path(__file__).resolve().parents[4]
SAMPLE_EVIDENCE_PATH = REPO_ROOT / "packages/contracts/examples/sample-evidence-packet.json"
SEMANTIC_SCHEMA_PATH = REPO_ROOT / "packages/contracts/schemas/semantic-classification.schema.json"
SEMANTIC_REQUEST_EXAMPLE_PATH = REPO_ROOT / "packages/contracts/examples/sample-semantic-classification-request.json"
SEMANTIC_RESPONSE_EXAMPLE_PATH = REPO_ROOT / "packages/contracts/examples/sample-semantic-classification-response.json"
RULE_ENGINE_FIXTURE_ROOT = Path(__file__).resolve().parent / "fixtures/rule_engine"


def load_sample_packet() -> dict:
    with SAMPLE_EVIDENCE_PATH.open(encoding="utf-8") as file:
        return json.load(file)


def load_rule_fixture(rule_id: str, fixture_name: str) -> dict:
    with (RULE_ENGINE_FIXTURE_ROOT / rule_id / fixture_name).open(encoding="utf-8") as file:
        return json.load(file)


def load_semantic_fixture(fixture_name: str) -> list[dict]:
    fixture_path = Path(__file__).resolve().parent / "fixtures/semantic_normalization" / fixture_name
    with fixture_path.open(encoding="utf-8") as file:
        return json.load(file)


def phase_events(output: str) -> list[dict]:
    events: list[dict] = []
    for line in output.splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("event") == "analyzer_phase_timing":
            events.append(event)
    return events


class StagePipelineTest(unittest.TestCase):
    def test_resolver_prefers_explicit_observation_stage(self) -> None:
        resolver = StageResolver()
        stage = resolver.resolve_observation_stage(
            {"type": "cta_candidate", "stage": "VALUE"},
            {"primaryStage": "FIRST_VIEW"},
        )
        self.assertEqual(stage, "VALUE")

    def test_builder_places_cta_cluster_in_cta_context(self) -> None:
        contexts = StageContextBuilder().build(load_sample_packet())
        cta_refs = [record.ref for record in contexts["CTA"].observations]
        self.assertIn("cp_001.obs_002", cta_refs)
        self.assertIn("cp_001", [checkpoint["checkpoint_id"] for checkpoint in contexts["FIRST_VIEW"].checkpoints])


class RegistryLoaderTest(unittest.TestCase):
    def test_loads_default_registry(self) -> None:
        registry = load_default_registry()
        self.assertEqual(registry["registry_id"], "registry_p0_v0_1")
        self.assertIn("PATH-CTA-001", [rule["criterion_id"] for rule in registry["rules"]])

    def test_registry_loader_vocabularies_follow_contract_schema(self) -> None:
        from app.rule_engine import registry_loader

        self.assertEqual(registry_loader.RULE_FIELDS, schema_properties(("$defs", "rule")))
        self.assertEqual(registry_loader.AXES, schema_enum("axis"))
        self.assertEqual(registry_loader.EVIDENCE_LEVELS, schema_enum("evidence_level"))
        self.assertEqual(registry_loader.MEASUREMENT_SOURCES, schema_enum("source"))

    def test_missing_applicable_stages_fails(self) -> None:
        registry = load_default_registry()
        broken = copy.deepcopy(registry)
        del broken["rules"][0]["applicableStages"]
        with self.assertRaises(RuleRegistryError):
            validate_registry(broken)

    def test_invalid_axis_and_unknown_fields_fail(self) -> None:
        registry = load_default_registry()
        broken = copy.deepcopy(registry)
        broken["rules"][0]["axis"] = "BadAxis"
        with self.assertRaises(RuleRegistryError):
            validate_registry(broken)

        broken = copy.deepcopy(registry)
        broken["rules"][0]["unexpected"] = True
        with self.assertRaises(RuleRegistryError):
            validate_registry(broken)

    def test_invalid_registry_property_shapes_fail(self) -> None:
        registry = load_default_registry()
        broken = copy.deepcopy(registry)
        broken["registry_id"] = 123
        with self.assertRaises(RuleRegistryError):
            validate_registry(broken)

        broken = copy.deepcopy(registry)
        broken["rules"][0]["required_observations"] = "cta_candidate"
        with self.assertRaises(RuleRegistryError):
            validate_registry(broken)

        broken = copy.deepcopy(registry)
        broken["rules"][0]["fix_leverage_default"] = 99
        with self.assertRaises(RuleRegistryError):
            validate_registry(broken)

        broken = copy.deepcopy(registry)
        broken["rules"][0]["fix_leverage_default"] = True
        with self.assertRaises(RuleRegistryError):
            validate_registry(broken)

        broken = copy.deepcopy(registry)
        broken["rules"][0]["output_template"] = ["bad"]
        with self.assertRaises(RuleRegistryError):
            validate_registry(broken)

        broken = copy.deepcopy(registry)
        broken["rules"][0]["references"] = [{"label": "WCAG"}]
        with self.assertRaises(RuleRegistryError):
            validate_registry(broken)

        broken = copy.deepcopy(registry)
        broken["rules"][0]["references"] = [{
            "label": "WCAG",
            "publisher": "W3C",
            "title": "Labels or Instructions",
            "basisSummary": "Inputs need labels or instructions.",
            "url": "not a url",
        }]
        with self.assertRaises(RuleRegistryError):
            validate_registry(broken)

        broken = copy.deepcopy(registry)
        broken["rules"][0]["stages"] = ["BAD_STAGE"]
        with self.assertRaises(RuleRegistryError):
            validate_registry(broken)

    def test_malformed_severity_rule_fails(self) -> None:
        registry = load_default_registry()
        broken = copy.deepcopy(registry)
        broken["rules"][0]["severity_rules"] = [{"severity": 4, "condition": "bad"}]
        with self.assertRaises(RuleRegistryError):
            validate_registry(broken)

        broken = copy.deepcopy(registry)
        broken["rules"][0]["severity_rules"] = [{"severity": False, "condition": "bad"}]
        with self.assertRaises(RuleRegistryError):
            validate_registry(broken)


class SemanticClassificationContractTest(unittest.TestCase):
    def test_semantic_contract_schema_examples_have_expected_shape(self) -> None:
        schema = json.loads(SEMANTIC_SCHEMA_PATH.read_text(encoding="utf-8"))
        request = json.loads(SEMANTIC_REQUEST_EXAMPLE_PATH.read_text(encoding="utf-8"))
        response = json.loads(SEMANTIC_RESPONSE_EXAMPLE_PATH.read_text(encoding="utf-8"))

        self.assertEqual(schema["$defs"]["schema_version"]["const"], "0.1")
        self.assertEqual(request["schema_version"], schema["$defs"]["schema_version"]["const"])
        self.assertEqual(response["schema_version"], schema["$defs"]["schema_version"]["const"])
        self.assertEqual(request["task_type"], semantic_task_type())
        self.assertEqual(response["task_type"], semantic_task_type())
        self.assertEqual(semantic_task_types(), {"CTA_SEMANTIC_CLASSIFICATION"})
        self.assertIn("context", schema["$defs"]["request"]["properties"]["input"]["properties"])
        self.assertEqual(set(response["labels"]), {"scenario_relevance_label", "action_specificity_label", "page_type_label"})
        self.assertNotIn("stage", schema["$defs"]["response"]["properties"])
        self.assertNotIn("severity", schema["$defs"]["response"]["properties"])
        self.assertNotIn("priority_score", schema["$defs"]["response"]["properties"])
        self.assertNotIn("evidence_refs", schema["$defs"]["response"]["properties"])

    def test_analyzer_semantic_vocabularies_follow_contract_schema(self) -> None:
        self.assertEqual(SEMANTIC_CLASSIFICATION_SCHEMA_VERSION, semantic_schema_version())
        self.assertEqual(SEMANTIC_TASK_TYPE_CTA, semantic_task_type())
        self.assertEqual(SCENARIO_RELEVANCE_LABELS, semantic_enum("scenario_relevance_label"))
        self.assertEqual(ACTION_SPECIFICITY_LABELS, semantic_enum("action_specificity_label"))
        self.assertEqual(PAGE_TYPE_LABELS, semantic_enum("page_type_label"))
        self.assertEqual(PROVIDER_TYPES, semantic_enum("provider_type"))
        self.assertEqual(semantic_label_keys(), {"scenario_relevance_label", "action_specificity_label", "page_type_label"})
        self.assertTrue({"schema_version", "task_type", "target_observation_ref", "provider", "labels", "confidence"}.issubset(semantic_response_properties()))


class RuleEngineTest(unittest.TestCase):
    def test_sample_packet_emits_cta_competition(self) -> None:
        result = analyze_evidence_packet(load_sample_packet())
        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertEqual(criteria, ["PATH-CTA-002"])
        cta_issue = result["issues"][0]
        self.assertEqual(cta_issue["stage"], "CTA")
        self.assertEqual(cta_issue["evidence_refs"], ["cp_001.obs_002"])
        self.assertEqual(cta_issue["priority_score"], 2.03)
        decision_by_stage = {item["stage"]: item for item in result["decision_map"]}
        self.assertEqual(decision_by_stage["CTA"]["status"], "WARNING")
        self.assertEqual(decision_by_stage["FIRST_VIEW"]["status"], "PASS")
        self.assertEqual(decision_by_stage["COMMIT"]["status"], "NOT_APPLICABLE")
        self.assertEqual(result["summary"]["task_success"], "partial")

    def test_analysis_phase_timing_logs_core_boundaries_when_context_is_provided(self) -> None:
        class SemanticProvider:
            def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str):
                return SemanticLabelResult(
                    target_observation_ref=target_ref,
                    provider_type="test",
                    provider_name="semantic_provider",
                    labels={
                        "scenario_relevance_label": "RELEVANT_ACTION",
                        "action_specificity_label": "SPECIFIC_ACTION",
                    },
                    confidence=0.9,
                )

        class LabelIntegrityProvider:
            def classify_label_integrity(
                self,
                *,
                scenario_goal: str,
                stage: str,
                checkpoint_id: str,
                screenshot_url: str,
                candidates: list[dict],
            ):
                return []

        class LabelRoleProvider:
            def classify_label_roles(
                self,
                *,
                scenario_goal: str,
                stage: str,
                checkpoint_id: str,
                screenshot_url: str,
                candidates: list[dict],
            ):
                return []

        packet = load_sample_packet()
        packet["artifacts"][0]["signed_url"] = "https://example.com/cp_001.png"
        stdout = StringIO()

        with redirect_stdout(stdout):
            analyze_evidence_packet(
                packet,
                semantic_provider=SemanticProvider(),
                label_integrity_provider=LabelIntegrityProvider(),
                label_role_provider=LabelRoleProvider(),
                timing_context=PhaseTimingContext(
                    run_id="run-1",
                    analysis_job_id="job-1",
                    evidence_packet_id="packet-1",
                ),
            )

        events = phase_events(stdout.getvalue())
        phases = [event["phase"] for event in events]
        self.assertEqual(
            phases,
            ["label_integrity", "label_role", "stage_context_build", "semantic_cta", "rule_engine_eval"],
        )
        for event in events:
            self.assertEqual(event["runId"], "run-1")
            self.assertEqual(event["analysisJobId"], "job-1")
            self.assertEqual(event["evidencePacketId"], "packet-1")
            self.assertGreaterEqual(event["durationMs"], 0)
        label_role_event = next(event for event in events if event["phase"] == "label_role")
        self.assertGreaterEqual(label_role_event["gmsCallCount"], 1)
        self.assertGreaterEqual(label_role_event["candidateCount"], 1)
        semantic_event = next(event for event in events if event["phase"] == "semantic_cta")
        self.assertGreaterEqual(semantic_event["gmsCallCount"], 1)

    def test_journey_goal_cta_mismatch_uses_semantic_label(self) -> None:
        class IrrelevantCtaProvider:
            def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str):
                return SemanticLabelResult(
                    target_observation_ref=target_ref,
                    provider_type="test",
                    provider_name="irrelevant_cta_provider",
                    labels={
                        "scenario_relevance_label": "IRRELEVANT_ACTION",
                        "action_specificity_label": "SPECIFIC_ACTION",
                    },
                    confidence=0.88,
                )

        packet = load_sample_packet()
        packet["checkpoints"][0]["trigger"] = {"type": "click", "target": "a.careers"}
        packet["checkpoints"][0]["observations"] = [
            {
                "observation_id": "obs_goal_mismatch_cta",
                "type": "cta_candidate",
                "stage": "CTA",
                "source": ["dom", "ax"],
                "data": {"visible_text": "Read careers"},
                "confidence": 0.8,
            },
            {
                "observation_id": "obs_cta_cluster_ok",
                "type": "cta_cluster",
                "stage": "CTA",
                "source": ["dom", "layout"],
                "data": {"primary_like_cta_count": 1},
                "confidence": 0.8,
            },
        ]
        for checkpoint in packet["checkpoints"][1:]:
            checkpoint["observations"] = [
                observation
                for observation in checkpoint["observations"]
                if observation["type"] != "cta_candidate"
            ]
        result = analyze_evidence_packet(packet, semantic_provider=IrrelevantCtaProvider())
        mismatch = [issue for issue in result["issues"] if issue["criterion_id"] == "JOURNEY-GOAL-CTA-MISMATCH-001"]
        self.assertEqual(len(mismatch), 1)
        self.assertEqual(mismatch[0]["severity"], 2)
        self.assertEqual(mismatch[0]["confidence"], 0.88)

    def test_journey_goal_cta_mismatch_ignores_unclicked_candidate(self) -> None:
        class MixedCtaProvider:
            def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str):
                irrelevant = target_ref.endswith("obs_unclicked_cta")
                return SemanticLabelResult(
                    target_observation_ref=target_ref,
                    provider_type="test",
                    provider_name="mixed_cta_provider",
                    labels={
                        "scenario_relevance_label": "IRRELEVANT_ACTION" if irrelevant else "DIRECT_GOAL_ACTION",
                        "action_specificity_label": "SPECIFIC_ACTION",
                    },
                    confidence=0.9,
                )

        packet = load_sample_packet()
        packet["checkpoints"][0]["trigger"] = {"type": "goto"}
        packet["checkpoints"][0]["observations"] = [
            {
                "observation_id": "obs_unclicked_cta",
                "type": "cta_candidate",
                "stage": "CTA",
                "source": ["dom"],
                "data": {"visible_text": "Read careers"},
                "confidence": 0.8,
            }
        ]
        packet["checkpoints"][2]["trigger"] = {"type": "click", "target": "a.start"}
        packet["checkpoints"][2]["observations"] = [
            {
                "observation_id": "obs_clicked_cta",
                "type": "cta_candidate",
                "stage": "CTA",
                "source": ["dom"],
                "data": {"visible_text": "Start free"},
                "confidence": 0.8,
            }
        ]
        result = analyze_evidence_packet(packet, semantic_provider=MixedCtaProvider())
        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("JOURNEY-GOAL-CTA-MISMATCH-001", criteria)

    def test_interactive_components_issue_keeps_component_bounds(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
        packet["artifacts"].insert(
            0,
            {
                "artifact_id": "dom_cp_001",
                "type": "dom_snapshot",
                "uri": "s3://wedge-artifacts/runs/run_001/cp_001.html",
                "mime_type": "text/html",
                "size_bytes": 100,
            },
        )
        packet["checkpoints"][0]["artifact_refs"] = ["artifact:dom_cp_001", "artifact:screenshot_cp_001"]
        packet["checkpoints"][0]["observations"] = [
            observation
            for observation in packet["checkpoints"][0]["observations"]
            if observation["type"] != "cta_cluster"
        ]
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_interactive_components",
                "type": "interactive_components",
                "stage": "CTA",
                "source": ["dom", "layout", "screenshot"],
                "confidence": 0.82,
                "data": {
                    "primary_like_component_count": 3,
                    "components": [
                        {
                            "text": "Start free",
                            "selector": "a.hero-start",
                            "role": "link",
                            "tag": "a",
                            "clickable": True,
                            "clicked_in_scenario": True,
                            "is_cta_candidate": True,
                            "is_primary_like": True,
                            "bounds": {"x": 520, "y": 360, "width": 220, "height": 56},
                        },
                        {
                            "text": "Try demo",
                            "selector": "button.hero-demo",
                            "role": "button",
                            "tag": "button",
                            "clickable": True,
                            "clicked_in_scenario": False,
                            "is_cta_candidate": True,
                            "is_primary_like": True,
                            "bounds": {"x": 760, "y": 360, "width": 180, "height": 56},
                        },
                        {
                            "text": "Contact sales",
                            "selector": "a.hero-sales",
                            "role": "link",
                            "tag": "a",
                            "clickable": True,
                            "clicked_in_scenario": False,
                            "is_cta_candidate": True,
                            "is_primary_like": True,
                            "bounds": {"x": 960, "y": 360, "width": 190, "height": 56},
                        },
                    ],
                },
            }
        )

        result = analyze_evidence_packet(packet)

        issue = [issue for issue in result["issues"] if issue["criterion_id"] == "PATH-CTA-002"][0]
        self.assertEqual(issue["evidence_refs"], ["cp_001.obs_interactive_components"])
        location = issue["evidence_locations"][0]
        self.assertEqual(location["type"], "interactive_components")
        self.assertEqual(location["components"][0]["selector"], "a.hero-start")
        self.assertEqual(location["components"][0]["bounds"], {"x": 520, "y": 360, "width": 220, "height": 56})
        self.assertEqual(location["problem_components"][0]["bounds"], {"x": 520, "y": 360, "width": 220, "height": 56})
        self.assertEqual(issue["problem_components"][0]["evidence_ref"], "cp_001.obs_interactive_components")
        self.assertEqual(issue["problem_components"][0]["coordinate_space"], "viewport")
        self.assertEqual(issue["problem_components"][0]["bounding_box"], {"x": 520, "y": 360, "width": 220, "height": 56, "unit": "css_px"})
        self.assertEqual(issue["problem_components"][0]["screenshot_artifact_id"], "screenshot_cp_001")

    def test_interactive_components_without_screenshot_artifact_are_not_projected(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
        packet["artifacts"] = [
            {
                "artifact_id": "dom_cp_001",
                "type": "dom_snapshot",
                "uri": "s3://wedge-artifacts/runs/run_001/cp_001.html",
                "mime_type": "text/html",
                "size_bytes": 100,
            }
        ]
        packet["checkpoints"][0]["artifact_refs"] = ["artifact:dom_cp_001"]
        packet["checkpoints"][0]["observations"] = [
            observation
            for observation in packet["checkpoints"][0]["observations"]
            if observation["type"] != "cta_cluster"
        ]
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_interactive_components",
                "type": "interactive_components",
                "stage": "CTA",
                "source": ["dom", "layout"],
                "confidence": 0.82,
                "data": {
                    "primary_like_component_count": 3,
                    "components": [
                        {
                            "text": "Start free",
                            "selector": "a.hero-start",
                            "role": "link",
                            "clicked_in_scenario": True,
                            "is_primary_like": True,
                            "bounds": {"x": 520, "y": 360, "width": 220, "height": 56},
                        },
                        {
                            "text": "Try demo",
                            "selector": "button.hero-demo",
                            "role": "button",
                            "clicked_in_scenario": False,
                            "is_primary_like": True,
                            "bounds": {"x": 760, "y": 360, "width": 180, "height": 56},
                        },
                        {
                            "text": "Contact sales",
                            "selector": "a.hero-sales",
                            "role": "link",
                            "clicked_in_scenario": False,
                            "is_primary_like": True,
                            "bounds": {"x": 960, "y": 360, "width": 190, "height": 56},
                        },
                    ],
                },
            }
        )

        result = analyze_evidence_packet(packet)

        issue = [issue for issue in result["issues"] if issue["criterion_id"] == "PATH-CTA-002"][0]
        self.assertEqual(issue["evidence_locations"][0]["problem_components"][0]["selector"], "a.hero-start")
        self.assertNotIn("problem_components", issue)

    def test_path_choice_overload_emits_for_many_visible_choices(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
        packet["checkpoints"][0]["observations"] = [
            observation
            for observation in packet["checkpoints"][0]["observations"]
            if observation["type"] != "cta_cluster"
        ]
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_many_choices",
                "type": "interactive_components",
                "stage": "FIRST_VIEW",
                "source": ["dom", "layout"],
                "confidence": 0.86,
                "data": {
                    "components": [
                        {
                            "text": f"Menu {index}",
                            "selector": f"a.menu-{index}",
                            "role": "link",
                            "clickable": True,
                            "visible": True,
                            "is_primary_like": index == 0,
                            "bounds": {"x": 20 + (index * 64), "y": 80, "width": 56, "height": 40},
                        }
                        for index in range(15)
                    ]
                },
            }
        )

        result = analyze_evidence_packet(packet)

        overload = [issue for issue in result["issues"] if issue["criterion_id"] == "PATH-CHOICE-OVERLOAD-001"]
        self.assertEqual(len(overload), 1)
        self.assertEqual(overload[0]["stage"], "FIRST_VIEW")
        self.assertEqual(overload[0]["severity"], 2)
        self.assertEqual(overload[0]["confidence"], 0.86)
        self.assertEqual(overload[0]["evidence_refs"], ["cp_001.obs_many_choices"])
        self.assertIn("group_interactive_choice_count=15", overload[0]["signals"])
        self.assertTrue(any(signal.startswith("choice_group_key=") for signal in overload[0]["signals"]))
        self.assertIn("evidence_locations", overload[0])
        self.assertIn("components", overload[0]["evidence_locations"][0])
        self.assertEqual(len(overload[0]["problem_components"]), 15)

    def test_path_choice_overload_ignores_header_and_footer_utility_links(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
        packet["checkpoints"][0]["observations"] = [
            observation
            for observation in packet["checkpoints"][0]["observations"]
            if observation["type"] not in {"cta_cluster", "interactive_components"}
        ]
        utility_components = [
            {
                "text": f"Utility {index}",
                "selector": f"a.utility-{index}",
                "role": "link",
                "clickable": True,
                "visible": True,
                "container_role": "banner" if index < 8 else "contentinfo",
                "container_bounds": {"x": 0, "y": 0 if index < 8 else 700, "width": 1200, "height": 80},
                "bounds": {"x": 20 + (index * 58), "y": 24 if index < 8 else 724, "width": 48, "height": 32},
            }
            for index in range(16)
        ]
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_utility_choices",
                "type": "interactive_components",
                "stage": "FIRST_VIEW",
                "source": ["dom", "layout"],
                "confidence": 0.86,
                "data": {"components": utility_components},
            }
        )

        result = analyze_evidence_packet(packet)

        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("PATH-CHOICE-OVERLOAD-001", criteria)

    def test_path_choice_overload_emits_for_dense_group_even_below_count_threshold(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
        packet["checkpoints"][0]["observations"] = [
            observation
            for observation in packet["checkpoints"][0]["observations"]
            if observation["type"] not in {"cta_cluster", "interactive_components"}
        ]
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_dense_choices",
                "type": "interactive_components",
                "stage": "CTA",
                "source": ["dom", "layout"],
                "confidence": 0.84,
                "data": {
                    "components": [
                        {
                            "text": f"Plan {index}",
                            "selector": f"button.plan-{index}",
                            "role": "button",
                            "clickable": True,
                            "visible": True,
                            "container_role": "section",
                            "container_heading": "요금제",
                            "container_bounds": {"x": 100, "y": 320, "width": 760, "height": 180},
                            "bounds": {"x": 112 + (index * 82), "y": 360, "width": 76, "height": 44},
                            "nearest_target_spacing_px": 6,
                        }
                        for index in range(9)
                    ]
                },
            }
        )

        result = analyze_evidence_packet(packet)

        overload = [issue for issue in result["issues"] if issue["criterion_id"] == "PATH-CHOICE-OVERLOAD-001"]
        self.assertEqual(len(overload), 1)
        self.assertEqual(overload[0]["severity"], 2)
        self.assertIn("group_interactive_choice_count=9", overload[0]["signals"])
        self.assertIn("group_avg_spacing_px=6.0", overload[0]["signals"])

    def test_path_back_link_emits_for_multistep_flow_without_back_affordance(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][1]["observations"].append(
            {
                "observation_id": "obs_path_navigation",
                "type": "path_navigation",
                "stage": "INPUT",
                "source": ["dom", "browser"],
                "confidence": 0.82,
                "data": {
                    "step_indicator": [{"current_step": 2, "total_steps": 3, "text": "2 of 3"}],
                    "back_link_candidate": [],
                    "visited_url_count": 2,
                    "browser_history_back_available": False,
                    "flow_step_count": 3,
                },
            }
        )

        result = analyze_evidence_packet(packet)

        back_link = [issue for issue in result["issues"] if issue["criterion_id"] == "PATH-BACK-LINK-001"]
        self.assertEqual(len(back_link), 1)
        self.assertEqual(back_link[0]["stage"], "INPUT")
        self.assertEqual(back_link[0]["severity"], 2)
        self.assertEqual(back_link[0]["evidence_refs"], ["cp_002.obs_path_navigation"])
        self.assertIn("multi_step_flow=true", back_link[0]["signals"])
        self.assertIn("back_link_candidate_count=0", back_link[0]["signals"])

    def test_path_back_link_suppresses_when_explicit_back_affordance_exists(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][1]["observations"].append(
            {
                "observation_id": "obs_path_navigation",
                "type": "path_navigation",
                "stage": "INPUT",
                "source": ["dom", "browser"],
                "confidence": 0.82,
                "data": {
                    "step_indicator": [{"current_step": 2, "total_steps": 3, "text": "2 of 3"}],
                    "back_link_candidate": [{"text": "이전 단계", "selector": "a.back", "visible": True}],
                    "visited_url_count": 2,
                    "browser_history_back_available": True,
                    "flow_step_count": 3,
                },
            }
        )

        result = analyze_evidence_packet(packet)

        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("PATH-BACK-LINK-001", criteria)

    def test_path_accordion_discoverability_emits_for_hidden_primary_like_cta(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_accordion_state",
                "type": "accordion_state",
                "stage": "CTA",
                "source": ["dom"],
                "confidence": 0.83,
                "data": {
                    "accordions": [
                        {
                            "trigger_text": "Plan actions",
                            "panel_relationship": "aria_controls",
                            "expanded": False,
                            "hidden_panel_has_cta": True,
                            "hidden_panel_has_primary_like_cta": True,
                            "hidden_panel_has_required_info": False,
                        }
                    ]
                },
            }
        )

        result = analyze_evidence_packet(packet)

        accordion = [issue for issue in result["issues"] if issue["criterion_id"] == "PATH-ACCORDION-DISCOVERABILITY-001"]
        self.assertEqual(len(accordion), 1)
        self.assertEqual(accordion[0]["stage"], "CTA")
        self.assertEqual(accordion[0]["severity"], 2)
        self.assertEqual(accordion[0]["evidence_refs"], ["cp_001.obs_accordion_state"])
        self.assertIn("hidden_panel_has_primary_like_cta=true", accordion[0]["signals"])

    def test_path_accordion_discoverability_ignores_secondary_hidden_cta(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_accordion_state",
                "type": "accordion_state",
                "stage": "CTA",
                "source": ["dom"],
                "confidence": 0.83,
                "data": {
                    "accordions": [
                        {
                            "trigger_text": "More details",
                            "panel_relationship": "details_summary",
                            "expanded": False,
                            "hidden_panel_has_cta": True,
                            "hidden_panel_has_primary_like_cta": False,
                            "hidden_panel_has_required_info": True,
                        }
                    ]
                },
            }
        )

        result = analyze_evidence_packet(packet)

        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("PATH-ACCORDION-DISCOVERABILITY-001", criteria)

    def test_path_accordion_discoverability_ignores_expanded_primary_like_cta(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_accordion_state",
                "type": "accordion_state",
                "stage": "CTA",
                "source": ["dom"],
                "confidence": 0.83,
                "data": {
                    "accordions": [
                        {
                            "trigger_text": "Plan actions",
                            "panel_relationship": "aria_controls",
                            "expanded": True,
                            "hidden_panel_has_cta": False,
                            "hidden_panel_has_primary_like_cta": False,
                            "hidden_panel_has_required_info": False,
                        }
                    ]
                },
            }
        )

        result = analyze_evidence_packet(packet)

        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("PATH-ACCORDION-DISCOVERABILITY-001", criteria)

    def test_checkout_order_review_emits_when_final_submit_has_no_summary(self) -> None:
        packet = load_sample_packet()
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_checkout_context",
                "type": "checkout_context",
                "stage": "COMMIT",
                "source": ["dom", "browser"],
                "confidence": 0.78,
                "data": {
                    "checkout_context": {
                        "is_checkout_flow": True,
                        "flow_subtype": "order",
                        "has_order_summary": False,
                        "has_editable_summary": False,
                        "has_final_submit": True,
                        "order_summary_text": [],
                        "final_submit_text": "Place order",
                        "checkout_keywords": ["checkout", "order"],
                        "final_submit_relation": {
                            "related": False,
                            "relation_type": "submit_without_summary",
                            "summary_selector": None,
                            "submit_selector": "button.place-order",
                        },
                    }
                },
            }
        )

        result = analyze_evidence_packet(packet)

        checkout = [issue for issue in result["issues"] if issue["criterion_id"] == "CHECKOUT-ORDER-REVIEW-001"]
        self.assertEqual(len(checkout), 1)
        self.assertEqual(checkout[0]["stage"], "COMMIT")
        self.assertEqual(checkout[0]["severity"], 2)
        self.assertEqual(checkout[0]["confidence"], 0.78)
        self.assertEqual(checkout[0]["evidence_refs"], ["cp_001.obs_checkout_context"])
        self.assertIn("has_final_submit=true", checkout[0]["signals"])
        self.assertIn("has_order_summary=false", checkout[0]["signals"])

    def test_checkout_order_review_ignores_final_submit_with_summary(self) -> None:
        packet = load_sample_packet()
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_checkout_context",
                "type": "checkout_context",
                "stage": "COMMIT",
                "source": ["dom", "browser"],
                "confidence": 0.78,
                "data": {
                    "checkout_context": {
                        "is_checkout_flow": True,
                        "flow_subtype": "booking",
                        "has_order_summary": True,
                        "has_editable_summary": False,
                        "has_final_submit": True,
                        "order_summary_text": ["Room, date, guests, and total"],
                        "final_submit_text": "Confirm booking",
                        "checkout_keywords": ["checkout", "summary"],
                        "final_submit_relation": {
                            "related": True,
                            "relation_type": "summary_before_submit",
                            "summary_selector": "section.summary",
                            "submit_selector": "button.confirm",
                        },
                    }
                },
            }
        )

        result = analyze_evidence_packet(packet)

        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("CHECKOUT-ORDER-REVIEW-001", criteria)

    def test_checkout_order_review_ignores_checkout_without_final_submit(self) -> None:
        packet = load_sample_packet()
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_checkout_context",
                "type": "checkout_context",
                "stage": "COMMIT",
                "source": ["dom", "browser"],
                "confidence": 0.78,
                "data": {
                    "checkout_context": {
                        "is_checkout_flow": True,
                        "flow_subtype": "checkout",
                        "has_order_summary": False,
                        "has_editable_summary": False,
                        "has_final_submit": False,
                        "order_summary_text": [],
                        "final_submit_text": None,
                        "checkout_keywords": ["checkout"],
                        "final_submit_relation": None,
                    }
                },
            }
        )

        result = analyze_evidence_packet(packet)

        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("CHECKOUT-ORDER-REVIEW-001", criteria)

    def test_target_size_emits_for_small_tightly_spaced_target(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
        packet["checkpoints"][0]["observations"] = [
            observation
            for observation in packet["checkpoints"][0]["observations"]
            if observation["type"] not in {"cta_cluster", "interactive_components"}
        ]
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_small_targets",
                "type": "interactive_components",
                "stage": "CTA",
                "source": ["dom", "layout"],
                "confidence": 0.88,
                "data": {
                    "components": [
                        {
                            "text": "Open",
                            "selector": "button.icon-open",
                            "role": "button",
                            "tag": "button",
                            "clickable": True,
                            "visible": True,
                            "bounds": {"x": 320, "y": 240, "width": 18, "height": 18},
                            "nearest_target_spacing_px": 4,
                        },
                        {
                            "text": "Secondary",
                            "selector": "button.secondary",
                            "role": "button",
                            "tag": "button",
                            "clickable": True,
                            "visible": True,
                            "bounds": {"x": 360, "y": 240, "width": 80, "height": 40},
                            "nearest_target_spacing_px": 12,
                        },
                    ]
                },
            }
        )

        result = analyze_evidence_packet(packet)

        target_size = [issue for issue in result["issues"] if issue["criterion_id"] == "TECH-TARGET-SIZE-001"]
        self.assertEqual(len(target_size), 1)
        issue = target_size[0]
        self.assertEqual(issue["stage"], "CTA")
        self.assertEqual(issue["severity"], 2)
        self.assertEqual(issue["confidence"], 0.88)
        self.assertIn("WCAG 2.5.8", [reference["label"] for reference in issue["references"]])
        self.assertIn("min_target_size_px=24", issue["signals"])
        self.assertIn("tight_spacing_px=8", issue["signals"])
        self.assertIn("target_size_problem_selectors=button.icon-open", issue["signals"])
        self.assertEqual(issue["problem_components"][0]["selector"], "button.icon-open")
        self.assertEqual(issue["problem_components"][0]["bounding_box"], {"x": 320, "y": 240, "width": 18, "height": 18, "unit": "css_px"})

    def test_target_size_does_not_emit_for_small_footer_legal_link(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
        packet["checkpoints"][0]["observations"] = [
            observation
            for observation in packet["checkpoints"][0]["observations"]
            if observation["type"] not in {"cta_cluster", "interactive_components"}
        ]
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_footer_targets",
                "type": "interactive_components",
                "stage": "FIRST_VIEW",
                "source": ["dom", "layout"],
                "confidence": 0.84,
                "data": {
                    "components": [
                        {
                            "text": "Privacy",
                            "selector": "a.privacy",
                            "role": "link",
                            "tag": "a",
                            "clickable": True,
                            "visible": True,
                            "container_role": "contentinfo",
                            "bounds": {"x": 24, "y": 780, "width": 20, "height": 18},
                            "nearest_target_spacing_px": 4,
                        }
                    ]
                },
            }
        )

        result = analyze_evidence_packet(packet)

        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("TECH-TARGET-SIZE-001", criteria)

    def test_target_size_ignores_link_role_without_actionable_target(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
        packet["checkpoints"][0]["observations"] = [
            observation
            for observation in packet["checkpoints"][0]["observations"]
            if observation["type"] not in {"cta_cluster", "interactive_components"}
        ]
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_static_notice_text",
                "type": "interactive_components",
                "stage": "CTA",
                "source": ["dom", "layout"],
                "confidence": 0.84,
                "data": {
                    "components": [
                        {
                            "text": "지역별 배송 확인 필수",
                            "selector": "div.notice span.keyword",
                            "role": "link",
                            "tag": "span",
                            "visible": True,
                            "bounds": {"x": 96, "y": 350, "width": 180, "height": 18},
                            "nearest_target_spacing_px": 0,
                        }
                    ]
                },
            }
        )

        result = analyze_evidence_packet(packet)

        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("TECH-TARGET-SIZE-001", criteria)

    def test_target_size_counts_small_link_when_href_is_present(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
        packet["checkpoints"][0]["observations"] = [
            observation
            for observation in packet["checkpoints"][0]["observations"]
            if observation["type"] not in {"cta_cluster", "interactive_components"}
        ]
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_small_link",
                "type": "interactive_components",
                "stage": "CTA",
                "source": ["dom", "layout"],
                "confidence": 0.84,
                "data": {
                    "components": [
                        {
                            "text": "자세히",
                            "selector": "a.more",
                            "role": "link",
                            "tag": "a",
                            "href": "/notice/1",
                            "visible": True,
                            "bounds": {"x": 96, "y": 350, "width": 20, "height": 18},
                            "nearest_target_spacing_px": 4,
                        }
                    ]
                },
            }
        )

        result = analyze_evidence_packet(packet)

        target_size = [issue for issue in result["issues"] if issue["criterion_id"] == "TECH-TARGET-SIZE-001"]
        self.assertEqual(len(target_size), 1)
        self.assertEqual(target_size[0]["problem_components"][0]["selector"], "a.more")

    def test_missing_cta_evidence_is_not_user_facing_issue(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 0}
        for checkpoint in packet["checkpoints"]:
            checkpoint["observations"] = [
                observation
                for observation in checkpoint["observations"]
                if observation["type"] not in {"cta_candidate", "cta_cluster"}
            ]
        result = analyze_evidence_packet(packet)
        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("PATH-CTA-001", criteria)
        self.assertNotIn("PATH-CTA-002", criteria)

    def test_cta_cluster_zero_emits_path_cta_001(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
        for observation in packet["checkpoints"][0]["observations"]:
            if observation["type"] == "cta_cluster":
                observation["data"]["primary_like_cta_count"] = 0
        result = analyze_evidence_packet(packet)
        path_cta_001 = [issue for issue in result["issues"] if issue["criterion_id"] == "PATH-CTA-001"]
        self.assertEqual(len(path_cta_001), 1)
        self.assertEqual(path_cta_001[0]["stage"], "CTA")
        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("PATH-CTA-002", criteria)

    def test_path_cta_001_fixture_matrix(self) -> None:
        cases = [
            ("issue_missing_cta.json", True),
            ("not_evaluable_missing_cta_evidence.json", False),
        ]
        for fixture_name, should_emit in cases:
            with self.subTest(fixture_name=fixture_name):
                result = analyze_evidence_packet(load_rule_fixture("PATH-CTA-001", fixture_name))
                criteria = [issue["criterion_id"] for issue in result["issues"]]
                self.assertEqual("PATH-CTA-001" in criteria, should_emit)

    def test_lone_cta_candidate_without_readiness_is_not_issue(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
        for checkpoint in packet["checkpoints"]:
            checkpoint["observations"] = [
                observation
                for observation in checkpoint["observations"]
                if observation["type"] != "cta_cluster"
            ]
        result = analyze_evidence_packet(packet)
        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("PATH-CTA-001", criteria)
        self.assertNotIn("PATH-CTA-002", criteria)

    def test_form_label_missing_without_association_evidence_is_not_issue(self) -> None:
        packet = load_sample_packet()
        packet["checkpoints"][1]["observations"][0]["data"].update(
            {
                "label_text": "",
                "accessible_name": "",
                "placeholder": "Email",
                "visible": True,
            }
        )
        result = analyze_evidence_packet(packet)
        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("FRICTION-FORM-001", criteria)

    def test_screenshot_only_missing_label_is_not_issue(self) -> None:
        packet = load_sample_packet()
        packet["checkpoints"][1]["observations"].append(
            {
                "observation_id": "obs_missing_label_screenshot",
                "type": "missing_label",
                "stage": "INPUT",
                "source": ["screenshot"],
                "data": {"field_key": "Email"},
                "confidence": 0.8,
            }
        )
        result = analyze_evidence_packet(packet)
        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("FRICTION-FORM-001", criteria)

    def test_missing_form_label_emits_when_association_evidence_exists(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][1]["observations"][0]["source"] = ["dom", "ax"]
        packet["checkpoints"][1]["observations"][0]["data"].update(
            {
                "label_text": "",
                "accessible_name": "",
                "placeholder": "Email",
                "visible": True,
                "label_association": False,
            }
        )
        result = analyze_evidence_packet(packet)
        form_issues = [issue for issue in result["issues"] if issue["criterion_id"] == "FRICTION-FORM-001"]
        self.assertEqual(len(form_issues), 1)
        self.assertEqual(form_issues[0]["severity"], 1)

    def test_form_required_optional_emits_after_submit_error_without_prior_marker(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][1]["observations"][0]["source"] = ["dom", "ax", "scenario_log"]
        packet["checkpoints"][1]["observations"][0]["confidence"] = 0.89
        packet["checkpoints"][1]["observations"][0]["data"].update(
            {
                "label_text": "Email",
                "accessible_name": "Email",
                "visible": True,
                "required": True,
                "submit_required_error": True,
                "visible_required_marker": False,
                "group_level_required_state": "unknown",
                "bounds": {"x": 420, "y": 320, "width": 360, "height": 48},
                "selector": "input.email",
            }
        )

        result = analyze_evidence_packet(packet)

        issues = [issue for issue in result["issues"] if issue["criterion_id"] == "FORM-REQUIRED-OPTIONAL-001"]
        self.assertEqual(len(issues), 1)
        issue = issues[0]
        self.assertEqual(issue["stage"], "INPUT")
        self.assertEqual(issue["axis"], "Clarity")
        self.assertEqual(issue["severity"], 2)
        self.assertEqual(issue["confidence"], 0.89)
        self.assertIn("WCAG 3.3.2", [reference["label"] for reference in issue["references"]])
        self.assertIn("submit_required_error=true", issue["signals"])
        self.assertIn("visible_required_marker=false", issue["signals"])
        self.assertEqual(issue["problem_components"][0]["selector"], "input.email")
        self.assertEqual(issue["problem_components"][0]["bounding_box"], {"x": 420, "y": 320, "width": 360, "height": 48, "unit": "css_px"})

    def test_form_required_optional_accepts_runner_string_submit_error(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][1]["observations"][0]["source"] = ["dom", "ax", "scenario_log"]
        packet["checkpoints"][1]["observations"][0]["confidence"] = 0.86
        packet["checkpoints"][1]["observations"][0]["data"].update(
            {
                "label_text": "Email",
                "accessible_name": "Email",
                "visible": True,
                "required": True,
                "submit_required_error": "Email is required",
                "visible_required_marker": None,
                "group_level_required_state": "unknown",
            }
        )

        result = analyze_evidence_packet(packet)

        issues = [issue for issue in result["issues"] if issue["criterion_id"] == "FORM-REQUIRED-OPTIONAL-001"]
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0]["confidence"], 0.86)

    def test_form_required_optional_ignores_submit_error_with_visible_required_marker(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][1]["observations"][0]["data"].update(
            {
                "label_text": "Email *",
                "accessible_name": "Email required",
                "visible": True,
                "required": True,
                "submit_required_error": True,
                "visible_required_marker": True,
            }
        )

        result = analyze_evidence_packet(packet)

        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("FORM-REQUIRED-OPTIONAL-001", criteria)

    def test_form_required_optional_ignores_runner_string_required_marker(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][1]["observations"][0]["data"].update(
            {
                "label_text": "Email",
                "accessible_name": "Email",
                "visible": True,
                "required": True,
                "submit_required_error": "Email is required",
                "visible_required_marker": "*",
            }
        )

        result = analyze_evidence_packet(packet)

        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("FORM-REQUIRED-OPTIONAL-001", criteria)

    def test_form_required_optional_does_not_emit_from_required_dom_alone(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][1]["observations"][0]["data"].update(
            {
                "label_text": "Email",
                "accessible_name": "Email",
                "visible": True,
                "required": True,
                "visible_required_marker": False,
            }
        )

        result = analyze_evidence_packet(packet)

        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("FORM-REQUIRED-OPTIONAL-001", criteria)

    def test_run_level_reliability_aggregate_is_not_stage_issue(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["aggregate_signals"]["failed_request_count"] = 2
        result = analyze_evidence_packet(packet)
        reliability = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-TECH-001"]
        self.assertEqual(reliability, [])

    def test_checkpoint_reliability_failure_emits_stage_issue(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][1]["state"]["network_summary"]["failed_request_count"] = 1
        result = analyze_evidence_packet(packet)
        reliability = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-TECH-001"]
        self.assertEqual(len(reliability), 1)
        self.assertEqual(reliability[0]["stage"], "INPUT")
        self.assertEqual(reliability[0]["references"][0]["label"], "NN/g Heuristics")
        self.assertIn("cp_002.state.network_summary", reliability[0]["evidence_refs"])

    def test_reliability_ignores_tracking_network_failure(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_tracking_network_failure",
                "type": "network_failure",
                "stage": "CTA",
                "source": ["network"],
                "data": {
                    "url": "https://cm.g.doubleclick.net/pixel?google_nid=enliple_tw",
                    "status": 403,
                    "failure": "Forbidden",
                },
                "confidence": 0.9,
            }
        )

        result = analyze_evidence_packet(packet)

        reliability = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-TECH-001"]
        self.assertEqual(reliability, [])

    def test_reliability_ignores_generic_resource_console_error_with_summary_count(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["state"]["network_summary"]["failed_request_count"] = 1
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_tracking_console_error",
                "type": "console_error",
                "stage": "CTA",
                "source": ["console"],
                "data": {"message": "Failed to load resource: the server responded with a status of 403 ()"},
                "confidence": 0.9,
            }
        )

        result = analyze_evidence_packet(packet)

        reliability = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-TECH-001"]
        self.assertEqual(reliability, [])

    def test_loading_stuck_emits_from_general_page_ready_timing(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_page_ready_timing",
                "type": "page_ready_timing",
                "stage": "CTA",
                "source": ["performance", "dom", "layout", "scenario_log"],
                "data": {
                    "trigger_type": "click",
                    "action_kind": "link_click",
                    "url_changed": True,
                    "route_changed": True,
                    "main_content_changed": True,
                    "same_origin": True,
                    "duration_ms": 6_200,
                    "target_page_signals": {
                        "has_permission_prompt": False,
                        "has_streaming_response": False,
                        "has_map": False,
                        "has_payment_form": False,
                        "has_auth_redirect": False,
                        "has_webgl": False,
                    },
                },
                "confidence": 0.88,
            }
        )

        result = analyze_evidence_packet(packet)

        loading = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-LOADING-STUCK-001"]
        self.assertEqual(len(loading), 1)
        self.assertEqual(loading[0]["stage"], "CTA")
        self.assertEqual(loading[0]["severity"], 2)
        self.assertEqual(loading[0]["evidence_refs"], ["cp_001.obs_page_ready_timing"])
        self.assertIn("page_ready_threshold_ms=5000", loading[0]["signals"])
        self.assertIn("page_ready_timing.duration_ms=6200", loading[0]["signals"])

    def test_loading_stuck_escalates_very_slow_general_navigation(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_page_ready_timing",
                "type": "page_ready_timing",
                "stage": "CTA",
                "source": ["performance", "dom", "layout", "scenario_log"],
                "data": {
                    "trigger_type": "click",
                    "action_kind": "navigation",
                    "url_changed": True,
                    "route_changed": True,
                    "main_content_changed": True,
                    "same_origin": True,
                    "duration_ms": 8_500,
                    "target_page_signals": {
                        "has_permission_prompt": False,
                        "has_streaming_response": False,
                        "has_map": False,
                        "has_payment_form": False,
                        "has_auth_redirect": False,
                        "has_webgl": False,
                    },
                },
                "confidence": 0.88,
            }
        )

        result = analyze_evidence_packet(packet)

        loading = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-LOADING-STUCK-001"]
        self.assertEqual(len(loading), 1)
        self.assertEqual(loading[0]["severity"], 3)
        self.assertIn("page_ready_timing.duration_ms=8500", loading[0]["signals"])

    def test_loading_stuck_ignores_heavy_target_page_signal(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_page_ready_timing",
                "type": "page_ready_timing",
                "stage": "CTA",
                "source": ["performance", "dom", "layout", "scenario_log"],
                "data": {
                    "trigger_type": "click",
                    "action_kind": "navigation",
                    "url_changed": True,
                    "route_changed": True,
                    "main_content_changed": True,
                    "same_origin": True,
                    "duration_ms": 18_000,
                    "target_page_signals": {
                        "has_permission_prompt": False,
                        "has_streaming_response": False,
                        "has_map": True,
                        "has_payment_form": False,
                        "has_auth_redirect": False,
                        "has_webgl": False,
                    },
                },
                "confidence": 0.88,
            }
        )

        result = analyze_evidence_packet(packet)

        loading = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-LOADING-STUCK-001"]
        self.assertEqual(loading, [])

    def test_loading_stuck_ignores_timeout_without_general_navigation_signals(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][3]["settle"]["duration_ms"] = 9_000

        result = analyze_evidence_packet(packet)

        loading = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-LOADING-STUCK-001"]
        self.assertEqual(loading, [])

    def test_loading_stuck_suppresses_when_result_settled(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].extend(
            [
                {
                    "observation_id": "obs_loading_state",
                    "type": "loading_state",
                    "stage": "CTA",
                    "source": ["dom", "layout"],
                    "data": {"loading_visible": True, "duration_ms": 12_000},
                    "confidence": 0.88,
                },
                {
                    "observation_id": "obs_settled_result",
                    "type": "settle_response",
                    "stage": "CTA",
                    "source": ["network", "scenario_log"],
                    "data": {"settle_status": "settled", "duration_ms": 300},
                    "confidence": 0.9,
                },
            ]
        )

        result = analyze_evidence_packet(packet)

        loading = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-LOADING-STUCK-001"]
        self.assertEqual(loading, [])

    def test_loading_stuck_suppresses_when_technical_failure_exists(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].extend(
            [
                {
                    "observation_id": "obs_loading_state",
                    "type": "loading_state",
                    "stage": "CTA",
                    "source": ["dom", "layout"],
                    "data": {"loading_visible": True, "duration_ms": 12_000},
                    "confidence": 0.88,
                },
                {
                    "observation_id": "obs_network_failure",
                    "type": "network_failure",
                    "stage": "CTA",
                    "source": ["network"],
                    "data": {"url": "https://example.com/api/signup", "status": "failed"},
                    "confidence": 0.9,
                },
            ]
        )

        result = analyze_evidence_packet(packet)

        loading = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-LOADING-STUCK-001"]
        reliability = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-TECH-001"]
        self.assertEqual(loading, [])
        self.assertEqual(len(reliability), 1)

    def test_feedback_system_status_emits_when_processing_exceeds_three_seconds_without_feedback(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_loading_state_no_feedback",
                "type": "loading_state",
                "stage": "CTA",
                "source": ["dom", "browser"],
                "confidence": 0.78,
                "action_kind": "click",
                "expected_outcome_hint": ["dom_change"],
                "settle_status": "settled",
                "duration_ms": 3_400,
                "loading_state": {
                    "has_spinner": False,
                    "has_progressbar": False,
                    "status_text": [],
                    "clicked_submit_disabled": False,
                    "aria_busy": False,
                },
            }
        )

        result = analyze_evidence_packet(packet)

        feedback = [issue for issue in result["issues"] if issue["criterion_id"] == "FEEDBACK-SYSTEM-STATUS-001"]
        self.assertEqual(len(feedback), 1)
        self.assertEqual(feedback[0]["stage"], "CTA")
        self.assertEqual(feedback[0]["severity"], 1)
        self.assertEqual(feedback[0]["evidence_refs"], ["cp_001.obs_loading_state_no_feedback"])
        self.assertIn("status_feedback_threshold_ms=3000", feedback[0]["signals"])
        self.assertIn("duration_ms=3400", feedback[0]["signals"])

    def test_feedback_system_status_ignores_processing_under_three_seconds(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_loading_state_fast",
                "type": "loading_state",
                "stage": "CTA",
                "source": ["dom", "browser"],
                "confidence": 0.78,
                "action_kind": "click",
                "expected_outcome_hint": ["dom_change"],
                "settle_status": "settled",
                "duration_ms": 2_900,
                "loading_state": {
                    "has_spinner": False,
                    "has_progressbar": False,
                    "status_text": [],
                    "clicked_submit_disabled": False,
                    "aria_busy": False,
                },
            }
        )

        result = analyze_evidence_packet(packet)

        feedback = [issue for issue in result["issues"] if issue["criterion_id"] == "FEEDBACK-SYSTEM-STATUS-001"]
        self.assertEqual(feedback, [])

    def test_feedback_system_status_suppresses_when_status_feedback_exists(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_loading_state_with_feedback",
                "type": "loading_state",
                "stage": "CTA",
                "source": ["dom", "browser"],
                "confidence": 0.82,
                "action_kind": "submit",
                "expected_outcome_hint": ["form_submit"],
                "settle_status": "settled",
                "duration_ms": 6_200,
                "loading_state": {
                    "has_spinner": True,
                    "has_progressbar": False,
                    "status_text": ["Processing"],
                    "clicked_submit_disabled": True,
                    "aria_busy": False,
                },
            }
        )

        result = analyze_evidence_packet(packet)

        feedback = [issue for issue in result["issues"] if issue["criterion_id"] == "FEEDBACK-SYSTEM-STATUS-001"]
        self.assertEqual(feedback, [])

    def test_feedback_system_status_suppresses_when_technical_failure_exists(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].extend(
            [
                {
                    "observation_id": "obs_loading_state_no_feedback",
                    "type": "loading_state",
                    "stage": "CTA",
                    "source": ["dom", "browser"],
                    "confidence": 0.78,
                    "action_kind": "submit",
                    "expected_outcome_hint": ["form_submit"],
                    "settle_status": "timeout",
                    "duration_ms": 7_200,
                    "loading_state": {
                        "has_spinner": False,
                        "has_progressbar": False,
                        "status_text": [],
                        "clicked_submit_disabled": True,
                        "aria_busy": False,
                    },
                },
                {
                    "observation_id": "obs_network_failure",
                    "type": "network_failure",
                    "stage": "CTA",
                    "source": ["network"],
                    "data": {"url": "https://example.com/api/submit", "status": "failed"},
                    "confidence": 0.9,
                },
            ]
        )

        result = analyze_evidence_packet(packet)

        feedback = [issue for issue in result["issues"] if issue["criterion_id"] == "FEEDBACK-SYSTEM-STATUS-001"]
        reliability = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-TECH-001"]
        self.assertEqual(feedback, [])
        self.assertEqual(len(reliability), 1)

    def test_feedback_system_status_escalates_commit_timeout_without_feedback(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_commit_loading_state_no_feedback",
                "type": "loading_state",
                "stage": "COMMIT",
                "source": ["dom", "browser"],
                "confidence": 0.78,
                "action_kind": "payment_submit",
                "expected_outcome_hint": ["checkout_processing"],
                "settle_status": "timeout",
                "duration_ms": 8_500,
                "loading_state": {
                    "has_spinner": False,
                    "has_progressbar": False,
                    "status_text": [],
                    "clicked_submit_disabled": True,
                    "aria_busy": False,
                },
            }
        )

        result = analyze_evidence_packet(packet)

        feedback = [issue for issue in result["issues"] if issue["criterion_id"] == "FEEDBACK-SYSTEM-STATUS-001"]
        self.assertEqual(len(feedback), 1)
        self.assertEqual(feedback[0]["stage"], "COMMIT")
        self.assertEqual(feedback[0]["severity"], 3)
        self.assertIn("settle_status=timeout", feedback[0]["signals"])

    def test_reliability_issue_links_clicked_component_bounds(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].extend([
            {
                "observation_id": "obs_interactive_components",
                "type": "interactive_components",
                "stage": "CTA",
                "source": ["dom", "layout", "screenshot"],
                "confidence": 0.82,
                "data": {
                    "primary_like_component_count": 1,
                    "components": [
                        {
                            "text": "Start free",
                            "selector": "a.hero-start",
                            "role": "link",
                            "tag": "a",
                            "clickable": True,
                            "clicked_in_scenario": True,
                            "is_cta_candidate": True,
                            "is_primary_like": True,
                            "bounds": {"x": 520, "y": 360, "width": 220, "height": 56},
                        }
                    ],
                },
            },
            {
                "observation_id": "obs_network_failure",
                "type": "network_failure",
                "stage": "CTA",
                "source": ["network"],
                "data": {"url": "https://example.com/api/signup", "status": "failed"},
                "confidence": 0.9,
            },
        ])

        result = analyze_evidence_packet(packet)

        issue = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-TECH-001"][0]
        self.assertEqual(issue["evidence_refs"], ["cp_001.obs_network_failure"])
        self.assertEqual(issue["evidence_locations"][0]["type"], "network_failure")
        self.assertEqual(issue["evidence_locations"][1]["type"], "interactive_components")
        self.assertEqual(issue["problem_components"][0]["evidence_ref"], "cp_001.obs_interactive_components")
        self.assertEqual(issue["problem_components"][0]["selector"], "a.hero-start")
        self.assertEqual(issue["problem_components"][0]["bounding_box"], {"x": 520, "y": 360, "width": 220, "height": 56, "unit": "css_px"})
        self.assertEqual(issue["problem_components"][0]["screenshot_artifact_id"], "screenshot_cp_001")

    def test_reliability_issue_does_not_project_unclicked_component_bounds(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].extend([
            {
                "observation_id": "obs_interactive_components",
                "type": "interactive_components",
                "stage": "CTA",
                "source": ["dom", "layout", "screenshot"],
                "confidence": 0.82,
                "data": {
                    "primary_like_component_count": 1,
                    "components": [
                        {
                            "text": "Start free",
                            "selector": "a.hero-start",
                            "role": "link",
                            "clickable": True,
                            "clicked_in_scenario": False,
                            "is_primary_like": True,
                            "bounds": {"x": 520, "y": 360, "width": 220, "height": 56},
                        }
                    ],
                },
            },
            {
                "observation_id": "obs_network_failure",
                "type": "network_failure",
                "stage": "CTA",
                "source": ["network"],
                "data": {"url": "https://example.com/api/signup", "status": "failed"},
                "confidence": 0.9,
            },
        ])

        result = analyze_evidence_packet(packet)

        issue = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-TECH-001"][0]
        self.assertEqual(issue["evidence_refs"], ["cp_001.obs_network_failure"])
        self.assertNotIn("problem_components", issue)

    def test_checkpoint_state_reliability_links_clicked_component_bounds(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][1]["state"]["network_summary"]["failed_request_count"] = 1
        packet["checkpoints"][1]["observations"].append(
            {
                "observation_id": "obs_interactive_components",
                "type": "interactive_components",
                "stage": "INPUT",
                "source": ["dom", "layout", "screenshot"],
                "confidence": 0.82,
                "data": {
                    "primary_like_component_count": 1,
                    "components": [
                        {
                            "text": "Submit",
                            "selector": "button.submit",
                            "role": "button",
                            "clickable": True,
                            "clicked_in_scenario": True,
                            "is_primary_like": True,
                            "bounds": {"x": 620, "y": 420, "width": 160, "height": 48},
                        }
                    ],
                },
            }
        )

        result = analyze_evidence_packet(packet)

        issue = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-TECH-001"][0]
        self.assertEqual(issue["evidence_refs"], ["cp_002.state.network_summary"])
        self.assertEqual(issue["evidence_locations"][0]["type"], "network_failure")
        self.assertEqual(issue["evidence_locations"][1]["type"], "interactive_components")
        self.assertEqual(issue["problem_components"][0]["evidence_ref"], "cp_002.obs_interactive_components")
        self.assertEqual(issue["problem_components"][0]["selector"], "button.submit")
        self.assertEqual(issue["problem_components"][0]["bounding_box"], {"x": 620, "y": 420, "width": 160, "height": 48, "unit": "css_px"})
        self.assertEqual(issue["problem_components"][0]["screenshot_artifact_id"], "screenshot_cp_002")

    def test_checkpoint_state_reliability_is_not_duplicated_across_observation_stages(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][1]["state"]["network_summary"]["failed_request_count"] = 1
        packet["checkpoints"][1]["observations"].append(
            {
                "observation_id": "obs_cross_stage_cta",
                "type": "cta_candidate",
                "stage": "CTA",
                "source": ["dom"],
                "data": {"visible_text": "무료로 시작하기"},
                "confidence": 0.8,
            }
        )

        result = analyze_evidence_packet(packet)

        reliability = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-TECH-001"]
        self.assertEqual(len(reliability), 1)
        self.assertEqual(reliability[0]["stage"], "INPUT")
        self.assertEqual(reliability[0]["evidence_refs"], ["cp_002.state.network_summary"])

    def test_feedback_action_result_emits_when_goal_action_has_no_visible_confirmation(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_goal_action_result_missing_feedback",
                "type": "goal_action_result",
                "stage": "CTA",
                "source": ["scenario_log", "dom", "browser", "network"],
                "confidence": 0.82,
                "data": {
                    "step_order": 1,
                    "step_key": "step_add_to_cart",
                    "action_type": "click",
                    "clicked_text": "Add to cart",
                    "clicked_selector": "button.add-to-cart",
                    "url_before": "https://example.com/product",
                    "url_after": "https://example.com/product",
                    "goal_action_like": True,
                    "success_evidence": [],
                    "result": {
                        "action_attempted": True,
                        "add_to_cart_like_button": True,
                        "cart_count_delta": 0,
                        "toast_present": False,
                        "url_changed": False,
                        "dom_changed": False,
                        "network_success": False,
                        "settle_status": "settled",
                    },
                },
            }
        )

        result = analyze_evidence_packet(packet)

        feedback = [issue for issue in result["issues"] if issue["criterion_id"] == "FEEDBACK-ACTION-RESULT-001"]
        self.assertEqual(len(feedback), 1)
        self.assertEqual(feedback[0]["stage"], "CTA")
        self.assertEqual(feedback[0]["severity"], 2)
        self.assertEqual(feedback[0]["evidence_refs"], ["cp_001.obs_goal_action_result_missing_feedback"])
        self.assertIn("success_evidence=none", feedback[0]["signals"])

    def test_feedback_action_result_suppresses_when_visible_confirmation_exists(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_goal_action_result_confirmed",
                "type": "goal_action_result",
                "stage": "CTA",
                "source": ["scenario_log", "dom", "browser", "network"],
                "confidence": 0.84,
                "data": {
                    "step_order": 1,
                    "step_key": "step_add_to_cart",
                    "action_type": "click",
                    "clicked_text": "Add to cart",
                    "clicked_selector": "button.add-to-cart",
                    "url_before": "https://example.com/product",
                    "url_after": "https://example.com/product",
                    "goal_action_like": True,
                    "success_evidence": ["toast_present"],
                    "result": {
                        "action_attempted": True,
                        "add_to_cart_like_button": True,
                        "cart_count_delta": 0,
                        "toast_present": True,
                        "url_changed": False,
                        "dom_changed": False,
                        "network_success": True,
                        "settle_status": "settled",
                    },
                },
            }
        )

        result = analyze_evidence_packet(packet)

        feedback = [issue for issue in result["issues"] if issue["criterion_id"] == "FEEDBACK-ACTION-RESULT-001"]
        self.assertEqual(feedback, [])

    def test_feedback_action_result_uses_same_checkpoint_count_change_as_confirmation(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].extend(
            [
                {
                    "observation_id": "obs_goal_action_result_missing_feedback",
                    "type": "goal_action_result",
                    "stage": "CTA",
                    "source": ["scenario_log", "dom", "browser", "network"],
                    "confidence": 0.82,
                    "data": {
                        "step_order": 1,
                        "step_key": "step_add_to_cart",
                        "action_type": "click",
                        "clicked_text": "Add to cart",
                        "clicked_selector": "button.add-to-cart",
                        "url_before": "https://example.com/product",
                        "url_after": "https://example.com/product",
                        "goal_action_like": True,
                        "success_evidence": [],
                        "result": {
                            "action_attempted": True,
                            "add_to_cart_like_button": True,
                            "cart_count_delta": 0,
                            "toast_present": False,
                            "url_changed": False,
                            "dom_changed": False,
                            "network_success": False,
                            "settle_status": "settled",
                        },
                    },
                },
                {
                    "observation_id": "obs_count_change",
                    "type": "settle_item_count_change",
                    "stage": "VALUE",
                    "source": ["dom", "scenario_log"],
                    "confidence": 0.88,
                    "data": {
                        "settle_status": "settled",
                        "target": "selector=.cart-item",
                        "baseline_count": 0,
                        "current_count": 1,
                        "count_delta": 1,
                    },
                },
            ]
        )

        result = analyze_evidence_packet(packet)

        feedback = [issue for issue in result["issues"] if issue["criterion_id"] == "FEEDBACK-ACTION-RESULT-001"]
        self.assertEqual(feedback, [])

    def test_feedback_action_result_suppresses_when_reliability_failure_explains_action(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].extend(
            [
                {
                    "observation_id": "obs_goal_action_result_missing_feedback",
                    "type": "goal_action_result",
                    "stage": "CTA",
                    "source": ["scenario_log", "dom", "browser", "network"],
                    "confidence": 0.82,
                    "data": {
                        "step_order": 1,
                        "step_key": "step_add_to_cart",
                        "action_type": "click",
                        "clicked_text": "Add to cart",
                        "clicked_selector": "button.add-to-cart",
                        "url_before": "https://example.com/product",
                        "url_after": "https://example.com/product",
                        "goal_action_like": True,
                        "success_evidence": [],
                        "result": {
                            "action_attempted": True,
                            "add_to_cart_like_button": True,
                            "cart_count_delta": 0,
                            "toast_present": False,
                            "url_changed": False,
                            "dom_changed": False,
                            "network_success": False,
                            "settle_status": "failed",
                        },
                    },
                },
                {
                    "observation_id": "obs_network_failure",
                    "type": "network_failure",
                    "stage": "CTA",
                    "source": ["network"],
                    "data": {"url": "https://example.com/api/cart", "status": "failed"},
                    "confidence": 0.9,
                },
            ]
        )

        result = analyze_evidence_packet(packet)

        feedback = [issue for issue in result["issues"] if issue["criterion_id"] == "FEEDBACK-ACTION-RESULT-001"]
        reliability = [issue for issue in result["issues"] if issue["criterion_id"] == "RELIABILITY-TECH-001"]
        self.assertEqual(feedback, [])
        self.assertEqual(len(reliability), 1)

    def test_feedback_action_result_warns_when_only_network_success_exists(self) -> None:
        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {"CTA": 1}
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_goal_action_result_network_only",
                "type": "goal_action_result",
                "stage": "CTA",
                "source": ["scenario_log", "dom", "browser", "network"],
                "confidence": 0.84,
                "data": {
                    "step_order": 1,
                    "step_key": "step_add_to_cart",
                    "action_type": "click",
                    "clicked_text": "Add to cart",
                    "clicked_selector": "button.add-to-cart",
                    "url_before": "https://example.com/product",
                    "url_after": "https://example.com/product",
                    "goal_action_like": True,
                    "success_evidence": ["network_success"],
                    "result": {
                        "action_attempted": True,
                        "add_to_cart_like_button": True,
                        "cart_count_delta": 0,
                        "toast_present": False,
                        "url_changed": False,
                        "dom_changed": False,
                        "network_success": True,
                        "settle_status": "settled",
                    },
                },
            }
        )

        result = analyze_evidence_packet(packet)

        feedback = [issue for issue in result["issues"] if issue["criterion_id"] == "FEEDBACK-ACTION-RESULT-001"]
        self.assertEqual(len(feedback), 1)
        self.assertEqual(feedback[0]["severity"], 1)
        self.assertIn("network_success_only=true", feedback[0]["signals"])

    def test_copy_flow_quality_ignores_direct_label_issue_type_without_gms_alignment(self) -> None:
        packet = load_sample_packet()
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_direct_label_issue",
                "type": "interactive_components",
                "stage": "CTA",
                "source": ["dom"],
                "data": {
                    "visible_text": "Random",
                    "label_issue_type": "irrelevant_label",
                    "fix_leverage": 1.3,
                },
                "confidence": 0.95,
            }
        )

        result = analyze_evidence_packet(packet)

        copy_issues = [issue for issue in result["issues"] if issue["criterion_id"] == "COPY-FLOW-QUALITY-001"]
        self.assertEqual(copy_issues, [])

    def test_copy_flow_quality_uses_gms_alignment_and_not_observation_type(self) -> None:
        class FakeLabelRoleProvider:
            def __init__(self) -> None:
                self.calls: list[dict] = []

            def classify_label_roles(self, *, scenario_goal: str, stage: str, checkpoint_id: str, screenshot_url: str, candidates: list[dict]):
                self.calls.append(
                    {
                        "stage": stage,
                        "checkpoint_id": checkpoint_id,
                        "screenshot_url": screenshot_url,
                        "candidate_ids": [candidate["candidate_id"] for candidate in candidates],
                    }
                )
                if checkpoint_id != "cp_001":
                    return []
                return [
                    LabelRoleIssueResult(
                        candidate_id="cp_001.obs_custom_label_role",
                        has_issue=True,
                        issue_type="label_role_mismatch",
                        expected_meaning="Open account settings",
                        reason="The label suggests help instead of settings.",
                        fix_leverage=1.15,
                        confidence=0.84,
                        affected_bounds={"x": 20, "y": 20, "width": 120, "height": 44},
                    )
                ]

        packet = load_sample_packet()
        packet["artifacts"][0]["signed_url"] = "https://example.com/cp_001.png"
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_custom_label_role",
                "type": "custom_visual_text",
                "stage": "CTA",
                "source": ["dom", "screenshot"],
                "data": {
                    "visible_text": "Help",
                    "role": "button",
                    "clicked_in_scenario": True,
                    "bounds": {"x": 20, "y": 20, "width": 120, "height": 44},
                },
                "confidence": 0.7,
            }
        )
        provider = FakeLabelRoleProvider()

        result = analyze_evidence_packet(packet, label_role_provider=provider)

        copy_issues = [issue for issue in result["issues"] if issue["criterion_id"] == "COPY-FLOW-QUALITY-001"]
        self.assertEqual(len(copy_issues), 1)
        self.assertEqual(copy_issues[0]["stage"], "CTA")
        self.assertEqual(copy_issues[0]["confidence"], 0.84)
        self.assertEqual(copy_issues[0]["fix_leverage"], 1.15)
        self.assertEqual(copy_issues[0]["evidence_refs"], ["cp_001.obs_custom_label_role"])
        self.assertIn("expected_meaning=Open account settings", copy_issues[0]["signals"])
        self.assertIn("cp_001.obs_custom_label_role", provider.calls[0]["candidate_ids"])

    def test_copy_label_integrity_uses_gms_integrity_provider(self) -> None:
        class FakeLabelIntegrityProvider:
            def __init__(self) -> None:
                self.calls: list[dict] = []

            def classify_label_integrity(self, *, scenario_goal: str, stage: str, checkpoint_id: str, screenshot_url: str, candidates: list[dict]):
                self.calls.append(
                    {
                        "stage": stage,
                        "checkpoint_id": checkpoint_id,
                        "screenshot_url": screenshot_url,
                        "candidate_ids": [candidate["candidate_id"] for candidate in candidates],
                    }
                )
                if checkpoint_id != "cp_001":
                    return []
                return [
                    LabelIntegrityIssueResult(
                        candidate_id="cp_001.obs_clipped_label",
                        has_issue=True,
                        issue_type="text_clipped",
                        reason="The CTA label is visually clipped.",
                        fix_leverage=1.15,
                        confidence=0.83,
                        source="gms_image",
                        affected_bounds={"x": 20, "y": 20, "width": 120, "height": 44},
                    )
                ]

        packet = load_sample_packet()
        packet["artifacts"][0]["signed_url"] = "https://example.com/cp_001.png"
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_clipped_label",
                "type": "cta_candidate",
                "stage": "CTA",
                "source": ["dom", "screenshot"],
                "data": {
                    "visible_text": "Start application",
                    "role": "button",
                    "clicked_in_scenario": True,
                    "bounds": {"x": 20, "y": 20, "width": 120, "height": 44},
                },
                "confidence": 0.7,
            }
        )
        provider = FakeLabelIntegrityProvider()

        result = analyze_evidence_packet(packet, label_integrity_provider=provider)

        integrity_issues = [issue for issue in result["issues"] if issue["criterion_id"] == "COPY-LABEL-INTEGRITY-001"]
        self.assertEqual(len(integrity_issues), 1)
        self.assertEqual(integrity_issues[0]["stage"], "CTA")
        self.assertEqual(integrity_issues[0]["severity"], 2)
        self.assertEqual(integrity_issues[0]["confidence"], 0.83)
        self.assertEqual(integrity_issues[0]["fix_leverage"], 1.15)
        self.assertEqual(integrity_issues[0]["evidence_refs"], ["cp_001.obs_clipped_label"])
        self.assertIn("label_integrity_issue_type=text_clipped", integrity_issues[0]["signals"])
        self.assertIn("cp_001.obs_clipped_label", provider.calls[0]["candidate_ids"])

    def test_copy_label_integrity_emits_from_direct_signal(self) -> None:
        packet = load_sample_packet()
        packet["checkpoints"][0]["observations"].append(
            {
                "observation_id": "obs_direct_integrity_issue",
                "type": "cta_candidate",
                "stage": "CTA",
                "source": ["dom"],
                "data": {
                    "visible_text": "가입...",
                    "role": "button",
                    "bounds": {"x": 20, "y": 20, "width": 120, "height": 44},
                    "label_integrity": {
                        "status": "issue",
                        "issue_type": "text_truncated",
                        "confidence": 0.81,
                        "fix_leverage": 1.0,
                        "source": "deterministic",
                    },
                },
                "confidence": 0.7,
            }
        )

        result = analyze_evidence_packet(packet)

        integrity_issues = [issue for issue in result["issues"] if issue["criterion_id"] == "COPY-LABEL-INTEGRITY-001"]
        self.assertEqual(len(integrity_issues), 1)
        self.assertEqual(integrity_issues[0]["confidence"], 0.81)
        self.assertEqual(integrity_issues[0]["evidence_refs"], ["cp_001.obs_direct_integrity_issue"])

    def test_registry_rule_without_handler_fails_fast(self) -> None:
        registry = load_default_registry()
        contexts = StageContextBuilder().build(load_sample_packet())
        broken = copy.deepcopy(registry)
        broken["rules"][0]["criterion_id"] = "UNKNOWN-RULE-001"
        with self.assertRaises(RuleHandlerMissing):
            RuleEngine().evaluate(contexts=contexts, registry=broken)

    def test_rule_engine_exposes_internal_evaluations_before_issue_mapping(self) -> None:
        registry = load_default_registry()
        contexts = StageContextBuilder().build(load_sample_packet())
        evaluations = RuleEngine().evaluate_registry(contexts=contexts, registry=registry)
        statuses = {(evaluation.criterion_id, evaluation.stage): evaluation.status for evaluation in evaluations}
        self.assertEqual(statuses[("PATH-CTA-002", "CTA")], "ISSUE")
        self.assertEqual(statuses[("FRICTION-FORM-001", "INPUT")], "NOT_EVALUABLE")


class ContractShapeTest(unittest.TestCase):
    def test_judge_result_contains_required_contract_fields(self) -> None:
        result = analyze_evidence_packet(load_sample_packet())
        for field in ("schema_version", "run_id", "evidence_schema_version", "rule_registry_id", "summary", "issues", "decision_map"):
            self.assertIn(field, result)
        for issue in result["issues"]:
            for field in (
                "issue_id",
                "criterion_id",
                "stage",
                "axis",
                "severity",
                "confidence",
                "priority_score",
                "evidence_refs",
                "summary",
                "recommendations",
            ):
                self.assertIn(field, issue)
            self.assertTrue(issue["evidence_refs"])
            self.assertIn("references", issue)
        referenced_issue = next(issue for issue in result["issues"] if issue["criterion_id"] == "PATH-CTA-002")
        self.assertEqual(referenced_issue["references"][0]["label"], "USWDS Button Group")
        for item in result["decision_map"]:
            for field in ("stage", "displayName", "status", "issueIds", "summary", "evidenceRefs"):
                self.assertIn(field, item)

    def test_fallback_report_copy_does_not_expose_internal_fields(self) -> None:
        result = analyze_evidence_packet(load_sample_packet())
        forbidden_markers = (
            "rule hit",
            "evidence_refs",
            "criterion_id",
            "severity",
            "confidence",
            "overall_risk",
            "llm_overall_summary",
            "JudgeResult",
            "Source format",
            "CTA",
            "primary",
            "secondary",
            "P0 issue",
            "user-facing",
            "console error",
            "failed request",
            "accessible name",
            "aria-labelledby",
            "viewport",
        )
        self.assertTrue(result["nudges"])
        report_texts: list[str] = []
        for issue in result["issues"]:
            report_texts.extend(
                str(issue.get(field) or "")
                for field in ("summary", "impact_hypothesis")
            )
            for field in ("observations", "recommendations", "validation_questions"):
                report_texts.extend(str(item) for item in issue.get(field) or [])
        for nudge in result["nudges"]:
            for field in ("title", "rationale", "recommendation", "expected_effect", "validation_question"):
                report_texts.append(str(nudge.get(field) or ""))
        report_texts.extend(str(item.get("summary") or "") for item in result["decision_map"])
        for value in report_texts:
            for marker in forbidden_markers:
                self.assertNotIn(marker, value)


class ScoringAndProviderTest(unittest.TestCase):
    def test_priority_score_matches_documented_formula(self) -> None:
        self.assertEqual(priority_score(severity=2, stage="CTA", confidence=0.78), 2.03)
        self.assertEqual(DEFAULT_SCORING_POLICY.policy_id, "scoring_policy_v0_5_default")

    def test_scoring_policy_thresholds_are_versioned_inputs(self) -> None:
        strict_policy = ScoringPolicy(
            policy_id="strict_test_policy",
            stage_weights=DEFAULT_SCORING_POLICY.stage_weights,
            medium_risk_threshold=10,
            high_risk_threshold=20,
            critical_risk_threshold=30,
        )
        self.assertEqual(overall_risk(25, policy=strict_policy), "high")

    def test_deterministic_provider_returns_labels_only(self) -> None:
        result = DeterministicLexiconProvider().classify_cta(
            text="무료 체험 시작",
            scenario_goal="회원가입 시작",
            target_ref="cp_001.obs_002",
        )
        data = result.as_observation_data()
        self.assertEqual(set(data), semantic_response_properties() - {"provider_error"})
        self.assertEqual(data["schema_version"], semantic_schema_version())
        self.assertEqual(data["task_type"], SEMANTIC_TASK_TYPE_CTA)
        self.assertEqual(data["provider"]["type"], "deterministic")
        self.assertEqual(data["labels"]["scenario_relevance_label"], "DIRECT_GOAL_ACTION")
        self.assertNotIn("provider_type", data)
        self.assertNotIn("provider_name", data)
        self.assertNotIn("severity", data)
        self.assertNotIn("priority_score", data)

    def test_semantic_resolver_attaches_annotations_before_rules(self) -> None:
        packet = load_sample_packet()
        contexts = StageContextBuilder().build(packet)
        enriched = SemanticLabelResolver(DeterministicLexiconProvider()).enrich(contexts)
        value_annotations = enriched["VALUE"].semantic_annotations
        self.assertIn("cp_003.obs_005", value_annotations)
        self.assertIn("labels", value_annotations["cp_003.obs_005"])

    def test_semantic_resolver_degrades_provider_failure_to_unknown_label(self) -> None:
        class FailingProvider:
            def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str):
                raise RuntimeError("provider unavailable")

        packet = load_sample_packet()
        contexts = StageContextBuilder().build(packet)
        enriched = SemanticLabelResolver(FailingProvider()).enrich(contexts)
        value_annotations = enriched["VALUE"].semantic_annotations
        annotation = value_annotations["cp_003.obs_005"]
        self.assertEqual(annotation["labels"]["scenario_relevance_label"], "UNKNOWN")
        self.assertEqual(annotation["labels"]["action_specificity_label"], "UNKNOWN")
        self.assertEqual(annotation["confidence"], 0.0)
        self.assertIn("provider_error", annotation)

    def test_semantic_cta_signal_can_prevent_missing_cta_issue(self) -> None:
        class DirectActionProvider:
            def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str):
                return SemanticLabelResult(
                    target_observation_ref=target_ref,
                    provider_type="test",
                    provider_name="direct_action_provider",
                    labels={
                        "scenario_relevance_label": "DIRECT_GOAL_ACTION",
                        "action_specificity_label": "SPECIFIC_ACTION",
                    },
                    confidence=0.91,
                )

        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
        packet["checkpoints"][0]["observations"] = [
            {
                "observation_id": "obs_semantic_cta",
                "type": "cta_candidate",
                "stage": "CTA",
                "source": ["dom", "ax"],
                "data": {"visible_text": "무료 사용해보기"},
                "confidence": 0.7,
            }
        ]
        result = analyze_evidence_packet(packet, semantic_provider=DirectActionProvider())
        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertNotIn("PATH-CTA-001", criteria)

    def test_fast_path_lexicon_prefers_precision_over_recall(self) -> None:
        provider = FastPathLexiconProvider()
        clear = provider.classify_cta(text="무료 체험 시작", scenario_goal="회원가입 시작", target_ref="obs.clear")
        ambiguous = provider.classify_cta(text="무료 사용해보기", scenario_goal="회원가입 시작", target_ref="obs.ambiguous")

        self.assertEqual(clear.labels["scenario_relevance_label"], "DIRECT_GOAL_ACTION")
        self.assertEqual(clear.labels["action_specificity_label"], "SPECIFIC_ACTION")
        self.assertEqual(ambiguous.labels["scenario_relevance_label"], "UNKNOWN")
        self.assertEqual(ambiguous.labels["action_specificity_label"], "UNKNOWN")

    def test_provider_chain_invokes_fallback_for_unknown_fast_path(self) -> None:
        fallback = MockSemanticProvider(
            {
                "cp_001.obs_semantic_cta": {
                    "target_observation_ref": "cp_001.obs_semantic_cta",
                    "provider_type": "internal_llm",
                    "provider_name": "test_llm",
                    "labels": {
                        "scenario_relevance_label": "DIRECT_GOAL_ACTION",
                        "action_specificity_label": "GENERIC_BUT_ACTIONABLE",
                    },
                    "confidence": 0.82,
                }
            }
        )
        chain = SemanticProviderChain(fallback=fallback)

        result = chain.classify_cta(
            text="무료 사용해보기",
            scenario_goal="서비스 무료 체험 시작",
            target_ref="cp_001.obs_semantic_cta",
        )

        self.assertEqual(len(fallback.calls), 1)
        self.assertEqual(result.provider_type, "mock")
        self.assertEqual(result.labels["scenario_relevance_label"], "DIRECT_GOAL_ACTION")
        self.assertEqual(result.labels["action_specificity_label"], "GENERIC_BUT_ACTIONABLE")

    def test_provider_output_sanitizer_ignores_rule_owned_fields(self) -> None:
        sanitized = sanitize_semantic_label_result(
            {
                "target_observation_ref": "evil.other",
                "provider": {"type": "mcp", "name": "raw provider should not be trusted"},
                "provider_type": "internal_llm",
                "provider_name": "raw_provider_name_should_not_be_trusted",
                "labels": {
                    "scenario_relevance_label": "DIRECT_GOAL_ACTION",
                    "action_specificity_label": "SPECIFIC_ACTION",
                    "page_type_label": "LANDING_PAGE",
                    "severity": "3",
                },
                "confidence": 2.5,
                "provider_error": "secret prompt or endpoint details",
                "stage": "COMMIT",
                "severity": 3,
                "priority_score": 999,
                "evidence_refs": ["evil.ref"],
            },
            target_ref="cp_001.obs_safe",
            provider_type="internal_llm",
            provider_name="trusted_adapter",
        ).as_observation_data()

        self.assertEqual(sanitized["target_observation_ref"], "cp_001.obs_safe")
        self.assertEqual(set(sanitized), semantic_response_properties() - {"provider_error"})
        self.assertEqual(sanitized["confidence"], 1.0)
        self.assertEqual(sanitized["provider"], {"type": "internal_llm", "name": "trusted_adapter"})
        self.assertEqual(sanitized["labels"]["page_type_label"], "LANDING_PAGE")
        self.assertNotIn("stage", sanitized)
        self.assertNotIn("severity", sanitized)
        self.assertNotIn("priority_score", sanitized)
        self.assertNotIn("evidence_refs", sanitized)
        self.assertNotIn("provider_error", sanitized)
        self.assertNotIn("severity", sanitized["labels"])

    def test_sanitizer_accepts_contract_provider_object_shape(self) -> None:
        sanitized = sanitize_semantic_label_result(
            {
                "schema_version": "0.1",
                "task_type": "CTA_SEMANTIC_CLASSIFICATION",
                "target_observation_ref": "ignored.by.sanitizer",
                "provider": {"type": "internal_llm", "name": "contract_shape_provider"},
                "labels": {
                    "scenario_relevance_label": "DIRECT_GOAL_ACTION",
                    "action_specificity_label": "GENERIC_BUT_ACTIONABLE",
                },
                "confidence": 0.82,
            },
            target_ref="cp_001.obs_contract_shape",
            provider_type="internal_llm",
            provider_name="trusted_contract_adapter",
        )

        self.assertEqual(sanitized.target_observation_ref, "cp_001.obs_contract_shape")
        self.assertEqual(sanitized.provider_type, "internal_llm")
        self.assertEqual(sanitized.provider_name, "trusted_contract_adapter")

    def test_sanitizer_drops_unapproved_semantic_label_result_error(self) -> None:
        sanitized = sanitize_semantic_label_result(
            SemanticLabelResult(
                target_observation_ref="provider.supplied.ref",
                provider_type="internal_llm",
                provider_name="provider_supplied_name",
                labels={
                    "scenario_relevance_label": "DIRECT_GOAL_ACTION",
                    "action_specificity_label": "SPECIFIC_ACTION",
                },
                confidence=0.8,
                provider_error="prompt or endpoint detail",
            ),
            target_ref="cp_001.obs_error_sanitized",
            provider_type="internal_llm",
            provider_name="trusted_adapter",
        )

        self.assertIsNone(sanitized.provider_error)
        self.assertEqual(sanitized.provider_name, "trusted_adapter")

    def test_invalid_provider_labels_degrade_to_unknown(self) -> None:
        sanitized = sanitize_semantic_label_result(
            {
                "provider_type": "mcp",
                "labels": {
                    "scenario_relevance_label": "MAKE_ISSUE",
                    "action_specificity_label": "SET_PRIORITY",
                },
                "confidence": True,
            },
            target_ref="cp_001.obs_bad_labels",
            provider_name="bad_provider",
        )

        self.assertEqual(sanitized.labels["scenario_relevance_label"], "UNKNOWN")
        self.assertEqual(sanitized.labels["action_specificity_label"], "UNKNOWN")
        self.assertEqual(sanitized.confidence, 0.0)

    def test_non_finite_provider_confidence_degrades_to_zero(self) -> None:
        for confidence in ("nan", float("nan"), "inf", "-inf"):
            with self.subTest(confidence=confidence):
                sanitized = sanitize_semantic_label_result(
                    {
                        "provider_type": "internal_llm",
                        "labels": {
                            "scenario_relevance_label": "DIRECT_GOAL_ACTION",
                            "action_specificity_label": "SPECIFIC_ACTION",
                        },
                        "confidence": confidence,
                    },
                    target_ref="cp_001.obs_non_finite",
                    provider_name="bad_confidence_provider",
                )
                self.assertEqual(sanitized.confidence, 0.0)

    def test_exploratory_fast_path_terms_fall_back_to_semantic_provider(self) -> None:
        fallback = MockSemanticProvider(
            {
                "cp_001.obs_learn_more": {
                    "provider_type": "internal_llm",
                    "labels": {
                        "scenario_relevance_label": "PREREQUISITE_ACTION",
                        "action_specificity_label": "SPECIFIC_ACTION",
                    },
                    "confidence": 0.74,
                }
            }
        )
        result = SemanticProviderChain(fallback=fallback).classify_cta(
            text="더 알아보기",
            scenario_goal="구매 전 플랜 확인",
            target_ref="cp_001.obs_learn_more",
        )

        self.assertEqual(len(fallback.calls), 1)
        self.assertEqual(result.labels["scenario_relevance_label"], "PREREQUISITE_ACTION")
        self.assertEqual(result.labels["action_specificity_label"], "SPECIFIC_ACTION")

    def test_semantic_fixture_matrix_resolves_korean_cta_variants(self) -> None:
        class FixtureProvider:
            provider_type = "internal_llm"
            provider_name = "fixture_semantic_provider"

            def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str):
                case = fixture_by_text[text]
                return sanitize_semantic_label_result(
                    {
                        "target_observation_ref": target_ref,
                        "provider_type": "internal_llm",
                        "provider_name": self.provider_name,
                        "labels": case["expected_labels"],
                        "confidence": case["confidence"],
                    },
                    target_ref=target_ref,
                    provider_type=self.provider_type,
                    provider_name=self.provider_name,
                )

        fixture_by_text = {case["text"]: case for case in load_semantic_fixture("cta_variants.json")}
        chain = SemanticProviderChain(fallback=FixtureProvider())

        for case in load_semantic_fixture("cta_variants.json"):
            with self.subTest(text=case["text"]):
                result = chain.classify_cta(
                    text=case["text"],
                    scenario_goal=case["scenario_goal"],
                    target_ref=f"fixture.{case['text']}",
                )
                self.assertEqual(result.labels["scenario_relevance_label"], case["expected_labels"]["scenario_relevance_label"])
                self.assertEqual(result.labels["action_specificity_label"], case["expected_labels"]["action_specificity_label"])

    def test_semantic_provider_chain_allows_internal_llm_and_mcp_adapters(self) -> None:
        internal = InternalLLMProvider(
            lambda **kwargs: {
                "provider_type": "internal_llm",
                "labels": {
                    "scenario_relevance_label": "DIRECT_GOAL_ACTION",
                    "action_specificity_label": "GENERIC_BUT_ACTIONABLE",
                },
                "confidence": 0.82,
            }
        )
        mcp = MCPSemanticProvider(
            lambda **kwargs: {
                "provider_type": "mcp",
                "labels": {
                    "scenario_relevance_label": "RELATED_GOAL_ACTION",
                    "action_specificity_label": "SPECIFIC_ACTION",
                },
                "confidence": 0.79,
            }
        )

        internal_result = SemanticProviderChain(fallback=internal).classify_cta(
            text="무료 사용해보기", scenario_goal="서비스 무료 체험", target_ref="obs.internal"
        )
        mcp_result = SemanticProviderChain(fallback=mcp).classify_cta(
            text="내 사이트 분석하기", scenario_goal="웹사이트 분석", target_ref="obs.mcp"
        )

        self.assertEqual(internal_result.provider_type, "internal_llm")
        self.assertEqual(mcp_result.provider_type, "mcp")

    def test_low_confidence_semantic_label_does_not_count_as_primary_cta(self) -> None:
        class LowConfidenceProvider:
            def classify_cta(self, *, text: str, scenario_goal: str, target_ref: str):
                return {
                    "provider_type": "internal_llm",
                    "labels": {
                        "scenario_relevance_label": "DIRECT_GOAL_ACTION",
                        "action_specificity_label": "SPECIFIC_ACTION",
                    },
                    "confidence": 0.55,
                }

        packet = load_sample_packet()
        packet["aggregate_signals"]["primary_cta_count_by_stage"] = {}
        packet["checkpoints"][0]["observations"] = [
            {
                "observation_id": "obs_low_confidence_cta",
                "type": "cta_candidate",
                "stage": "CTA",
                "source": ["dom", "ax"],
                "data": {"visible_text": "무료 사용해보기"},
                "confidence": 0.7,
            },
            {
                "observation_id": "obs_cta_cluster_zero",
                "type": "cta_cluster",
                "stage": "CTA",
                "source": ["dom", "layout"],
                "data": {"primary_like_cta_count": 0},
                "confidence": 0.77,
            },
        ]

        result = analyze_evidence_packet(packet, semantic_provider=LowConfidenceProvider())
        path_cta_001 = [issue for issue in result["issues"] if issue["criterion_id"] == "PATH-CTA-001"]
        self.assertEqual(len(path_cta_001), 1)
        self.assertLessEqual(path_cta_001[0]["confidence"], 0.77)


if __name__ == "__main__":
    unittest.main()
