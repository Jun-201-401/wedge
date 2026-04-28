package com.wedge.run.application.command;

import java.time.OffsetDateTime;

public record RunnerAcceptedCommand(String workerId, OffsetDateTime acceptedAt, String browserSessionId) {
}
