package com.wedge.run.application.command;

import java.util.List;

public record RunnerArtifactsCommand(List<RunnerArtifactCommand> artifacts) {
}
