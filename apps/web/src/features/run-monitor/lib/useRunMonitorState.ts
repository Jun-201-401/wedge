import { useEffect, useRef, useState } from 'react';

import { getRun, getRunEvidencePacket, getRunLive, listRunArtifacts } from '../../../api/runs';
import type { EvidencePacket, Run, RunArtifact, RunLive } from '../../../entities/run';
import type { MockRunMonitorData } from './runMonitorMock';
import { RUN_MONITOR_REFRESH_INTERVAL_MS, shouldRefreshRunLive } from './runMonitorViewModel';

const EVIDENCE_LOAD_ERROR_MESSAGE = 'Evidence packet을 아직 불러오지 못했습니다. Runner callback 저장이 완료되면 표시됩니다.';
const ARTIFACTS_LOAD_ERROR_MESSAGE = '저장된 artifact 목록을 아직 불러오지 못했습니다.';

export interface RunMonitorState {
  run: Run;
  live: RunLive;
  isApiFallback: boolean;
  hasRealRunSnapshot: boolean;
  isRealRunLoading: boolean;
  apiLoadError: string;
  evidencePacket: EvidencePacket | null;
  isEvidenceLoading: boolean;
  evidenceLoadError: string;
  artifacts: RunArtifact[];
  isArtifactsLoading: boolean;
  artifactsLoadError: string;
}

export function useRunMonitorState(runId: string, mockData: MockRunMonitorData, isMockRun: boolean): RunMonitorState {
  const [run, setRun] = useState<Run>(mockData.run);
  const [live, setLive] = useState<RunLive>(mockData.live);
  const [isApiFallback, setIsApiFallback] = useState(isMockRun);
  const [hasRealRunSnapshot, setHasRealRunSnapshot] = useState(false);
  const [isRealRunLoading, setIsRealRunLoading] = useState(!isMockRun);
  const [apiLoadError, setApiLoadError] = useState('');
  const [evidencePacket, setEvidencePacket] = useState<EvidencePacket | null>(null);
  const [isEvidenceLoading, setIsEvidenceLoading] = useState(false);
  const [evidenceLoadError, setEvidenceLoadError] = useState('');
  const [artifacts, setArtifacts] = useState<RunArtifact[]>([]);
  const [isArtifactsLoading, setIsArtifactsLoading] = useState(false);
  const [artifactsLoadError, setArtifactsLoadError] = useState('');
  const liveStatusRef = useRef(live.status);

  useEffect(() => {
    liveStatusRef.current = live.status;
  }, [live.status]);

  useEffect(() => {
    function clearEvidenceState() {
      setEvidencePacket(null);
      setIsEvidenceLoading(false);
      setEvidenceLoadError('');
    }

    function clearArtifactsState() {
      setArtifacts([]);
      setIsArtifactsLoading(false);
      setArtifactsLoadError('');
    }

    if (isMockRun) {
      setRun(mockData.run);
      setLive(mockData.live);
      setIsApiFallback(true);
      setHasRealRunSnapshot(false);
      setIsRealRunLoading(false);
      setApiLoadError('');
      clearEvidenceState();
      clearArtifactsState();
      return;
    }

    let isActive = true;
    let refreshTimerId = 0;

    async function loadArtifacts() {
      setIsArtifactsLoading(true);

      try {
        const artifactsResponse = await listRunArtifacts(runId);

        if (!isActive) {
          return;
        }

        setArtifacts(artifactsResponse.data);
        setArtifactsLoadError('');
      } catch {
        if (!isActive) {
          return;
        }

        setArtifacts([]);
        setArtifactsLoadError(ARTIFACTS_LOAD_ERROR_MESSAGE);
      } finally {
        if (isActive) {
          setIsArtifactsLoading(false);
        }
      }
    }

    async function loadEvidencePacket() {
      setIsEvidenceLoading(true);

      try {
        const evidenceResponse = await getRunEvidencePacket(runId);

        if (!isActive) {
          return;
        }

        setEvidencePacket(evidenceResponse.data);
        setEvidenceLoadError('');
      } catch {
        if (!isActive) {
          return;
        }

        setEvidencePacket(null);
        setEvidenceLoadError(EVIDENCE_LOAD_ERROR_MESSAGE);
      } finally {
        if (isActive) {
          setIsEvidenceLoading(false);
        }
      }
    }

    async function loadRunState(isInitialLoad: boolean) {
      if (isInitialLoad) {
        setIsRealRunLoading(true);
      }

      try {
        const [runResponse, liveResponse] = await Promise.all([getRun(runId), getRunLive(runId)]);

        if (!isActive) {
          return;
        }

        setRun(runResponse.data);
        setLive(liveResponse.data);
        liveStatusRef.current = liveResponse.data.status;
        setIsApiFallback(false);
        setHasRealRunSnapshot(true);
        setApiLoadError('');
        setIsRealRunLoading(false);

        if (shouldRefreshRunLive(liveResponse.data.status)) {
          refreshTimerId = window.setTimeout(() => void loadRunState(false), RUN_MONITOR_REFRESH_INTERVAL_MS);
        }

        await Promise.all([loadEvidencePacket(), loadArtifacts()]);
      } catch {
        if (!isActive) {
          return;
        }

        setIsApiFallback(false);
        setApiLoadError('Run 상태를 불러오지 못했습니다. URL 또는 접근 권한을 확인한 뒤 다시 시도해주세요.');
        setIsRealRunLoading(false);
        clearEvidenceState();
        clearArtifactsState();

        if (!isInitialLoad && shouldRefreshRunLive(liveStatusRef.current)) {
          refreshTimerId = window.setTimeout(() => void loadRunState(false), RUN_MONITOR_REFRESH_INTERVAL_MS);
        }
      }
    }

    void loadRunState(true);

    return () => {
      isActive = false;
      window.clearTimeout(refreshTimerId);
    };
  }, [isMockRun, mockData, runId]);

  return {
    run,
    live,
    isApiFallback,
    hasRealRunSnapshot,
    isRealRunLoading,
    apiLoadError,
    evidencePacket,
    isEvidenceLoading,
    evidenceLoadError,
    artifacts,
    isArtifactsLoading,
    artifactsLoadError,
  };
}
