package com.wedge.run.application;

import static org.assertj.core.api.Assertions.assertThat;

import com.wedge.evidence.application.EvidenceService;
import com.wedge.run.application.command.RunnerArtifactCommand;
import com.wedge.run.application.command.RunnerArtifactsCommand;
import com.wedge.run.application.command.RunnerCallbackContext;
import com.wedge.run.application.command.RunnerCheckpointCommand;
import com.wedge.run.application.command.RunnerCheckpointsCommand;
import com.wedge.run.application.command.RunnerStepEventCommand;
import com.wedge.run.application.command.RunnerStepEventsCommand;
import com.wedge.run.domain.RunStatus;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 실제 Runner Docker나 HTTP endpoint를 실행하지 않고, Runner가 보낼 callback payload를 직접 만들어
 * Spring service -> MyBatis -> dev PostgreSQL 저장/조회 경로를 검증한다.
 *
 * 보장 범위: checkpoint / observation / artifact 저장, stepKey -> stepId 연결, latest evidence pointer 갱신,
 * EvidencePacket 재조립.
 * 보장하지 않는 범위: 브라우저 시나리오 실행, HTTP/security filter 경유, Runner Docker full smoke.
 *
 * 실행 전제: dev PostgreSQL이 떠 있고, `-Dwedge.dev-db-tests=true`를 명시해야 한다.
 */
@Tag("dev-db")
@EnabledIfSystemProperty(named = "wedge.dev-db-tests", matches = "true")
@SpringBootTest(properties = {
        "spring.datasource.url=${SPRING_DATASOURCE_URL:jdbc:postgresql://localhost:5432/wedge_dev}",
        "spring.datasource.username=${SPRING_DATASOURCE_USERNAME:ssafy}",
        "spring.datasource.password=${SPRING_DATASOURCE_PASSWORD:ssafy}",
        "spring.datasource.driver-class-name=org.postgresql.Driver",
        "jwt.secret=dev-db-test-secret-must-be-at-least-32-bytes",
        "wedge.internal.service-token=wedge-local-dev-internal-service-token"
})
class RunnerEvidencePersistenceDevDbTest {
    private static final UUID WORKSPACE_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID PROJECT_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID TEMPLATE_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID TEMPLATE_VERSION_ID = UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final UUID RUN_ID = UUID.fromString("55555555-5555-5555-5555-555555555555");
    private static final UUID STEP_ID = UUID.fromString("66666666-6666-6666-6666-666666666666");
    private static final UUID ARTIFACT_ID = UUID.fromString("77777777-7777-7777-7777-777777777777");

    private static final String STEP_KEY = "step_001_click_cta";
    private static final String STEP_STARTED_EVENT_ID = "dev-db-runner-step-started-event";
    private static final String STEP_COMPLETED_EVENT_ID = "dev-db-runner-step-completed-event";
    private static final String CHECKPOINT_EVENT_ID = "dev-db-runner-checkpoints-event";
    private static final String ARTIFACT_EVENT_ID = "dev-db-runner-artifacts-event";

    @Autowired
    private RunnerCallbackService runnerCallbackService;

    @Autowired
    private EvidenceService evidenceService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void setUp() {
        cleanupSeedData();
        seedRunData();
    }

    @AfterEach
    void tearDown() {
        cleanupSeedData();
    }

    @Test
    @SuppressWarnings("unchecked")
    void runnerEvidenceCallbacksPersistCheckpointObservationArtifactAndLatestPointers() {
        RunnerCallbackAckResponse checkpointResponse = runnerCallbackService.handleCheckpoints(
                RUN_ID,
                checkpointCommand(),
                context(CHECKPOINT_EVENT_ID)
        );
        RunnerCallbackAckResponse artifactResponse = runnerCallbackService.handleArtifacts(
                RUN_ID,
                artifactCommand(),
                context(ARTIFACT_EVENT_ID)
        );

        assertThat(checkpointResponse.runId()).isEqualTo(RUN_ID);
        assertThat(checkpointResponse.checkpointCount()).isEqualTo(1);
        assertThat(artifactResponse.runId()).isEqualTo(RUN_ID);
        assertThat(artifactResponse.artifactCount()).isEqualTo(1);

        UUID checkpointId = selectUuid("SELECT id FROM checkpoint WHERE run_id = ? AND checkpoint_key = ?", RUN_ID, "cp_dev_db_001");
        assertThat(checkpointId).isNotNull();

        Map<String, Object> checkpoint = selectRow(
                "SELECT run_id, step_id, stage, CAST(trigger_jsonb AS TEXT) AS trigger_jsonb, "
                        + "CAST(state_jsonb AS TEXT) AS state_jsonb, CAST(artifact_refs_jsonb AS TEXT) AS artifact_refs_jsonb "
                        + "FROM checkpoint WHERE id = ?",
                checkpointId
        );
        assertThat(checkpoint.get("run_id")).isEqualTo(RUN_ID);
        assertThat(checkpoint.get("step_id")).isEqualTo(STEP_ID);
        assertThat(checkpoint.get("stage")).isEqualTo("FIRST_VIEW");
        assertThat((String) checkpoint.get("trigger_jsonb")).contains("click", "Start free");
        assertThat((String) checkpoint.get("state_jsonb")).contains("https://example.com/signup");
        assertThat((String) checkpoint.get("artifact_refs_jsonb")).contains(ARTIFACT_ID.toString());

        Map<String, Object> observation = selectRow(
                "SELECT checkpoint_id, run_id, observation_key, observation_type, stage, "
                        + "CAST(sources_jsonb AS TEXT) AS sources_jsonb, CAST(data_jsonb AS TEXT) AS data_jsonb, confidence "
                        + "FROM observation WHERE run_id = ? AND observation_key = ?",
                RUN_ID,
                "cp_dev_db_001.obs_cta"
        );
        assertThat(observation.get("checkpoint_id")).isEqualTo(checkpointId);
        assertThat(observation.get("run_id")).isEqualTo(RUN_ID);
        assertThat(observation.get("observation_type")).isEqualTo("cta_candidate");
        assertThat(observation.get("stage")).isEqualTo("CTA");
        assertThat((String) observation.get("sources_jsonb")).contains("dom", "ax");
        assertThat((String) observation.get("data_jsonb")).contains("Start free", "hero-primary");
        assertThat((BigDecimal) observation.get("confidence")).isEqualByComparingTo("0.870");

        Map<String, Object> artifact = selectRow(
                "SELECT run_id, step_id, artifact_type, s3_bucket, s3_key, mime_type, width, height, size_bytes, sha256 "
                        + "FROM artifact WHERE id = ?",
                ARTIFACT_ID
        );
        assertThat(artifact.get("run_id")).isEqualTo(RUN_ID);
        assertThat(artifact.get("step_id")).isEqualTo(STEP_ID);
        assertThat(artifact.get("artifact_type")).isEqualTo("SCREENSHOT");
        assertThat(artifact.get("s3_bucket")).isEqualTo("wedge-dev-artifacts");
        assertThat(artifact.get("s3_key")).isEqualTo("runs/dev-db/cp_dev_db_001.png");
        assertThat(artifact.get("mime_type")).isEqualTo("image/png");
        assertThat(artifact.get("width")).isEqualTo(1440);
        assertThat(artifact.get("height")).isEqualTo(900);
        assertThat((Long) artifact.get("size_bytes")).isEqualTo(2048L);
        assertThat(artifact.get("sha256")).isEqualTo("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

        Map<String, Object> runPointers = selectRow(
                "SELECT latest_checkpoint_id, latest_artifact_id, current_step_order FROM test_run WHERE id = ?",
                RUN_ID
        );
        assertThat(runPointers.get("latest_checkpoint_id")).isEqualTo(checkpointId);
        assertThat(runPointers.get("latest_artifact_id")).isEqualTo(ARTIFACT_ID);
        assertThat(runPointers.get("current_step_order")).isEqualTo(1);

        Map<String, Object> evidencePacket = evidenceService.getRunEvidencePacket(RUN_ID);
        Map<String, Object> aggregateSignals = (Map<String, Object>) evidencePacket.get("aggregate_signals");
        List<Map<String, Object>> checkpoints = (List<Map<String, Object>>) evidencePacket.get("checkpoints");
        List<Map<String, Object>> observations = (List<Map<String, Object>>) checkpoints.get(0).get("observations");

        assertThat(evidencePacket.get("run_id")).isEqualTo(RUN_ID.toString());
        assertThat(aggregateSignals)
                .containsEntry("checkpoint_count", 1)
                .containsEntry("observation_count", 1)
                .containsEntry("artifact_count", 1)
                .containsEntry("cta_candidate_count", 1L);
        assertThat(observations).first().satisfies(observationMap -> assertThat(observationMap)
                .containsEntry("observation_id", "cp_dev_db_001.obs_cta")
                .containsEntry("type", "cta_candidate")
                .containsEntry("stage", "CTA"));
    }

    @Test
    void runnerStepEventCallbacksPersistRunEventsAndStepStateWithNullableFailureColumns() {
        RunnerCallbackAckResponse startedResponse = runnerCallbackService.handleStepEvents(
                RUN_ID,
                stepEventsCommand("STEP_STARTED", "2026-04-28T00:00:00Z"),
                context(STEP_STARTED_EVENT_ID)
        );
        RunnerCallbackAckResponse completedResponse = runnerCallbackService.handleStepEvents(
                RUN_ID,
                stepEventsCommand("STEP_COMPLETED", "2026-04-28T00:00:01Z"),
                context(STEP_COMPLETED_EVENT_ID)
        );

        assertThat(startedResponse.runId()).isEqualTo(RUN_ID);
        assertThat(startedResponse.status()).isEqualTo(RunStatus.RUNNING);
        assertThat(startedResponse.eventCount()).isEqualTo(1);
        assertThat(completedResponse.eventCount()).isEqualTo(1);

        Map<String, Object> step = selectRow(
                "SELECT status, started_at, finished_at, error_code, error_message FROM test_run_step WHERE id = ?",
                STEP_ID
        );
        assertThat(step.get("status")).isEqualTo("PASSED");
        assertThat(step.get("started_at")).isNotNull();
        assertThat(step.get("finished_at")).isNotNull();
        assertThat(step.get("error_code")).isNull();
        assertThat(step.get("error_message")).isNull();

        List<Map<String, Object>> events = jdbcTemplate.queryForList(
                "SELECT event_type, source, CAST(payload_jsonb AS TEXT) AS payload_jsonb "
                        + "FROM test_run_event WHERE run_id = ? ORDER BY occurred_at",
                RUN_ID
        );
        assertThat(events).hasSize(2);
        assertThat(events).extracting(event -> event.get("event_type"))
                .containsExactly("STEP_STARTED", "STEP_COMPLETED");
        assertThat(events).extracting(event -> event.get("source"))
                .containsExactly("RUNNER", "RUNNER");
        assertThat((String) events.get(0).get("payload_jsonb")).contains("dev-db step event");
    }

    private RunnerCheckpointsCommand checkpointCommand() {
        return new RunnerCheckpointsCommand(List.of(new RunnerCheckpointCommand(
                "cp_dev_db_001",
                STEP_KEY,
                "FIRST_VIEW",
                Map.of("actionType", "click", "target", "text=Start free"),
                Map.of("strategy", "network_idle", "durationMs", 340, "status", "settled"),
                340,
                Map.of(
                        "url", "https://example.com/signup",
                        "viewport", Map.of("width", 1440, "height", 900)
                ),
                List.of(Map.of(
                        "observation_id", "cp_dev_db_001.obs_cta",
                        "type", "cta_candidate",
                        "source", List.of("dom", "ax"),
                        "target", "text=Start free",
                        "role", "button",
                        "locator", "#hero-primary",
                        "confidence", 0.87
                )),
                List.of(Map.of("type", "last_action", "action", "click")),
                List.of(ARTIFACT_ID.toString())
        )));
    }

    private RunnerStepEventsCommand stepEventsCommand(String eventType, String occurredAt) {
        return new RunnerStepEventsCommand(List.of(new RunnerStepEventCommand(
                UUID.randomUUID(),
                1,
                STEP_KEY,
                eventType,
                OffsetDateTime.parse(occurredAt),
                Map.of("message", "dev-db step event")
        )));
    }

    private RunnerArtifactsCommand artifactCommand() {
        return new RunnerArtifactsCommand(List.of(new RunnerArtifactCommand(
                ARTIFACT_ID,
                STEP_KEY,
                "SCREENSHOT",
                "wedge-dev-artifacts",
                "runs/dev-db/cp_dev_db_001.png",
                "image/png",
                1440,
                900,
                2048L,
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                OffsetDateTime.parse("2026-04-28T00:00:00Z")
        )));
    }

    private RunnerCallbackContext context(String eventId) {
        return new RunnerCallbackContext("worker-dev-db", eventId, "signature-dev-db");
    }

    private void seedRunData() {
        jdbcTemplate.update(
                "INSERT INTO workspace (id, name, slug) VALUES (?, ?, ?)",
                WORKSPACE_ID,
                "Dev DB Evidence Workspace",
                "dev-db-evidence-workspace"
        );
        jdbcTemplate.update(
                "INSERT INTO project (id, workspace_id, name, project_key, base_url) VALUES (?, ?, ?, ?, ?)",
                PROJECT_ID,
                WORKSPACE_ID,
                "Dev DB Evidence Project",
                "DEVDBEVIDENCE",
                "https://example.com"
        );
        jdbcTemplate.update(
                "INSERT INTO scenario_template (id, template_key, name) VALUES (?, ?, ?)",
                TEMPLATE_ID,
                "dev-db-evidence-template",
                "Dev DB Evidence Template"
        );
        jdbcTemplate.update(
                "INSERT INTO scenario_template_version (id, template_id, version_label, scenario_schema_version, definition_jsonb, is_default) "
                        + "VALUES (?, ?, ?, ?, CAST(? AS jsonb), ?)",
                TEMPLATE_VERSION_ID,
                TEMPLATE_ID,
                "v1",
                "0.5",
                "{\"steps\":[]}",
                true
        );
        jdbcTemplate.update(
                "INSERT INTO test_run ("
                        + "id, project_id, name, trigger_source, start_url, goal, device_preset, environment_jsonb, "
                        + "scenario_template_version_id, scenario_plan_schema_version, scenario_plan_jsonb, status, result_completeness, analysis_status"
                        + ") VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, CAST(? AS jsonb), ?, ?, ?)",
                RUN_ID,
                PROJECT_ID,
                "Dev DB Evidence Run",
                "API",
                "https://example.com",
                "Verify evidence persistence",
                "desktop",
                "{\"device\":\"desktop\"}",
                TEMPLATE_VERSION_ID,
                "0.5",
                "{\"schema_version\":\"0.5\",\"plan_id\":\"dev-db-plan\",\"scenario_type\":\"template\",\"start_url\":\"https://example.com\",\"environment\":{\"device\":\"desktop\"},\"steps\":[{\"step_id\":\"step_001_click_cta\",\"description\":\"Click primary CTA\",\"stage\":\"CTA\",\"action\":{\"type\":\"click\"}}]}",
                "STARTING",
                "NONE",
                "NOT_STARTED"
        );
        jdbcTemplate.update(
                "INSERT INTO test_run_step (id, run_id, step_order, step_key, step_name, stage, step_type, status) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                STEP_ID,
                RUN_ID,
                1,
                STEP_KEY,
                "Click primary CTA",
                "CTA",
                "CLICK",
                "PENDING"
        );
    }

    private void cleanupSeedData() {
        jdbcTemplate.update("DELETE FROM observation WHERE run_id = ?", RUN_ID);
        jdbcTemplate.update("DELETE FROM checkpoint WHERE run_id = ?", RUN_ID);
        jdbcTemplate.update("DELETE FROM artifact WHERE run_id = ?", RUN_ID);
        jdbcTemplate.update("DELETE FROM test_run_event WHERE run_id = ?", RUN_ID);
        jdbcTemplate.update(
                "DELETE FROM processed_message WHERE consumer_name IN (?, ?, ?) AND message_id IN (?, ?, ?, ?)",
                "runner.step-events",
                "runner.checkpoints",
                "runner.artifacts",
                STEP_STARTED_EVENT_ID,
                STEP_COMPLETED_EVENT_ID,
                CHECKPOINT_EVENT_ID,
                ARTIFACT_EVENT_ID
        );
        jdbcTemplate.update("DELETE FROM test_run_step WHERE run_id = ?", RUN_ID);
        jdbcTemplate.update("DELETE FROM test_run WHERE id = ?", RUN_ID);
        jdbcTemplate.update("DELETE FROM scenario_template_version WHERE id = ?", TEMPLATE_VERSION_ID);
        jdbcTemplate.update("DELETE FROM scenario_template WHERE id = ?", TEMPLATE_ID);
        jdbcTemplate.update("DELETE FROM project WHERE id = ?", PROJECT_ID);
        jdbcTemplate.update("DELETE FROM workspace WHERE id = ?", WORKSPACE_ID);
    }

    private Map<String, Object> selectRow(String sql, Object... arguments) {
        return jdbcTemplate.queryForMap(sql, arguments);
    }

    private UUID selectUuid(String sql, Object... arguments) {
        return jdbcTemplate.queryForObject(sql, UUID.class, arguments);
    }
}
