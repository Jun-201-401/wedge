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
}
