import { useEffect, useRef, useState } from 'react';

import { getRun, getRunEvidencePacket, getRunLive, listRunEvents, listRunSteps } from '../../../api/runs';
import type { EvidencePacket, Run, RunEvent, RunLive, RunStep } from '../../../entities/run';
import type { MockRunMonitorData } from './runMonitorMock';
import { RUN_MONITOR_REFRESH_INTERVAL_MS, shouldRefreshRunLive } from './runMonitorViewModel';

const EVIDENCE_LOAD_ERROR_MESSAGE = '수집 근거를 아직 불러오지 못했습니다. 실행 결과 저장이 완료되면 표시됩니다.';
const STEP_LOAD_ERROR_MESSAGE = '확인 단계 목록을 아직 불러오지 못했습니다. 현재 실행 상태로 대신 표시합니다.';
const EVENT_LOAD_ERROR_MESSAGE = '확인 경로를 아직 불러오지 못했습니다. 저장된 단계 상태로 대신 표시합니다.';
const EVIDENCE_LOAD_RUN_STATUSES = new Set(['COMPLETED', 'FAILED', 'STOPPED']);

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
  runSteps: RunStep[];
  isStepLoading: boolean;
  stepLoadError: string;
  runEvents: RunEvent[];
  isEventLoading: boolean;
  eventLoadError: string;
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
  const [runSteps, setRunSteps] = useState<RunStep[]>([]);
  const [isStepLoading, setIsStepLoading] = useState(false);
  const [stepLoadError, setStepLoadError] = useState('');
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [isEventLoading, setIsEventLoading] = useState(false);
  const [eventLoadError, setEventLoadError] = useState('');
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

    if (isMockRun) {
      setRun(mockData.run);
      setLive(mockData.live);
      setIsApiFallback(true);
      setHasRealRunSnapshot(false);
      setIsRealRunLoading(false);
      setApiLoadError('');
      setEvidencePacket(null);
      setIsEvidenceLoading(false);
      setEvidenceLoadError('');
      setRunSteps([]);
      setIsStepLoading(false);
      setStepLoadError('');
      setRunEvents([]);
      setIsEventLoading(false);
      setEventLoadError('');
      return;
    }

    clearEvidenceState();
    setRunSteps([]);
    setIsStepLoading(false);
    setStepLoadError('');
    setRunEvents([]);
    setIsEventLoading(false);
    setEventLoadError('');

    let isActive = true;
    let refreshTimerId = 0;

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
      setIsStepLoading(true);
      setIsEventLoading(true);

      try {
        const [runResponse, liveResponse, stepsResponse, eventsResponse] = await Promise.all([
          getRun(runId),
          getRunLive(runId),
          listRunSteps(runId).catch(() => null),
          listRunEvents(runId, { limit: 50 }).catch(() => null),
        ]);

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
        setIsStepLoading(false);
        setIsEventLoading(false);

        if (stepsResponse) {
          setRunSteps(stepsResponse.data);
          setStepLoadError('');
        } else {
          setRunSteps([]);
          setStepLoadError(STEP_LOAD_ERROR_MESSAGE);
        }

        if (eventsResponse) {
          setRunEvents(eventsResponse.data);
          setEventLoadError('');
        } else {
          setRunEvents([]);
          setEventLoadError(EVENT_LOAD_ERROR_MESSAGE);
        }

        if (shouldRefreshRunLive(liveResponse.data.status)) {
          refreshTimerId = window.setTimeout(() => void loadRunState(false), RUN_MONITOR_REFRESH_INTERVAL_MS);
        }

        if (EVIDENCE_LOAD_RUN_STATUSES.has(liveResponse.data.status)) {
          await loadEvidencePacket();
        } else {
          clearEvidenceState();
        }
      } catch {
        if (!isActive) {
          return;
        }

        setIsApiFallback(false);
        setApiLoadError('실행 상태를 불러오지 못했습니다. URL 또는 접근 권한을 확인한 뒤 다시 시도해주세요.');
        setIsRealRunLoading(false);
        setRunSteps([]);
        setIsStepLoading(false);
        setStepLoadError('');
        setRunEvents([]);
        setIsEventLoading(false);
        setEventLoadError('');
        clearEvidenceState();

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
    runSteps,
    isStepLoading,
    stepLoadError,
    runEvents,
    isEventLoading,
    eventLoadError,
  };
}
