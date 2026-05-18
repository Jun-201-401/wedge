package com.wedge.project.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.junit.jupiter.api.Test;

class ProjectAccessMapperSqlTest {
    @Test
    void activeProjectPredicateRequiresActiveStatus() throws IOException {
        String xml = new String(
                Objects.requireNonNull(getClass().getResourceAsStream("/mapper/project/ProjectAccessMapper.xml")).readAllBytes(),
                StandardCharsets.UTF_8
        );
        int statementStart = xml.indexOf("<select id=\"existsActiveProject\"");
        int statementEnd = xml.indexOf("</select>", statementStart);
        String statement = xml.substring(statementStart, statementEnd);

        assertThat(statement)
                .contains("<select id=\"existsActiveProject\"")
                .contains("deleted_at IS NULL")
                .contains("status = 'ACTIVE'");
    }
}
