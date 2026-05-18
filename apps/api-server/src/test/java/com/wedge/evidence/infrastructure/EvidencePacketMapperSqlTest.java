package com.wedge.evidence.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.junit.jupiter.api.Test;

class EvidencePacketMapperSqlTest {
    @Test
    void runSnapshotMaterializationUsesImmutableInsertWithoutConflictReuse() throws IOException {
        String xml = new String(
                Objects.requireNonNull(getClass().getResourceAsStream("/mapper/evidence/EvidencePacketMapper.xml")).readAllBytes(),
                StandardCharsets.UTF_8
        );
        int statementStart = xml.indexOf("<select id=\"insertRunSnapshot\"");
        int statementEnd = xml.indexOf("</select>", statementStart);
        String statement = xml.substring(statementStart, statementEnd);

        assertThat(statement)
                .contains("INSERT INTO evidence_packet")
                .doesNotContain("ON CONFLICT");
    }
}
