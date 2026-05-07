package com.wedge.discovery.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.common.error.BusinessException;
import com.wedge.common.error.ErrorCode;
import com.wedge.common.infrastructure.outbox.OutboxMessagePersistenceAdapter;
import com.wedge.discovery.api.dto.CreateDiscoveryRequest;
import com.wedge.discovery.api.dto.DiscoveryResponse;
import com.wedge.discovery.api.dto.DiscoveryViewportRequest;
import com.wedge.discovery.domain.DiscoveryStatus;
import com.wedge.discovery.domain.SiteDiscovery;
import com.wedge.discovery.infrastructure.ScenarioRecommendationMapper;
import com.wedge.discovery.infrastructure.SiteDiscoveryMapper;
import com.wedge.project.application.ProjectAccessService;
import java.net.URI;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DuplicateKeyException;

@ExtendWith(MockitoExtension.class)
class DiscoveryServiceTest {
    private static final UUID PROJECT_ID = UUID.fromString("8f06dca8-9c4d-4f20-b1a8-1d5ee40a9923");
    private static final UUID USER_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");

    @Mock
    private SiteDiscoveryMapper siteDiscoveryMapper;

    @Mock
    private ScenarioRecommendationMapper scenarioRecommendationMapper;

    @Mock
    private OutboxMessagePersistenceAdapter outboxMessagePersistenceAdapter;

    @Mock
    private ApplicationEventPublisher applicationEventPublisher;

    @Mock
    private ProjectAccessService projectAccessService;

    private DiscoveryService discoveryService;

    @BeforeEach
    void setUp() {
        discoveryService = new DiscoveryService(
                siteDiscoveryMapper,
                scenarioRecommendationMapper,
                new ObjectMapper(),
                new DiscoveryExecuteRequestMessageFactory(),
                outboxMessagePersistenceAdapter,
                applicationEventPublisher,
                projectAccessService,
                new DiscoveryUrlValidator()
        );
    }

    @Test
    void createDiscoveryCreatesNewExecutionsForSameUrlWithDifferentAttemptKeys() {
        when(siteDiscoveryMapper.findByIdempotencyKey(eq(PROJECT_ID), eq(USER_ID), anyString())).thenReturn(Optional.<SiteDiscovery>empty());
        when(outboxMessagePersistenceAdapter.appendDiscoveryExecuteMessage(any(DiscoveryExecuteRequestMessage.class), any(UUID.class)))
                .thenReturn(UUID.randomUUID())
                .thenReturn(UUID.randomUUID());

        DiscoveryResponse first = discoveryService.createDiscovery(request("https://example.com"), USER_ID, "idem-attempt-1");
        DiscoveryResponse second = discoveryService.createDiscovery(request("https://example.com"), USER_ID, "idem-attempt-2");

        assertThat(first.discoveryId()).isNotEqualTo(second.discoveryId());
        verify(siteDiscoveryMapper, times(2)).insert(any(SiteDiscovery.class));
        verify(outboxMessagePersistenceAdapter, times(2)).appendDiscoveryExecuteMessage(any(DiscoveryExecuteRequestMessage.class), any(UUID.class));
        verify(applicationEventPublisher, times(2)).publishEvent(any(DiscoveryExecuteOutboxEnqueuedEvent.class));
    }

    @Test
    void createDiscoveryReplaysSamePayloadForSameIdempotencyKey() {
        SiteDiscovery existing = discovery(UUID.randomUUID(), "https://example.com", "desktop", "{\"width\":1440,\"height\":900}");
        when(siteDiscoveryMapper.findByIdempotencyKey(PROJECT_ID, USER_ID, "idem-attempt-1")).thenReturn(Optional.of(existing));
        when(scenarioRecommendationMapper.findByDiscoveryId(existing.getId())).thenReturn(List.of());

        DiscoveryResponse response = discoveryService.createDiscovery(request("https://example.com"), USER_ID, "idem-attempt-1");

        assertThat(response.discoveryId()).isEqualTo(existing.getId());
        verify(siteDiscoveryMapper, never()).insert(any());
        verify(outboxMessagePersistenceAdapter, never()).appendDiscoveryExecuteMessage(any(), any());
        verify(applicationEventPublisher, never()).publishEvent(any());
    }

    @Test
    void createDiscoveryRejectsSameIdempotencyKeyWithDifferentPayload() {
        SiteDiscovery existing = discovery(UUID.randomUUID(), "https://example.com", "desktop", "{\"width\":1440,\"height\":900}");
        when(siteDiscoveryMapper.findByIdempotencyKey(PROJECT_ID, USER_ID, "idem-attempt-1")).thenReturn(Optional.of(existing));

        assertThatThrownBy(() -> discoveryService.createDiscovery(request("https://example.com/contact"), USER_ID, "idem-attempt-1"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("Idempotency-Key")
                .satisfies(exception -> assertThat(((BusinessException) exception).errorCode()).isEqualTo(ErrorCode.STATE_CONFLICT));
        verify(siteDiscoveryMapper, never()).insert(any());
        verify(outboxMessagePersistenceAdapter, never()).appendDiscoveryExecuteMessage(any(), any());
    }

    @Test
    void createDiscoveryHandlesDuplicateInsertRaceByReturningExistingReplay() {
        SiteDiscovery existing = discovery(UUID.randomUUID(), "https://example.com", "desktop", "{\"width\":1440,\"height\":900}");
        when(siteDiscoveryMapper.findByIdempotencyKey(PROJECT_ID, USER_ID, "idem-race"))
                .thenReturn(Optional.<SiteDiscovery>empty(), Optional.of(existing));
        when(siteDiscoveryMapper.insert(any(SiteDiscovery.class))).thenThrow(new DuplicateKeyException("duplicate idempotency key"));
        when(scenarioRecommendationMapper.findByDiscoveryId(existing.getId())).thenReturn(List.of());

        DiscoveryResponse response = discoveryService.createDiscovery(request("https://example.com"), USER_ID, "idem-race");

        assertThat(response.discoveryId()).isEqualTo(existing.getId());
        verify(outboxMessagePersistenceAdapter, never()).appendDiscoveryExecuteMessage(any(), any());
        verify(applicationEventPublisher, never()).publishEvent(any());
    }

    @Test
    void createDiscoveryPersistsNormalizedAttemptKey() {
        when(siteDiscoveryMapper.findByIdempotencyKey(PROJECT_ID, USER_ID, "idem-trimmed")).thenReturn(Optional.<SiteDiscovery>empty());
        when(outboxMessagePersistenceAdapter.appendDiscoveryExecuteMessage(any(DiscoveryExecuteRequestMessage.class), any(UUID.class)))
                .thenReturn(UUID.randomUUID());
        ArgumentCaptor<SiteDiscovery> discoveryCaptor = ArgumentCaptor.forClass(SiteDiscovery.class);

        discoveryService.createDiscovery(request("https://example.com"), USER_ID, "  idem-trimmed  ");

        verify(siteDiscoveryMapper).insert(discoveryCaptor.capture());
        assertThat(discoveryCaptor.getValue().getIdempotencyKey()).isEqualTo("idem-trimmed");
    }

    private CreateDiscoveryRequest request(String url) {
        return new CreateDiscoveryRequest(
                PROJECT_ID,
                URI.create(url),
                "desktop",
                new DiscoveryViewportRequest(1440, 900)
        );
    }

    private SiteDiscovery discovery(UUID discoveryId, String inputUrl, String devicePreset, String viewportJsonb) {
        SiteDiscovery discovery = new SiteDiscovery();
        discovery.setId(discoveryId);
        discovery.setProjectId(PROJECT_ID);
        discovery.setInputUrl(inputUrl);
        discovery.setDevicePreset(devicePreset);
        discovery.setViewportJsonb(viewportJsonb);
        discovery.setStatus(DiscoveryStatus.COMPLETED);
        discovery.setSummaryJsonb("{}");
        discovery.setCreatedBy(USER_ID);
        return discovery;
    }
}
