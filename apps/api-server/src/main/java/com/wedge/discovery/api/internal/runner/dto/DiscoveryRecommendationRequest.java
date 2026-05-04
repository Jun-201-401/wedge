package com.wedge.discovery.api.internal.runner.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
import java.net.URI;
import java.util.List;
import java.util.Map;

public record DiscoveryRecommendationRequest(
        @NotBlank @Pattern(regexp = "LANDING_CTA|SIGNUP_LEAD_FORM|PRICING|PURCHASE_CHECKOUT|CONTACT|CONTENT_ONLY|CUSTOM_GUIDED") String scenarioType,
        @NotBlank @Pattern(regexp = "HIGH|MEDIUM|LOW|NOT_AVAILABLE") String recommendationLevel,
        @NotNull @DecimalMin("0.0") @DecimalMax("1.0") BigDecimal confidence,
        @NotBlank String reason,
        @NotNull List<String> evidenceRefs,
        URI suggestedStartUrl,
        Map<String, Object> suggestedTarget
) {
}
