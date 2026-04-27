import { useEffect, useRef, useState } from 'react';

import { getRun, getRunLive } from '../../../api/runs';
import type { Run, RunLive } from '../../../entities/run';
import type { MockRunMonitorData } from './runMonitorMock';
import { RUN_MONITOR_REFRESH_INTERVAL_MS, shouldRefreshRunLive } from './runMonitorViewModel';

export interface RunMonitorState {
  run: Run;
  live: RunLive;
  isApiFallback: boolean;
  hasRealRunSnapshot: boolean;
  isRealRunLoading: boolean;
  apiLoadError: string;
}

export function useRunMonitorState(runId: string, mockData: MockRunMonitorData, isMockRun: boolean): RunMonitorState {
  const [run, setRun] = useState<Run>(mockData.run);
  const [live, setLive] = useState<RunLive>(mockData.live);
  const [isApiFallback, setIsApiFallback] = useState(isMockRun);
  const [hasRealRunSnapshot, setHasRealRunSnapshot] = useState(false);
  const [isRealRunLoading, setIsRealRunLoading] = useState(!isMockRun);
  const [apiLoadError, setApiLoadError] = useState('');
  const liveStatusRef = useRef(live.status);

  useEffect(() => {
    liveStatusRef.current = live.status;
  }, [live.status]);

  useEffect(() => {
    if (isMockRun) {
      setRun(mockData.run);
      setLive(mockData.live);
      setIsApiFallback(true);
      setHasRealRunSnapshot(false);
      setIsRealRunLoading(false);
      setApiLoadError('');
      return;
    }

    let isActive = true;
    let refreshTimerId = 0;

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
      } catch {
        if (!isActive) {
          return;
        }

        setIsApiFallback(false);
        setApiLoadError('Run 상태를 불러오지 못했습니다. URL 또는 접근 권한을 확인한 뒤 다시 시도해주세요.');
        setIsRealRunLoading(false);

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
  };
}
