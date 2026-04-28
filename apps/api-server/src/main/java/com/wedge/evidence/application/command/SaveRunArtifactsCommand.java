package com.wedge.evidence.application.command;

import java.util.List;

public record SaveRunArtifactsCommand(List<SaveRunArtifactCommand> artifacts) {
}
