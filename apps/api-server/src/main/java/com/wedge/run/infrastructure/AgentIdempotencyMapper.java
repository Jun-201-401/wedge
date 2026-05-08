package com.wedge.run.infrastructure;

import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface AgentIdempotencyMapper {
    Optional<AgentIdempotencyRecord> findByKeyHash(@Param("idempotencyKeyHash") String idempotencyKeyHash);

    int insertClaimIgnoreDuplicate(AgentIdempotencyRecord record);

    int claimExpired(AgentIdempotencyRecord record);

    int completeClaimed(AgentIdempotencyRecord record);

    int insertCompletedIgnoreDuplicate(AgentIdempotencyRecord record);
}
