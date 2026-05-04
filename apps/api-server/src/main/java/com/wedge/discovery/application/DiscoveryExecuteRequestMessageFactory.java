package com.wedge.discovery.application;

import com.wedge.discovery.api.dto.CreateDiscoveryRequest;
import com.wedge.discovery.domain.SiteDiscovery;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class DiscoveryExecuteRequestMessageFactory {
    private static final String MESSAGE_TYPE = "discovery.execute.request";
    private static final String SCHEMA_VERSION = "0.5";
    private static final String PRODUCER = "api-server";
    private static final int DEFAULT_MAX_DURATION_MS = 10_000;
    private static final int DEFAULT_MAX_SCROLL_COUNT = 2;

    public DiscoveryExecuteRequestMessage create(SiteDiscovery discovery, CreateDiscoveryRequest request) {
        String messageId = UUID.randomUUID().toString();
        Map<String, Object> viewport = new LinkedHashMap<>();
        viewport.put("width", request.viewport() == null ? defaultWidth(request.devicePreset()) : request.viewport().width());
        viewport.put("height", request.viewport() == null ? defaultHeight(request.devicePreset()) : request.viewport().height());

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("discoveryId", discovery.getId().toString());
        payload.put("projectId", discovery.getProjectId().toString());
        payload.put("triggerSource", "WEB");
        payload.put("url", discovery.getInputUrl());
        payload.put("devicePreset", discovery.getDevicePreset());
        payload.put("viewport", viewport);
        payload.put("maxDurationMs", DEFAULT_MAX_DURATION_MS);
        payload.put("maxScrollCount", DEFAULT_MAX_SCROLL_COUNT);

        return new DiscoveryExecuteRequestMessage(
                messageId,
                MESSAGE_TYPE,
                SCHEMA_VERSION,
                OffsetDateTime.now().toString(),
                PRODUCER,
                discovery.getId().toString(),
                "discovery:" + discovery.getId(),
                payload
        );
    }

    public int defaultWidth(String devicePreset) {
        return switch (devicePreset) {
            case "mobile" -> 390;
            case "tablet" -> 768;
            default -> 1440;
        };
    }

    public int defaultHeight(String devicePreset) {
        return switch (devicePreset) {
            case "mobile" -> 844;
            case "tablet" -> 1024;
            default -> 900;
        };
    }
}
