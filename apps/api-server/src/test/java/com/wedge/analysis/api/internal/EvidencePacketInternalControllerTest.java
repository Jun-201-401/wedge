package com.wedge.analysis.api.internal;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.response.RequestMetadata;
import com.wedge.evidence.application.EvidenceService;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class EvidencePacketInternalControllerTest {
    private final EvidenceService evidenceService = org.mockito.Mockito.mock(EvidenceService.class);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new EvidencePacketInternalController(evidenceService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .defaultRequest(get("/").requestAttr(RequestMetadata.REQUEST_ID_ATTRIBUTE, "req_internal_evidence"))
            .build();

    @Test
    void getEvidencePacketSnapshotReturnsStoredPacket() throws Exception {
        UUID evidencePacketId = UUID.randomUUID();
        when(evidenceService.getEvidencePacketSnapshot(evidencePacketId)).thenReturn(Map.of(
                "schema_version", "0.5",
                "run_id", "11111111-1111-1111-1111-111111111111"
        ));

        mockMvc.perform(get("/internal/analysis/evidence-packets/{evidencePacketId}", evidencePacketId)
                        .requestAttr(RequestMetadata.REQUEST_ID_ATTRIBUTE, "req_internal_evidence"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.schema_version").value("0.5"))
                .andExpect(jsonPath("$.data.run_id").value("11111111-1111-1111-1111-111111111111"))
                .andExpect(jsonPath("$.meta.requestId").value("req_internal_evidence"));
    }
}
