from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from app.normalization import SemanticLabelResolver
from app.providers import DeterministicLexiconProvider, SemanticLabelResult
from app.rule_engine import analyze_evidence_packet, load_default_registry
from app.rule_engine.contract_schema import schema_enum, schema_properties
from app.rule_engine.evaluator import RuleEngine, RuleHandlerMissing
from app.rule_engine.registry_loader import RuleRegistryError, validate_registry
from app.rule_engine.scoring import DEFAULT_SCORING_POLICY, ScoringPolicy, overall_risk, priority_score
from app.stage import StageContextBuilder, StageResolver

REPO_ROOT = Path(__file__).resolve().parents[4]
SAMPLE_EVIDENCE_PATH = REPO_ROOT / "packages/contracts/examples/sample-evidence-packet.json"
RULE_ENGINE_FIXTURE_ROOT = Path(__file__).resolve().parent / "fixtures/rule_engine"


def load_sample_packet() -> dict:
    with SAMPLE_EVIDENCE_PATH.open(encoding="utf-8") as file:
        return json.load(file)


def load_rule_fixture(rule_id: str, fixture_name: str) -> dict:
    with (RULE_ENGINE_FIXTURE_ROOT / rule_id / fixture_name).open(encoding="utf-8") as file:
        return json.load(file)


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


class RuleEngineTest(unittest.TestCase):
    def test_sample_packet_emits_cta_competition_only(self) -> None:
        result = analyze_evidence_packet(load_sample_packet())
        criteria = [issue["criterion_id"] for issue in result["issues"]]
        self.assertEqual(criteria, ["PATH-CTA-002"])
        issue = result["issues"][0]
        self.assertEqual(issue["stage"], "CTA")
        self.assertEqual(issue["evidence_refs"], ["cp_001.obs_002"])
        self.assertEqual(issue["priority_score"], 2.03)
        decision_by_stage = {item["stage"]: item for item in result["decision_map"]}
        self.assertEqual(decision_by_stage["CTA"]["status"], "WARNING")
        self.assertEqual(decision_by_stage["FIRST_VIEW"]["status"], "PASS")
        self.assertEqual(decision_by_stage["COMMIT"]["status"], "NOT_APPLICABLE")
        self.assertEqual(result["summary"]["task_success"], "partial")

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
        self.assertIn("cp_002.state.network_summary", reliability[0]["evidence_refs"])

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
        for item in result["decision_map"]:
            for field in ("stage", "displayName", "status", "issueIds", "summary", "evidenceRefs"):
                self.assertIn(field, item)


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
        self.assertEqual(data["labels"]["scenario_relevance_label"], "DIRECT_GOAL_ACTION")
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


if __name__ == "__main__":
    unittest.main()
