package com.wedge.report.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import com.wedge.report.domain.ReportShare;
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
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * report_share MyBatis XML이 실제 PostgreSQL 조건과 맞는지 확인하는 opt-in 테스트다.
 *
 * 보장 범위: insert/list, active token 조회 조건(expires_at/revoked_at/report.deleted_at), revoke idempotency.
 * 보장하지 않는 범위: HTTP/security filter, share token 난수 품질, report detail 조립.
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
class ReportShareMapperDevDbTest {
    private static final UUID USER_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000002");
    private static final UUID PROJECT_ID = UUID.fromString("10000000-0000-0000-0000-000000000003");
    private static final UUID TEMPLATE_ID = UUID.fromString("10000000-0000-0000-0000-000000000004");
    private static final UUID TEMPLATE_VERSION_ID = UUID.fromString("10000000-0000-0000-0000-000000000005");
    private static final UUID RUN_ID = UUID.fromString("10000000-0000-0000-0000-000000000006");
    private static final UUID ANALYSIS_JOB_ID = UUID.fromString("10000000-0000-0000-0000-000000000007");
    private static final UUID REPORT_ID = UUID.fromString("10000000-0000-0000-0000-000000000008");
    private static final UUID DELETED_REPORT_ID = UUID.fromString("10000000-0000-0000-0000-000000000009");
    private static final UUID ACTIVE_SHARE_ID = UUID.fromString("10000000-0000-0000-0000-000000000010");
    private static final UUID EXPIRED_SHARE_ID = UUID.fromString("10000000-0000-0000-0000-000000000011");
    private static final UUID REVOKED_SHARE_ID = UUID.fromString("10000000-0000-0000-0000-000000000012");
    private static final UUID DELETED_REPORT_SHARE_ID = UUID.fromString("10000000-0000-0000-0000-000000000013");

    private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-05-06T03:00:00Z");

    @Autowired
    private ReportShareMapper reportShareMapper;

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
    void reportShareMapperPersistsListsFindsActiveTokenAndRevokesOnce() {
        ReportShare activeShare = share(ACTIVE_SHARE_ID, REPORT_ID, "active-token", NOW.plusMinutes(10), null);

        reportShareMapper.insert(activeShare);
        insertShare(EXPIRED_SHARE_ID, REPORT_ID, "expired-token", NOW.minusSeconds(1), null);
        insertShare(REVOKED_SHARE_ID, REPORT_ID, "revoked-token", NOW.plusMinutes(10), NOW.minusMinutes(1));
        insertShare(DELETED_REPORT_SHARE_ID, DELETED_REPORT_ID, "deleted-report-token", NOW.plusMinutes(10), null);

        List<ReportShare> shares = reportShareMapper.findByReportId(REPORT_ID);
        assertThat(shares)
                .extracting(ReportShare::getShareToken)
                .contains("active-token", "expired-token", "revoked-token")
                .doesNotContain("deleted-report-token");

        Optional<ReportShare> found = reportShareMapper.findActiveByToken("active-token", NOW);
        assertThat(found).isPresent();
        assertThat(found.get().getId()).isEqualTo(ACTIVE_SHARE_ID);
        assertThat(found.get().getReportId()).isEqualTo(REPORT_ID);

        Optional<ReportShare> foundByReport = reportShareMapper.findActiveByReportId(REPORT_ID, NOW);
        assertThat(foundByReport).isPresent();
        assertThat(foundByReport.get().getId()).isEqualTo(ACTIVE_SHARE_ID);

        assertThat(reportShareMapper.findActiveByToken("expired-token", NOW)).isEmpty();
        assertThat(reportShareMapper.findActiveByToken("revoked-token", NOW)).isEmpty();
        assertThat(reportShareMapper.findActiveByToken("deleted-report-token", NOW)).isEmpty();
        assertThat(reportShareMapper.findActiveByToken("missing-token", NOW)).isEmpty();

        assertThat(reportShareMapper.revoke(ACTIVE_SHARE_ID, REPORT_ID, NOW)).isEqualTo(1);
        assertThat(reportShareMapper.findActiveByToken("active-token", NOW)).isEmpty();
        assertThat(reportShareMapper.findActiveByReportId(REPORT_ID, NOW)).isEmpty();
        assertThat(reportShareMapper.revoke(ACTIVE_SHARE_ID, REPORT_ID, NOW.plusSeconds(1))).isZero();
    }

    private void seedReportData() {
        jdbcTemplate.update(
                "INSERT INTO user_account (id, auth_subject, email, display_name, status) VALUES (?, ?, ?, ?, ?)",
                USER_ID,
                "report-share-dev-db-user",
                "report-share-dev-db@example.com",
                "Report Share Dev DB User",
                "ACTIVE"
        );
        jdbcTemplate.update(
                "INSERT INTO workspace (id, name, slug, created_by) VALUES (?, ?, ?, ?)",
                WORKSPACE_ID,
                "Report Share Dev DB Workspace",
                "report-share-dev-db-workspace",
                USER_ID
        );
        jdbcTemplate.update(
                "INSERT INTO project (id, workspace_id, name, project_key, base_url, created_by) VALUES (?, ?, ?, ?, ?, ?)",
                PROJECT_ID,
                WORKSPACE_ID,
                "Report Share Dev DB Project",
                "RSHAREDEVDB",
                "https://example.com",
                USER_ID
        );
        jdbcTemplate.update(
                "INSERT INTO scenario_template (id, template_key, name) VALUES (?, ?, ?)",
                TEMPLATE_ID,
                "report-share-dev-db-template",
                "Report Share Dev DB Template"
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
                "Report Share Dev DB Run",
                "API",
                "https://example.com",
                "Verify report share mapper",
                "desktop",
                "{\"device\":\"desktop\"}",
                TEMPLATE_VERSION_ID,
                "0.5",
                "{\"schema_version\":\"0.5\",\"plan_id\":\"report-share-dev-db-plan\",\"steps\":[]}",
                "COMPLETED",
                "FINAL",
                "COMPLETED",
                USER_ID
        );
        jdbcTemplate.update(
                "INSERT INTO analysis_job (id, run_id, status, created_at, finished_at) VALUES (?, ?, ?, ?, ?)",
                ANALYSIS_JOB_ID,
                RUN_ID,
                "COMPLETED",
                NOW.minusMinutes(20),
                NOW.minusMinutes(15)
        );
        insertReport(REPORT_ID, null);
        insertReport(DELETED_REPORT_ID, NOW.minusMinutes(1));
    }

    private void insertReport(UUID reportId, OffsetDateTime deletedAt) {
        jdbcTemplate.update(
                "INSERT INTO report ("
                        + "id, run_id, analysis_job_id, title, format, status, summary_jsonb, decision_map_jsonb, created_by, created_at, deleted_at"
                        + ") VALUES (?, ?, ?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), ?, ?, ?)",
                reportId,
                RUN_ID,
                ANALYSIS_JOB_ID,
                "Landing CTA audit",
                "JSON",
                "READY",
                "{\"headline\":\"CTA issue\"}",
                "[]",
                USER_ID,
                NOW.minusMinutes(10),
                deletedAt
        );
    }

    private void insertShare(UUID id, UUID reportId, String token, OffsetDateTime expiresAt, OffsetDateTime revokedAt) {
        jdbcTemplate.update(
                "INSERT INTO report_share (id, report_id, share_token, access_level, expires_at, revoked_at, created_by, created_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                id,
                reportId,
                token,
                "VIEW",
                expiresAt,
                revokedAt,
                USER_ID,
                NOW.minusMinutes(5)
        );
    }

    private ReportShare share(UUID id, UUID reportId, String token, OffsetDateTime expiresAt, OffsetDateTime revokedAt) {
        ReportShare share = new ReportShare();
        share.setId(id);
        share.setReportId(reportId);
        share.setShareToken(token);
        share.setAccessLevel("VIEW");
        share.setExpiresAt(expiresAt);
        share.setRevokedAt(revokedAt);
        share.setCreatedBy(USER_ID);
        share.setCreatedAt(NOW.minusMinutes(5));
        return share;
    }

    private void cleanupSeedData() {
        jdbcTemplate.update("DELETE FROM report_share WHERE id IN (?, ?, ?, ?)",
                ACTIVE_SHARE_ID,
                EXPIRED_SHARE_ID,
                REVOKED_SHARE_ID,
                DELETED_REPORT_SHARE_ID
        );
        jdbcTemplate.update("DELETE FROM report WHERE id IN (?, ?)", REPORT_ID, DELETED_REPORT_ID);
        jdbcTemplate.update("DELETE FROM analysis_job WHERE id = ?", ANALYSIS_JOB_ID);
        jdbcTemplate.update("DELETE FROM test_run WHERE id = ?", RUN_ID);
        jdbcTemplate.update("DELETE FROM scenario_template_version WHERE id = ?", TEMPLATE_VERSION_ID);
        jdbcTemplate.update("DELETE FROM scenario_template WHERE id = ?", TEMPLATE_ID);
        jdbcTemplate.update("DELETE FROM project WHERE id = ?", PROJECT_ID);
        jdbcTemplate.update("DELETE FROM workspace WHERE id = ?", WORKSPACE_ID);
        jdbcTemplate.update("DELETE FROM user_account WHERE id = ?", USER_ID);
    }
}
