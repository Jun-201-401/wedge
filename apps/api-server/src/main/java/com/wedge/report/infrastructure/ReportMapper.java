package com.wedge.report.infrastructure;

import com.wedge.report.domain.Report;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Mapper
public interface ReportMapper {
    Optional<Report> findById(@Param("id") UUID id);
    List<Report> findByRunId(@Param("runId") UUID runId);
    int insert(Report report);
}
