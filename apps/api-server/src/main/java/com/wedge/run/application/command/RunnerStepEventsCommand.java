package com.wedge.run.application.command;

import java.util.List;

public record RunnerStepEventsCommand(List<RunnerStepEventCommand> events) {
}
