package com.wedge.mcp.spike.dto;

public record SamplingDecisionSpikeResponse(
        boolean success,
        boolean samplingSupported,
        String sessionId,
        String clientName,
        String model,
        String stopReason,
        SpikeAgentDecision decision,
        Validation validation,
        String errorCode,
        String errorMessage
) {
    public static SamplingDecisionSpikeResponse unsupported(String sessionId, String clientName, String message) {
        return failure(false, sessionId, clientName, "MCP_SAMPLING_UNSUPPORTED", message);
    }

    public static SamplingDecisionSpikeResponse failure(
            boolean samplingSupported,
            String sessionId,
            String clientName,
            String errorCode,
            String errorMessage
    ) {
        return new SamplingDecisionSpikeResponse(
                false,
                samplingSupported,
                sessionId,
                clientName,
                null,
                null,
                null,
                Validation.failed(),
                errorCode,
                errorMessage
        );
    }

    public static SamplingDecisionSpikeResponse success(
            String sessionId,
            String clientName,
            String model,
            String stopReason,
            SpikeAgentDecision decision
    ) {
        return new SamplingDecisionSpikeResponse(
                true,
                true,
                sessionId,
                clientName,
                model,
                stopReason,
                decision,
                new Validation(true, true, true, true),
                null,
                null
        );
    }

    public record Validation(
            boolean jsonParsed,
            boolean schemaValid,
            boolean candidateAllowed,
            boolean safetyValid
    ) {
        public static Validation failed() {
            return new Validation(false, false, false, false);
        }
    }
}
