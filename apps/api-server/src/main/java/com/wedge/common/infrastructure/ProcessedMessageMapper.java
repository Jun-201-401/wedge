package com.wedge.common.infrastructure;

import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ProcessedMessageMapper {
    int insertIgnoreDuplicate(
            @Param("consumerName") String consumerName,
            @Param("messageId") String messageId,
            @Param("payloadHash") String payloadHash
    );

    Optional<String> findPayloadHash(
            @Param("consumerName") String consumerName,
            @Param("messageId") String messageId
    );
}
