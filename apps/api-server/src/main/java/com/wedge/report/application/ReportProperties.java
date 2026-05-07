package com.wedge.report.application;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "wedge.report")
public class ReportProperties {
    private boolean projectAccessCheckEnabled = true;
    private int shareDefaultExpirationMinutes = 10;
    private String publicBaseUrl = "http://localhost:8080";

    public String shareUrl(String shareToken) {
        String normalizedBaseUrl = publicBaseUrl == null || publicBaseUrl.isBlank()
                ? "http://localhost:8080"
                : publicBaseUrl.replaceAll("/+$", "");
        return normalizedBaseUrl + "/api/report-shares/" + shareToken;
    }
}
