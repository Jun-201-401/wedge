package com.wedge.discovery.infrastructure;

import com.wedge.discovery.domain.ScenarioRecommendation;
import java.util.List;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ScenarioRecommendationMapper {
    List<ScenarioRecommendation> findByDiscoveryId(@Param("discoveryId") UUID discoveryId);

    int deleteByDiscoveryId(@Param("discoveryId") UUID discoveryId);

    int insert(ScenarioRecommendation recommendation);
}
