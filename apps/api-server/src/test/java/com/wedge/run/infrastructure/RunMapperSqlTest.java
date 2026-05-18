package com.wedge.run.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.junit.jupiter.api.Test;

class RunMapperSqlTest {
    @Test
    void insertPersistsCreateIdempotencyMetadata() throws IOException {
        String statement = statement("insert", "insert");

        assertThat(statement)
                .contains("idempotency_key")
                .contains("idempotency_request_hash")
                .contains("#{idempotencyKey}")
                .contains("#{idempotencyRequestHash}");
    }

    @Test
    void insertIgnoreDuplicateUsesConflictFreeInsertForCreateIdempotencyRace() throws IOException {
        String statement = statement("insertIgnoreDuplicate", "insert");

        assertThat(statement)
                .contains("idempotency_key")
                .contains("idempotency_request_hash")
                .contains("ON CONFLICT DO NOTHING");
    }

    @Test
    void findByIdempotencyKeyScopesToProjectCreatorAndLiveRows() throws IOException {
        String statement = statement("findByIdempotencyKey", "select");

        assertThat(statement)
                .contains("project_id = #{projectId}")
                .contains("created_by = #{createdBy}")
                .contains("idempotency_key = #{idempotencyKey}")
                .contains("deleted_at IS NULL");
    }

    private String statement(String statementId, String tagName) throws IOException {
        String xml = new String(
                Objects.requireNonNull(getClass().getResourceAsStream("/mapper/run/RunMapper.xml")).readAllBytes(),
                StandardCharsets.UTF_8
        );
        int statementStart = xml.indexOf("<" + tagName + " id=\"" + statementId + "\"");
        int statementEnd = xml.indexOf("</" + tagName + ">", statementStart);
        return xml.substring(statementStart, statementEnd);
    }
}
