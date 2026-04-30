package com.wedge.evidence.application;

import java.util.Optional;
import java.util.UUID;

public record SaveRunCheckpointsResult(int checkpointCount, Optional<UUID> latestInsertedCheckpointId) {
}
