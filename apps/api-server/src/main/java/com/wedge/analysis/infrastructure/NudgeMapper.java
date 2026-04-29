package com.wedge.analysis.infrastructure;

import com.wedge.analysis.domain.Nudge;
import java.util.List;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface NudgeMapper {
    List<Nudge> findByAnalysisJobId(@Param("analysisJobId") UUID analysisJobId);

    int insert(Nudge nudge);

    int deleteByAnalysisJobId(@Param("analysisJobId") UUID analysisJobId);
}
