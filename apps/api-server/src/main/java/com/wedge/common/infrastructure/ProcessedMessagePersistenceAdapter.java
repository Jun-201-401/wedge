package com.wedge.common.infrastructure;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import org.springframework.stereotype.Component;

@Component
public class ProcessedMessagePersistenceAdapter {
    private final ProcessedMessageMapper processedMessageMapper;
    private final ObjectMapper objectMapper;

    public ProcessedMessagePersistenceAdapter(ProcessedMessageMapper processedMessageMapper, ObjectMapper objectMapper) {
        this.processedMessageMapper = processedMessageMapper;
        this.objectMapper = objectMapper.copy().configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);
    }

    public boolean tryMarkProcessed(String consumerName, String messageId) {
        return tryMarkProcessed(consumerName, messageId, null);
    }

    public boolean tryMarkProcessed(String consumerName, String messageId, Object payload) {
        String payloadHash = payload == null ? null : sha256Hex(payload);
        int inserted = processedMessageMapper.insertIgnoreDuplicate(consumerName, messageId, payloadHash);
        if (inserted > 0) {
            return true;
        }
        processedMessageMapper.findPayloadHash(consumerName, messageId)
                .filter(storedHash -> storedHash != null && payloadHash != null && !storedHash.equals(payloadHash))
                .ifPresent(storedHash -> {
                    throw new BusinessException(
                            ErrorCode.STATE_CONFLICT,
                            "Callback event id was reused with a different payload."
                    );
                });
        return false;
    }

    private String sha256Hex(Object payload) {
        try {
            byte[] bytes = objectMapper.writeValueAsBytes(payload);
            return toHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (JsonProcessingException exception) {
            throw new BusinessException(ErrorCode.INVALID_REQUEST, "Callback payload is not JSON serializable.", null, exception);
        } catch (NoSuchAlgorithmException exception) {
            throw new BusinessException(ErrorCode.INTERNAL_ERROR, "SHA-256 digest is not available.", null, exception);
        }
    }

    private String toHex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            builder.append(String.format("%02x", value));
        }
        return builder.toString();
    }
}
