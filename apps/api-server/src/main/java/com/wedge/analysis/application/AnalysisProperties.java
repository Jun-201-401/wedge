package com.wedge.analysis.application;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "wedge.analysis")
public class AnalysisProperties {
    private boolean projectAccessCheckEnabled = true;
}
