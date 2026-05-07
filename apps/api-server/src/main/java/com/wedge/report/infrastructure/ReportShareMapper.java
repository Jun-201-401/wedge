package com.wedge.report.infrastructure;

import com.wedge.report.domain.ReportShare;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ReportShareMapper {
    List<ReportShare> findByReportId(@Param("reportId") UUID reportId);
    Optional<ReportShare> findActiveByToken(@Param("shareToken") String shareToken, @Param("now") OffsetDateTime now);
    int insert(ReportShare share);
    int revoke(@Param("id") UUID id, @Param("reportId") UUID reportId, @Param("revokedAt") OffsetDateTime revokedAt);
}
