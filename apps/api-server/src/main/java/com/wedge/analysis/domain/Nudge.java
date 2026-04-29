package com.wedge.analysis.domain;

import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class Nudge {
    private UUID id;
    private UUID analysisJobId;
    private UUID findingId;
    private Integer rankOrder;
    private String title;
    private String rationale;
    private String recommendation;
    private String difficulty;
    private String expectedEffect;
    private String validationQuestion;
    private OffsetDateTime createdAt;
}
