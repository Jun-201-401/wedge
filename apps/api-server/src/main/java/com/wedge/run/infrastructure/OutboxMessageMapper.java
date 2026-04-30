package com.wedge.run.infrastructure;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface OutboxMessageMapper {
    int insert(OutboxMessageRecord message);

    Optional<OutboxMessageRecord> findById(
            @Param("outboxMessageId") UUID outboxMessageId,
            @Param("eventType") String eventType,
            @Param("maxAttempts") int maxAttempts
    );

    List<OutboxMessageRecord> findDueMessages(
            @Param("eventType") String eventType,
            @Param("now") OffsetDateTime now,
            @Param("pendingBefore") OffsetDateTime pendingBefore,
            @Param("maxAttempts") int maxAttempts,
            @Param("limit") int limit
    );

    int markPublished(@Param("outboxMessageId") UUID outboxMessageId, @Param("publishedAt") OffsetDateTime publishedAt);

    int markFailed(@Param("outboxMessageId") UUID outboxMessageId, @Param("nextAttemptAt") OffsetDateTime nextAttemptAt);
}
