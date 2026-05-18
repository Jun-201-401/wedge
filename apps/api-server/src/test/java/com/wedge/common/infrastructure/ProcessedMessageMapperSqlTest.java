package com.wedge.common.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.junit.jupiter.api.Test;

class ProcessedMessageMapperSqlTest {
    @Test
    void insertPersistsPayloadHashWithMessageIdentity() throws IOException {
        String statement = statement("insertIgnoreDuplicate", "insert");

        assertThat(statement)
                .contains("payload_hash")
                .contains("#{payloadHash}")
                .contains("ON CONFLICT (consumer_name, message_id) DO NOTHING");
    }

    @Test
    void findPayloadHashReadsExistingMessageHash() throws IOException {
        String statement = statement("findPayloadHash", "select");

        assertThat(statement)
                .contains("SELECT payload_hash")
                .contains("consumer_name = #{consumerName}")
                .contains("message_id = #{messageId}");
    }

    private String statement(String statementId, String tagName) throws IOException {
        String xml = new String(
                Objects.requireNonNull(getClass().getResourceAsStream("/mapper/common/ProcessedMessageMapper.xml")).readAllBytes(),
                StandardCharsets.UTF_8
        );
        int statementStart = xml.indexOf("<" + tagName + " id=\"" + statementId + "\"");
        int statementEnd = xml.indexOf("</" + tagName + ">", statementStart);
        return xml.substring(statementStart, statementEnd);
    }
}
