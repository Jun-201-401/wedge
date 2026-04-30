package com.wedge.analysis.infrastructure;

import com.wedge.analysis.domain.AnalysisFinding;
import java.util.List;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface AnalysisFindingMapper {
    List<AnalysisFinding> findByAnalysisJobId(@Param("analysisJobId") UUID analysisJobId);

    List<AnalysisFinding> findTopByAnalysisJobId(
            @Param("analysisJobId") UUID analysisJobId,
            @Param("limit") int limit
    );

    List<AnalysisFinding> findByAnalysisJobIdOrderByPriority(@Param("analysisJobId") UUID analysisJobId);

    int insert(AnalysisFinding analysisFinding);

    int deleteByAnalysisJobId(@Param("analysisJobId") UUID analysisJobId);
}
