package com.wedge.report.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import com.wedge.evidence.application.ArtifactPresignedUrlGenerator;
import com.wedge.report.domain.Report;
import com.wedge.report.domain.ReportFormat;
import com.wedge.run.domain.ReportStatus;
import java.net.MalformedURLException;
import java.net.URL;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * report MyBatis XML의 soft-delete 조건을 실제 PostgreSQL에서 확인하는 opt-in 테스트다.
 *
 * 보장 범위: findById/findByRunId/findByAnalysisJobId/updateAnalysisProjection이 deleted_at report를 제외한다.
 * 보장하지 않는 범위: HTTP/security filter, report detail 조립, analysis finding/nudge projection.
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
class ReportMapperDevDbTest {
    private static final UUID USER_ID = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final UUID WORKSPACE_ID = UUID.fromString("20000000-0000-0000-0000-000000000002");
    private static final UUID PROJECT_ID = UUID.fromString("20000000-0000-0000-0000-000000000003");
    private static final UUID TEMPLATE_ID = UUID.fromString("20000000-0000-0000-0000-000000000004");
    private static final UUID TEMPLATE_VERSION_ID = UUID.fromString("20000000-0000-0000-0000-000000000005");
    private static final UUID RUN_ID = UUID.fromString("20000000-0000-0000-0000-000000000006");
    private static final UUID ACTIVE_ANALYSIS_JOB_ID = UUID.fromString("20000000-0000-0000-0000-000000000007");
    private static final UUID DELETED_ANALYSIS_JOB_ID = UUID.fromString("20000000-0000-0000-0000-000000000008");
    private static final UUID ACTIVE_REPORT_ID = UUID.fromString("20000000-0000-0000-0000-000000000009");
    private static final UUID DELETED_REPORT_ID = UUID.fromString("20000000-0000-0000-0000-000000000010");
    private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-05-12T02:00:00Z");


    @TestConfiguration
    static class ReportMapperDevDbTestConfig {
        @Bean
        ArtifactPresignedUrlGenerator artifactPresignedUrlGenerator() {
            return (artifact, ttl) -> {
                try {
                    return new URL("https://example.com/presigned-artifact");
                } catch (MalformedURLException exception) {
                    throw new IllegalStateException(exception);
                }
            };
        }
    }

    @Autowired
    private ReportMapper reportMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void setUp() {
        cleanupSeedData();
        seedReportData();
    }

    @AfterEach
    void tearDown() {
        cleanupSeedData();
    }

    @Test
    void reportMapperExcludesSoftDeletedReportsFromReadAndUpdatePaths() {
        assertThat(reportMapper.findById(ACTIVE_REPORT_ID)).isPresent();
        assertThat(reportMapper.findById(DELETED_REPORT_ID)).isEmpty();

        List<Report> reports = reportMapper.findByRunId(RUN_ID);
        assertThat(reports)
                .extracting(Report::getId)
                .contains(ACTIVE_REPORT_ID)
                .doesNotContain(DELETED_REPORT_ID);

        assertThat(reportMapper.findByAnalysisJobId(ACTIVE_ANALYSIS_JOB_ID))
                .map(Report::getId)
                .contains(ACTIVE_REPORT_ID);
        assertThat(reportMapper.findByAnalysisJobId(DELETED_ANALYSIS_JOB_ID)).isEmpty();

        Report deletedProjection = report(RUN_ID, DELETED_ANALYSIS_JOB_ID, DELETED_REPORT_ID);
        deletedProjection.setSummaryJsonb("{\"headline\":\"should not update deleted report\"}");
        deletedProjection.setDecisionMapJsonb("[]");
        assertThat(reportMapper.updateAnalysisProjection(deletedProjection)).isZero();

        Optional<String> deletedSummary = jdbcTemplate.queryForObject(
                "SELECT CAST(summary_jsonb AS TEXT) FROM report WHERE id = ?",
                (rs, rowNum) -> Optional.ofNullable(rs.getString(1)),
                DELETED_REPORT_ID
        );
        assertThat(deletedSummary).contains("{\"headline\": \"deleted\"}");
    }

    private void seedReportData() {
        jdbcTemplate.update(
                "INSERT INTO user_account (id, auth_subject, email, display_name, status) VALUES (?, ?, ?, ?, ?)",
                USER_ID,
                "report-mapper-dev-db-user",
                "report-mapper-dev-db@example.com",
                "Report Mapper Dev DB User",
                "ACTIVE"
        );
        jdbcTemplate.update(
                "INSERT INTO workspace (id, name, slug, created_by) VALUES (?, ?, ?, ?)",
                WORKSPACE_ID,
                "Report Mapper Dev DB Workspace",
                "report-mapper-dev-db-workspace",
                USER_ID
        );
        jdbcTemplate.update(
                "INSERT INTO project (id, workspace_id, name, project_key, base_url, created_by) VALUES (?, ?, ?, ?, ?, ?)",
                PROJECT_ID,
                WORKSPACE_ID,
                "Report Mapper Dev DB Project",
                "RMAPDEVDB",
                "https://example.com",
                USER_ID
        );
        jdbcTemplate.update(
                "INSERT INTO scenario_template (id, template_key, name) VALUES (?, ?, ?)",
                TEMPLATE_ID,
                "report-mapper-dev-db-template",
                "Report Mapper Dev DB Template"
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
                        + "scenario_template_version_id, scenario_plan_schema_version, scenario_plan_jsonb, status, "
                        + "result_completeness, analysis_status, created_by"
                        + ") VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, CAST(? AS jsonb), ?, ?, ?, ?)",
                RUN_ID,
                PROJECT_ID,
                "Report Mapper Dev DB Run",
                "API",
                "https://example.com",
                "Verify report mapper soft delete",
                "desktop",
                "{\"device\":\"desktop\"}",
                TEMPLATE_VERSION_ID,
                "0.5",
                "{\"schema_version\":\"0.5\",\"plan_id\":\"report-mapper-dev-db-plan\",\"steps\":[]}",
                "COMPLETED",
                "FINAL",
                "COMPLETED",
                USER_ID
        );
        insertAnalysisJob(ACTIVE_ANALYSIS_JOB_ID);
        insertAnalysisJob(DELETED_ANALYSIS_JOB_ID);
        insertReport(ACTIVE_REPORT_ID, ACTIVE_ANALYSIS_JOB_ID, null, "active");
        insertReport(DELETED_REPORT_ID, DELETED_ANALYSIS_JOB_ID, NOW.minusMinutes(1), "deleted");
    }

    private void insertAnalysisJob(UUID analysisJobId) {
        jdbcTemplate.update(
                "INSERT INTO analysis_job (id, run_id, status, created_at, finished_at) VALUES (?, ?, ?, ?, ?)",
                analysisJobId,
                RUN_ID,
                "COMPLETED",
                NOW.minusMinutes(20),
                NOW.minusMinutes(15)
        );
    }

    private void insertReport(UUID reportId, UUID analysisJobId, OffsetDateTime deletedAt, String headline) {
        jdbcTemplate.update(
                "INSERT INTO report ("
                        + "id, run_id, analysis_job_id, title, format, status, summary_jsonb, decision_map_jsonb, created_by, created_at, deleted_at"
                        + ") VALUES (?, ?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?, ?, ?)",
                reportId,
                RUN_ID,
                analysisJobId,
                "Landing CTA audit",
                "JSON",
                "READY",
                "{\"headline\":\"" + headline + "\"}",
                "[]",
                USER_ID,
                NOW.minusMinutes(10),
                deletedAt
        );
    }

    private Report report(UUID runId, UUID analysisJobId, UUID reportId) {
        Report report = new Report();
        report.setId(reportId);
        report.setRunId(runId);
        report.setAnalysisJobId(analysisJobId);
        report.setTitle("Landing CTA audit");
        report.setFormat(ReportFormat.JSON);
        report.setStatus(ReportStatus.READY);
        report.setSummaryJsonb("{\"headline\":\"updated\"}");
        report.setDecisionMapJsonb("[]");
        return report;
    }

    private void cleanupSeedData() {
        jdbcTemplate.update("DELETE FROM report WHERE id IN (?, ?)", ACTIVE_REPORT_ID, DELETED_REPORT_ID);
        jdbcTemplate.update("DELETE FROM analysis_job WHERE id IN (?, ?)", ACTIVE_ANALYSIS_JOB_ID, DELETED_ANALYSIS_JOB_ID);
        jdbcTemplate.update("DELETE FROM test_run WHERE id = ?", RUN_ID);
        jdbcTemplate.update("DELETE FROM scenario_template_version WHERE id = ?", TEMPLATE_VERSION_ID);
        jdbcTemplate.update("DELETE FROM scenario_template WHERE id = ?", TEMPLATE_ID);
        jdbcTemplate.update("DELETE FROM project WHERE id = ?", PROJECT_ID);
        jdbcTemplate.update("DELETE FROM workspace WHERE id = ?", WORKSPACE_ID);
        jdbcTemplate.update("DELETE FROM user_account WHERE id = ?", USER_ID);
    }
}
