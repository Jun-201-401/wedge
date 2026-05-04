package com.wedge.discovery.application;

import com.wedge.discovery.domain.DiscoveryStatus;
import java.util.UUID;

public record DiscoveryCallbackAckResponse(
        UUID discoveryId,
        DiscoveryStatus status,
        Boolean duplicate,
        Integer checkpointCount
) {
    public static DiscoveryCallbackAckResponse status(UUID discoveryId, DiscoveryStatus status) {
        return new DiscoveryCallbackAckResponse(discoveryId, status, null, null);
    }

    public static DiscoveryCallbackAckResponse duplicate(UUID discoveryId, DiscoveryStatus status) {
        return new DiscoveryCallbackAckResponse(discoveryId, status, true, null);
    }

    public static DiscoveryCallbackAckResponse checkpoints(UUID discoveryId, int checkpointCount) {
        return new DiscoveryCallbackAckResponse(discoveryId, null, null, checkpointCount);
    }

    public static DiscoveryCallbackAckResponse duplicateCheckpoints(UUID discoveryId, int checkpointCount) {
        return new DiscoveryCallbackAckResponse(discoveryId, null, true, checkpointCount);
    }
}
