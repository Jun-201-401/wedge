package com.wedge.mcp.spike.dto;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

public record SpikeAgentObservation(
        String runId,
        String stepKey,
        String goal,
        String startUrl,
        String currentUrl,
        List<String> allowedActions,
        List<Candidate> candidates
) {
    public static SpikeAgentObservation fixture() {
        return new SpikeAgentObservation(
                "fixture-run-id",
                "step_001_goto_start_url",
                "Find the primary landing page CTA.",
                "https://example.com/",
                "https://example.com/",
                List.of("click", "scroll", "finish"),
                List.of(
                        new Candidate("candidate_1", "link", "Start now", true, "LOW"),
                        new Candidate("candidate_2", "button", "Subscribe", true, "LOW")
                )
        );
    }

    public Set<String> allowedCandidateIds() {
        return candidates.stream()
                .map(Candidate::candidateId)
                .collect(Collectors.toUnmodifiableSet());
    }

    public Set<String> allowedActionSet() {
        return Set.copyOf(allowedActions);
    }

    public record Candidate(
            String candidateId,
            String role,
            String text,
            boolean visible,
            String risk
    ) {
    }
}
