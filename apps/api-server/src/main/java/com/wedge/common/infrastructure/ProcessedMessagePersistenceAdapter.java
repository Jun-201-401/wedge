package com.wedge.common.infrastructure;

import org.springframework.stereotype.Component;

@Component
public class ProcessedMessagePersistenceAdapter {
    private final ProcessedMessageMapper processedMessageMapper;

    public ProcessedMessagePersistenceAdapter(ProcessedMessageMapper processedMessageMapper) {
        this.processedMessageMapper = processedMessageMapper;
    }

    public boolean tryMarkProcessed(String consumerName, String messageId) {
        return processedMessageMapper.insertIgnoreDuplicate(consumerName, messageId) > 0;
    }
}
