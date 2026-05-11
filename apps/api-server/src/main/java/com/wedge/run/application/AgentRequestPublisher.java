package com.wedge.run.application;

public interface AgentRequestPublisher {
    void publish(AgentExecuteRequestMessage message);
}
