package com.wedge.common.infrastructure.outbox;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.junit.jupiter.api.Test;

class OutboxMessageMapperSqlTest {
    @Test
    void markFailedMovesFinalAttemptToExhaustedWithLastError() throws IOException {
        String statement = statement("markFailed");

        assertThat(statement)
                .contains("WHEN attempt_count + 1 &gt;= #{maxAttempts} THEN 'EXHAUSTED'")
                .contains("last_error = #{lastError}")
                .contains("exhausted_at = CASE")
                .contains("status NOT IN ('PUBLISHED', 'EXHAUSTED')");
    }

    @Test
    void markPublishedDoesNotReviveExhaustedRows() throws IOException {
        String statement = statement("markPublished");

        assertThat(statement)
                .contains("last_error = NULL")
                .contains("status NOT IN ('PUBLISHED', 'EXHAUSTED')");
    }

    private String statement(String statementId) throws IOException {
        String xml = new String(
                Objects.requireNonNull(getClass().getResourceAsStream("/mapper/common/outbox/OutboxMessageMapper.xml")).readAllBytes(),
                StandardCharsets.UTF_8
        );
        int statementStart = xml.indexOf("<update id=\"" + statementId + "\"");
        int statementEnd = xml.indexOf("</update>", statementStart);
        return xml.substring(statementStart, statementEnd);
    }
}
