package com.wedge.analysis.api.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.analysis.api.internal.dto.AnalyzerCallbackHeaders;
import com.wedge.analysis.api.internal.dto.AnalyzerCompletedRequest;
import com.wedge.analysis.api.internal.dto.AnalyzerStartedRequest;
import com.wedge.analysis.application.JudgeResultPersistenceService;
import com.wedge.common.error.BusinessException;
import com.wedge.common.infrastructure.ProcessedMessagePersistenceAdapter;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class AnalyzerCallbackServiceTest {
    @Mock
    private JudgeResultPersistenceService judgeResultPersistenceService;

    @Mock
    private ProcessedMessagePersistenceAdapter processedMessagePersistenceAdapter;

    private AnalyzerCallbackService analyzerCallbackService;

    @BeforeEach
    void setUp() {
        analyzerCallbackService = new AnalyzerCallbackService(judgeResultPersistenceService, processedMessagePersistenceAdapter);
    }

    @Test
    void startedCallbackDelegatesPersistenceOnce() {
        UUID analysisJobId = UUID.randomUUID();
        AnalyzerStartedRequest request = startedRequest(analysisJobId);
        when(processedMessagePersistenceAdapter.tryMarkProcessed("analyzer.started", "evt_analyzer_started_001")).thenReturn(true);
        when(judgeResultPersistenceService.saveStarted(request)).thenReturn(Map.of("status", "RUNNING"));

        Map<String, Object> result = analyzerCallbackService.handleStarted(analysisJobId, request, headers("evt_analyzer_started_001"));

        assertThat(result.get("status")).isEqualTo("RUNNING");
        verify(judgeResultPersistenceService).saveStarted(request);
    }

    @Test
    void duplicateStartedCallbackDoesNotPersistAgain() {
        UUID analysisJobId = UUID.randomUUID();
        AnalyzerStartedRequest request = startedRequest(analysisJobId);
        when(processedMessagePersistenceAdapter.tryMarkProcessed("analyzer.started", "evt_analyzer_started_001")).thenReturn(false);

        Map<String, Object> result = analyzerCallbackService.handleStarted(analysisJobId, request, headers("evt_analyzer_started_001"));

        assertThat(result.get("duplicate")).isEqualTo(true);
        assertThat(result.get("status")).isEqualTo("RUNNING");
        verify(judgeResultPersistenceService, never()).saveStarted(request);
    }

    @Test
    void startedCallbackRequiresMatchingAnalysisJobId() {
        AnalyzerStartedRequest request = startedRequest(UUID.randomUUID());

        assertThatThrownBy(() -> analyzerCallbackService.handleStarted(UUID.randomUUID(), request, headers("evt_analyzer_started_001")))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Analyzer callback analysisJobId does not match path.");
    }

    @Test
    void completedCallbackDelegatesPersistenceOnce() {
        UUID analysisJobId = UUID.randomUUID();
        AnalyzerCompletedRequest request = completedRequest(analysisJobId);
        when(processedMessagePersistenceAdapter.tryMarkProcessed("analyzer.completed", "evt_analyzer_001")).thenReturn(true);
        when(judgeResultPersistenceService.saveCompleted(request)).thenReturn(Map.of("status", "COMPLETED"));

        Map<String, Object> result = analyzerCallbackService.handleCompleted(analysisJobId, request, headers("evt_analyzer_001"));

        assertThat(result.get("status")).isEqualTo("COMPLETED");
        verify(judgeResultPersistenceService).saveCompleted(request);
    }

    @Test
    void duplicateCompletedCallbackDoesNotPersistAgain() {
        UUID analysisJobId = UUID.randomUUID();
        AnalyzerCompletedRequest request = completedRequest(analysisJobId);
        when(processedMessagePersistenceAdapter.tryMarkProcessed("analyzer.completed", "evt_analyzer_001")).thenReturn(false);

        Map<String, Object> result = analyzerCallbackService.handleCompleted(analysisJobId, request, headers("evt_analyzer_001"));

        assertThat(result.get("duplicate")).isEqualTo(true);
        verify(judgeResultPersistenceService, never()).saveCompleted(request);
    }

    @Test
    void completedCallbackRequiresMatchingAnalysisJobId() {
        AnalyzerCompletedRequest request = completedRequest(UUID.randomUUID());

        assertThatThrownBy(() -> analyzerCallbackService.handleCompleted(UUID.randomUUID(), request, headers("evt_analyzer_001")))
                .isInstanceOf(BusinessException.class)
                .hasMessage("Analyzer callback analysisJobId does not match path.");
    }

    private AnalyzerCallbackHeaders headers(String eventId) {
        return new AnalyzerCallbackHeaders("analyzer_001", eventId, "hmac-sha256=sig");
    }

    private AnalyzerStartedRequest startedRequest(UUID analysisJobId) {
        return new AnalyzerStartedRequest(
                analysisJobId,
                UUID.randomUUID(),
                OffsetDateTime.parse("2026-04-28T10:59:00+09:00")
        );
    }

    private AnalyzerCompletedRequest completedRequest(UUID analysisJobId) {
        return new AnalyzerCompletedRequest(
                analysisJobId,
                UUID.randomUUID(),
                "analyzer-0.5.0",
                "judge-prompts-2026-04-21",
                Map.of("llm", "gpt-5.4-mini"),
                List.of(),
                List.of(),
                Map.of("summary", Map.of(), "issues", List.of(), "decision_map", List.of()),
                OffsetDateTime.parse("2026-04-28T11:00:00+09:00")
        );
    }
}
