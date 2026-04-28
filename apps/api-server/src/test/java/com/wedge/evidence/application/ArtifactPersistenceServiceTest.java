package com.wedge.evidence.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.wedge.evidence.application.command.SaveRunArtifactCommand;
import com.wedge.evidence.application.command.SaveRunArtifactsCommand;
import com.wedge.evidence.domain.Artifact;
import com.wedge.evidence.domain.ArtifactType;
import com.wedge.evidence.infrastructure.ArtifactMapper;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ArtifactPersistenceServiceTest {
    @Mock
    private ArtifactMapper artifactMapper;

    @Captor
    private ArgumentCaptor<Artifact> artifactCaptor;

    private ArtifactPersistenceService artifactPersistenceService;

    @BeforeEach
    void setUp() {
        artifactPersistenceService = new ArtifactPersistenceService(artifactMapper);
    }

    @Test
    void saveRunArtifactsMapsRunnerPayloadToArtifactRows() {
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        OffsetDateTime createdAt = OffsetDateTime.parse("2026-04-27T10:15:00+09:00");
        SaveRunArtifactsCommand command = new SaveRunArtifactsCommand(List.of(new SaveRunArtifactCommand(
                artifactId,
                "step_001_click_cta",
                ArtifactType.SCREENSHOT,
                "wedge-artifacts",
                "run-1/step_001_click_cta/screenshot.png",
                "image/png",
                1440,
                900,
                1024,
                "7c6a180b36896a0a8c02787eeafb0e4c2d7ea40a6abdd2a7636f3f4c1c4a7b1f",
                createdAt
        )));

        int savedCount = artifactPersistenceService.saveRunArtifacts(runId, command);

        assertThat(savedCount).isEqualTo(1);
        verify(artifactMapper).insert(artifactCaptor.capture());
        Artifact artifact = artifactCaptor.getValue();
        assertThat(artifact.getId()).isEqualTo(artifactId);
        assertThat(artifact.getRunId()).isEqualTo(runId);
        assertThat(artifact.getStepId()).isNull();
        assertThat(artifact.getArtifactType()).isEqualTo(ArtifactType.SCREENSHOT);
        assertThat(artifact.getS3Bucket()).isEqualTo("wedge-artifacts");
        assertThat(artifact.getS3Key()).isEqualTo("run-1/step_001_click_cta/screenshot.png");
        assertThat(artifact.getPublicUrl()).isNull();
        assertThat(artifact.getMimeType()).isEqualTo("image/png");
        assertThat(artifact.getWidth()).isEqualTo(1440);
        assertThat(artifact.getHeight()).isEqualTo(900);
        assertThat(artifact.getSizeBytes()).isEqualTo(1024);
        assertThat(artifact.getSha256()).isEqualTo("7c6a180b36896a0a8c02787eeafb0e4c2d7ea40a6abdd2a7636f3f4c1c4a7b1f");
        assertThat(artifact.getCapturedAt()).isEqualTo(createdAt);
    }

    @Test
    void saveRunArtifactsSkipsAlreadyStoredArtifactId() {
        UUID runId = UUID.randomUUID();
        UUID artifactId = UUID.randomUUID();
        SaveRunArtifactsCommand command = new SaveRunArtifactsCommand(List.of(sampleArtifactCommand(artifactId)));
        when(artifactMapper.findById(artifactId)).thenReturn(Optional.of(new Artifact()));

        int savedCount = artifactPersistenceService.saveRunArtifacts(runId, command);

        assertThat(savedCount).isEqualTo(1);
        verify(artifactMapper, never()).insert(org.mockito.ArgumentMatchers.any());
    }

    private SaveRunArtifactCommand sampleArtifactCommand(UUID artifactId) {
        return new SaveRunArtifactCommand(
                artifactId,
                "step_001_click_cta",
                ArtifactType.DOM_SNAPSHOT,
                "wedge-artifacts",
                "run-1/step_001_click_cta/dom.html",
                "text/html",
                null,
                null,
                512,
                "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
                OffsetDateTime.parse("2026-04-27T10:15:00+09:00")
        );
    }
}
