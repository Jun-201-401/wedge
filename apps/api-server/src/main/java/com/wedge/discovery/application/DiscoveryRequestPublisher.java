package com.wedge.discovery.application;

public interface DiscoveryRequestPublisher {
    void publish(DiscoveryExecuteRequestMessage message);
}
