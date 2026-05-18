package com.wedge.evidence.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.junit.jupiter.api.Test;

class CheckpointMapperSqlTest {
    @Test
    void discoveryCheckpointInsertIgnoresDuplicateKeysLikeRunCheckpoints() throws IOException {
        String xml = new String(
                Objects.requireNonNull(getClass().getResourceAsStream("/mapper/evidence/CheckpointMapper.xml")).readAllBytes(),
                StandardCharsets.UTF_8
        );
        int statementStart = xml.indexOf("<insert id=\"insertDiscovery\"");
        int statementEnd = xml.indexOf("</insert>", statementStart);
        String statement = xml.substring(statementStart, statementEnd);

        assertThat(statement)
                .contains("INSERT INTO checkpoint")
                .contains("ON CONFLICT (discovery_id, checkpoint_key) DO NOTHING");
    }
}
