package com.wedge.discovery.infrastructure;

import com.wedge.discovery.domain.SiteDiscovery;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface SiteDiscoveryMapper {
    Optional<SiteDiscovery> findById(@Param("id") UUID id);

    Optional<SiteDiscovery> findByIdempotencyKey(
            @Param("projectId") UUID projectId,
            @Param("createdBy") UUID createdBy,
            @Param("idempotencyKey") String idempotencyKey
    );

    int insert(SiteDiscovery siteDiscovery);

    int markRunning(
            @Param("id") UUID id,
            @Param("startedAt") OffsetDateTime startedAt
    );

    int markCompleted(
            @Param("id") UUID id,
            @Param("finalUrl") String finalUrl,
            @Param("summaryJsonb") String summaryJsonb,
            @Param("finishedAt") OffsetDateTime finishedAt
    );

    int markFailed(
            @Param("id") UUID id,
            @Param("failureCode") String failureCode,
            @Param("failureMessage") String failureMessage,
            @Param("finishedAt") OffsetDateTime finishedAt
    );
}
