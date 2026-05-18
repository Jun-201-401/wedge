package com.wedge.run.infrastructure;

import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
public class RunRecord {
    private static final String DEFAULT_TRIGGER_SOURCE = "WEB";
    private static final String EMPTY_JSON = "{}";

    private UUID id;
    private UUID projectId;
    private String name;
    private String triggerSource;
    private String startUrl;
    private String goal;
    private String devicePreset;
    private String environmentJson;
    private UUID scenarioTemplateVersionId;
    private String scenarioPlanSchemaVersion;
    private String scenarioPlanJson;
    private RunStatus status;
    private ResultCompleteness resultCompleteness;
    private AnalysisStatus analysisStatus;
    private Integer currentStepOrder;
    private OffsetDateTime startedAt;
    private OffsetDateTime finishedAt;
    private String failureCode;
    private String failureMessage;
    private UUID createdBy;
    private String idempotencyKey;
    private String idempotencyRequestHash;
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;
    private OffsetDateTime deletedAt;
    private long version;

    public static RunRecord created(RunCreateRequest request) {
        return created(request, null, null, null);
    }

    public static RunRecord created(RunCreateRequest request, UUID createdBy, String idempotencyKey, String idempotencyRequestHash) {
        RunRecord record = new RunRecord();
        record.setId(UUID.randomUUID());
        record.setProjectId(request.projectId());
        record.setName(request.name());
        record.setTriggerSource(DEFAULT_TRIGGER_SOURCE);
        record.setStartUrl(request.startUrl().toString());
        record.setGoal(request.goal());
        record.setDevicePreset(request.devicePreset());
        record.setEnvironmentJson(EMPTY_JSON);
        record.setScenarioTemplateVersionId(request.scenarioTemplateVersionId());
        record.setScenarioPlanSchemaVersion(null);
        record.setScenarioPlanJson(EMPTY_JSON);
        record.setStatus(RunStatus.CREATED);
        record.setResultCompleteness(ResultCompleteness.NONE);
        record.setAnalysisStatus(AnalysisStatus.NOT_STARTED);
        record.setCreatedBy(createdBy);
        record.setIdempotencyKey(idempotencyKey);
        record.setIdempotencyRequestHash(idempotencyRequestHash);
        record.setVersion(0L);
        return record;
    }

}
