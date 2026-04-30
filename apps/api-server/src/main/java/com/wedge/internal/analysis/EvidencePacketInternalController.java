package com.wedge.internal.analysis;

import com.wedge.common.response.ApiResponse;
import com.wedge.evidence.application.EvidenceService;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/analysis/evidence-packets")
public class EvidencePacketInternalController {
    private final EvidenceService evidenceService;

    public EvidencePacketInternalController(EvidenceService evidenceService) {
        this.evidenceService = evidenceService;
    }

    @GetMapping("/{evidencePacketId}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getEvidencePacketSnapshot(@PathVariable UUID evidencePacketId) {
        return ApiResponse.ok(evidenceService.getEvidencePacketSnapshot(evidencePacketId));
    }
}
