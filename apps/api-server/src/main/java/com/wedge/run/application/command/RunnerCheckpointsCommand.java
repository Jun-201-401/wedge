package com.wedge.run.application.command;

import java.util.List;

public record RunnerCheckpointsCommand(List<RunnerCheckpointCommand> checkpoints) {
}
