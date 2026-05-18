package com.wedge.evidence.infrastructure;

import com.wedge.evidence.domain.EvidencePacketSnapshot;
import java.util.Optional;
import java.util.UUID;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface EvidencePacketMapper {
    Optional<EvidencePacketSnapshot> findById(@Param("id") UUID id);

    EvidencePacketSnapshot insertRunSnapshot(EvidencePacketSnapshot snapshot);
}
