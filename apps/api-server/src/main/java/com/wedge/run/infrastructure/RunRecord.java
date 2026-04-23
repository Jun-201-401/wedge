package com.wedge.run.infrastructure;

import com.wedge.run.api.dto.RunCreateRequest;
import com.wedge.run.domain.AnalysisStatus;
import com.wedge.run.domain.ResultCompleteness;
import com.wedge.run.domain.RunStatus;
import java.time.OffsetDateTime;
import java.util.UUID;

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
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;
    private OffsetDateTime deletedAt;
    private long version;

    public static RunRecord created(RunCreateRequest request) {
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
        record.setVersion(0L);
        return record;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public void setProjectId(UUID projectId) {
        this.projectId = projectId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getTriggerSource() {
        return triggerSource;
    }

    public void setTriggerSource(String triggerSource) {
        this.triggerSource = triggerSource;
    }

    public String getStartUrl() {
        return startUrl;
    }

    public void setStartUrl(String startUrl) {
        this.startUrl = startUrl;
    }

    public String getGoal() {
        return goal;
    }

    public void setGoal(String goal) {
        this.goal = goal;
    }

    public String getDevicePreset() {
        return devicePreset;
    }

    public void setDevicePreset(String devicePreset) {
        this.devicePreset = devicePreset;
    }

    public String getEnvironmentJson() {
        return environmentJson;
    }

    public void setEnvironmentJson(String environmentJson) {
        this.environmentJson = environmentJson;
    }

    public UUID getScenarioTemplateVersionId() {
        return scenarioTemplateVersionId;
    }

    public void setScenarioTemplateVersionId(UUID scenarioTemplateVersionId) {
        this.scenarioTemplateVersionId = scenarioTemplateVersionId;
    }

    public String getScenarioPlanSchemaVersion() {
        return scenarioPlanSchemaVersion;
    }

    public void setScenarioPlanSchemaVersion(String scenarioPlanSchemaVersion) {
        this.scenarioPlanSchemaVersion = scenarioPlanSchemaVersion;
    }

    public String getScenarioPlanJson() {
        return scenarioPlanJson;
    }

    public void setScenarioPlanJson(String scenarioPlanJson) {
        this.scenarioPlanJson = scenarioPlanJson;
    }

    public RunStatus getStatus() {
        return status;
    }

    public void setStatus(RunStatus status) {
        this.status = status;
    }

    public ResultCompleteness getResultCompleteness() {
        return resultCompleteness;
    }

    public void setResultCompleteness(ResultCompleteness resultCompleteness) {
        this.resultCompleteness = resultCompleteness;
    }

    public AnalysisStatus getAnalysisStatus() {
        return analysisStatus;
    }

    public void setAnalysisStatus(AnalysisStatus analysisStatus) {
        this.analysisStatus = analysisStatus;
    }

    public Integer getCurrentStepOrder() {
        return currentStepOrder;
    }

    public void setCurrentStepOrder(Integer currentStepOrder) {
        this.currentStepOrder = currentStepOrder;
    }

    public OffsetDateTime getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(OffsetDateTime startedAt) {
        this.startedAt = startedAt;
    }

    public OffsetDateTime getFinishedAt() {
        return finishedAt;
    }

    public void setFinishedAt(OffsetDateTime finishedAt) {
        this.finishedAt = finishedAt;
    }

    public String getFailureCode() {
        return failureCode;
    }

    public void setFailureCode(String failureCode) {
        this.failureCode = failureCode;
    }

    public String getFailureMessage() {
        return failureMessage;
    }

    public void setFailureMessage(String failureMessage) {
        this.failureMessage = failureMessage;
    }

    public UUID getCreatedBy() {
        return createdBy;
    }

    public void setCreatedBy(UUID createdBy) {
        this.createdBy = createdBy;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(OffsetDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public OffsetDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(OffsetDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }

    public OffsetDateTime getDeletedAt() {
        return deletedAt;
    }

    public void setDeletedAt(OffsetDateTime deletedAt) {
        this.deletedAt = deletedAt;
    }

    public long getVersion() {
        return version;
    }

    public void setVersion(long version) {
        this.version = version;
    }
}
