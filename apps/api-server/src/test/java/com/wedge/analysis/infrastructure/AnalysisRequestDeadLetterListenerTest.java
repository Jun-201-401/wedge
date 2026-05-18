package com.wedge.analysis.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wedge.analysis.application.AnalysisRequestService;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.amqp.rabbit.annotation.RabbitListener;

@ExtendWith(MockitoExtension.class)
class AnalysisRequestDeadLetterListenerTest {
    @Mock
    private AnalysisRequestService analysisRequestService;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private AnalysisRequestDeadLetterListener listener;

    @BeforeEach
    void setUp() {
        listener = new AnalysisRequestDeadLetterListener(objectMapper, analysisRequestService);
    }

    @Test
    void analysisRequestDeadLetterMarksAnalysisFailedFromPayloadIds() throws Exception {
        UUID analysisJobId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        String body = objectMapper.writeValueAsString(Map.of(
                "messageType", "analysis.request",
                "payload", Map.of(
                        "analysisJobId", analysisJobId.toString(),
                        "runId", runId.toString()
                )
        ));
        when(analysisRequestService.markRequestFailedIfAwaitingAnalyzer(
                eq(analysisJobId),
                eq(runId),
                eq("ANALYSIS_REQUEST_DEAD_LETTERED"),
                eq("Analysis request could not be delivered to Analyzer.")
        )).thenReturn(Optional.empty());

        listener.handleAnalysisRequestDeadLetter(body);

        verify(analysisRequestService).markRequestFailedIfAwaitingAnalyzer(
                eq(analysisJobId),
                eq(runId),
                eq("ANALYSIS_REQUEST_DEAD_LETTERED"),
                eq("Analysis request could not be delivered to Analyzer.")
        );
    }

    @Test
    void invalidAnalysisJobIdIsAckedWithoutFailingAnalysis() {
        listener.handleAnalysisRequestDeadLetter("{\"payload\":{\"analysisJobId\":\"not-a-uuid\"}}");

        verify(analysisRequestService, never()).markRequestFailedIfAwaitingAnalyzer(any(), any(), any(), any());
    }

    @Test
    void conflictingRunIdsAreAckedWithoutFailingAnalysis() throws Exception {
        UUID analysisJobId = UUID.randomUUID();
        String body = objectMapper.writeValueAsString(Map.of(
                "payload", Map.of(
                        "analysisJobId", analysisJobId.toString(),
                        "runId", UUID.randomUUID().toString(),
                        "run_id", UUID.randomUUID().toString()
                )
        ));

        listener.handleAnalysisRequestDeadLetter(body);

        verify(analysisRequestService, never()).markRequestFailedIfAwaitingAnalyzer(any(), any(), any(), any());
    }

    @Test
    void listenerMethodIsBoundToAnalysisDeadLetterQueue() throws NoSuchMethodException {
        Method method = AnalysisRequestDeadLetterListener.class
                .getDeclaredMethod("handleAnalysisRequestDeadLetter", String.class);

        assertThat(method.getAnnotation(RabbitListener.class).queues())
                .containsExactly("${wedge.analyzer.mq.analysis-dead-letter-queue:analysis.dlq}");
    }
}
