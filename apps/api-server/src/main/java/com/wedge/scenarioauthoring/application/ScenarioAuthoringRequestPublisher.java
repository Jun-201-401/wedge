package com.wedge.scenarioauthoring.application;

public interface ScenarioAuthoringRequestPublisher {
    void publish(ScenarioAuthoringExecuteRequestMessage message);
}
