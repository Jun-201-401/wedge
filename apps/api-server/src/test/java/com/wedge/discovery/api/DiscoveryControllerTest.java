package com.wedge.discovery.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.wedge.common.error.GlobalExceptionHandler;
import com.wedge.common.security.WedgePrincipal;
import com.wedge.common.web.RequestIdFilter;
import com.wedge.discovery.api.dto.CreateDiscoveryRequest;
import com.wedge.discovery.api.dto.DiscoveryResponse;
import com.wedge.discovery.application.DiscoveryService;
import com.wedge.discovery.domain.DiscoveryStatus;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class DiscoveryControllerTest {
    private static final UUID USER_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID DISCOVERY_ID = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final UUID PROJECT_ID = UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final MappingJackson2HttpMessageConverter JSON_CONVERTER = new MappingJackson2HttpMessageConverter(
            new ObjectMapper()
                    .findAndRegisterModules()
                    .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
    );

    private final DiscoveryService discoveryService = mock(DiscoveryService.class);
    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new DiscoveryController(discoveryService))
            .setControllerAdvice(new GlobalExceptionHandler())
            .setMessageConverters(JSON_CONVERTER)
            .addFilters(new RequestIdFilter())
            .build();

    @Test
    void createDiscoveryAcceptsMissingProjectIdForDefaultProjectResolution() throws Exception {
        when(discoveryService.createDiscovery(any(CreateDiscoveryRequest.class), eq(USER_ID), eq("idem-discovery")))
                .thenReturn(new DiscoveryResponse(
                        DISCOVERY_ID,
                        PROJECT_ID,
                        DiscoveryStatus.QUEUED,
                        URI.create("https://example.com/"),
                        null,
                        null,
                        List.of(),
                        OffsetDateTime.parse("2026-05-08T09:00:00+09:00"),
                        null,
                        null,
                        null
                ));

        mockMvc.perform(post("/api/discoveries")
                        .principal(authentication())
                        .header("Idempotency-Key", "idem-discovery")
                        .header("X-Request-Id", "req_discovery_create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "url": "https://example.com/",
                                  "devicePreset": "desktop",
                                  "viewport": {"width": 1440, "height": 900}
                                }
                                """))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.data.discoveryId").value(DISCOVERY_ID.toString()))
                .andExpect(jsonPath("$.data.projectId").value(PROJECT_ID.toString()))
                .andExpect(jsonPath("$.data.status").value("QUEUED"))
                .andExpect(jsonPath("$.meta.requestId").value("req_discovery_create"));

        ArgumentCaptor<CreateDiscoveryRequest> requestCaptor = ArgumentCaptor.forClass(CreateDiscoveryRequest.class);
        verify(discoveryService).createDiscovery(requestCaptor.capture(), eq(USER_ID), eq("idem-discovery"));
        assertThat(requestCaptor.getValue().projectId()).isNull();
    }

    @Test
    void createDiscoveryStillValidatesRequiredUrl() throws Exception {
        mockMvc.perform(post("/api/discoveries")
                        .principal(authentication())
                        .header("X-Request-Id", "req_discovery_validation")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "devicePreset": "desktop",
                                  "viewport": {"width": 1440, "height": 900}
                                }
                                """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("validation_failed"))
                .andExpect(jsonPath("$.error.details.fields[0].field").value("url"))
                .andExpect(jsonPath("$.meta.requestId").value("req_discovery_validation"));
    }

    private UsernamePasswordAuthenticationToken authentication() {
        WedgePrincipal principal = new WedgePrincipal(USER_ID, "tester@example.com", "Tester");
        return new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
    }
}
