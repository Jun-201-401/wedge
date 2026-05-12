package com.wedge.run.infrastructure;

import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface RunnerMessageIdempotencyMapper {
    Optional<RunnerMessageIdempotencyRecord> findByScopeAndKeyHash(
            @Param("scope") String scope,
            @Param("idempotencyKeyHash") String idempotencyKeyHash
    );

    int insertCompletedIgnoreDuplicate(RunnerMessageIdempotencyRecord record);
}
