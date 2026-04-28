package com.wedge.analysis.infrastructure;

import com.wedge.analysis.domain.RuleHit;
import java.util.List;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface RuleHitMapper {
    List<RuleHit> findByAnalysisJobId(@Param("analysisJobId") UUID analysisJobId);

    int insert(RuleHit ruleHit);

    int deleteByAnalysisJobId(@Param("analysisJobId") UUID analysisJobId);
}
