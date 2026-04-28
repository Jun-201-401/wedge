package com.wedge.evidence.application.command;

import java.util.List;

public record SaveRunCheckpointsCommand(List<SaveRunCheckpointCommand> checkpoints) {
}
