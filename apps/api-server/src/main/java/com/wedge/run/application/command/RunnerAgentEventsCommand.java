package com.wedge.run.application.command;

import java.util.List;

public record RunnerAgentEventsCommand(List<RunnerAgentEventCommand> events) {
}
