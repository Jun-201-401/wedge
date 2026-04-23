package com.wedge.run.application;

public interface RunRequestPublisher {
    void publish(RunExecuteRequestMessage message);
}
