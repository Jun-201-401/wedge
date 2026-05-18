package com.wedge.discovery.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.junit.jupiter.api.Test;

class SiteDiscoveryMapperSqlTest {
    @Test
    void markQueuedFailedCannotOverwriteAcceptedRunningDiscovery() throws IOException {
        String statement = statement("markQueuedFailed");

        assertThat(statement)
                .contains("status = 'QUEUED'")
                .doesNotContain("RUNNING");
    }

    private String statement(String statementId) throws IOException {
        String xml = new String(
                Objects.requireNonNull(getClass().getResourceAsStream("/mapper/discovery/SiteDiscoveryMapper.xml")).readAllBytes(),
                StandardCharsets.UTF_8
        );
        int statementStart = xml.indexOf("<update id=\"" + statementId + "\"");
        int statementEnd = xml.indexOf("</update>", statementStart);
        return xml.substring(statementStart, statementEnd);
    }
}
