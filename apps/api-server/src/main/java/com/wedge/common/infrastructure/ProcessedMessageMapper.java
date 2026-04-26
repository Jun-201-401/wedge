package com.wedge.common.infrastructure;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface ProcessedMessageMapper {
    int insertIgnoreDuplicate(@Param("consumerName") String consumerName, @Param("messageId") String messageId);
}
