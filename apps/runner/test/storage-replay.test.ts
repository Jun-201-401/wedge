import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunnerApp } from "../src/app.ts";
import { createArtifactStore, type ArtifactStore } from "../src/storage/index.ts";
import { replayArtifactOutbox, startArtifactOutboxReplayWorker } from "../src/storage/replay.ts";
import { readArtifactOutboxRecords } from "../src/storage/outbox.ts";
import { sleep } from "../src/shared/utils.ts";
import { createRunnerTestConfig } from "./support.ts";

test("[아티팩트 outbox] 저장 재시도 소진 후 artifact record를 outbox에 남긴다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifact-outbox-"));
  const artifactOutboxFile = join(artifactsRoot, "artifact-outbox.jsonl");
  let attempts = 0;

  try {
    const artifactStore = createArtifactStore(
      createRunnerTestConfig({
        artifactsRoot,
        artifactOutboxFile,
        artifactRetryDelaysMs: [1, 1]
      }),
      {
        persistArtifacts: async () => {
          attempts += 1;
          throw new Error("storage unavailable");
        }
      }
    );

    await assert.rejects(
      () =>
        artifactStore.persistArtifacts({
          runId: "run-1",
          artifacts: [
            {
              artifactId: "artifact-1",
              artifactType: "SCREENSHOT",
              stepKey: "step_001",
              mimeType: "text/plain",
              fileExtension: "txt",
              content: "hello"
            }
          ]
        }),
      /artifact storage failed after 3 attempts: storage unavailable/
    );

    assert.equal(attempts, 3);
    const outboxLog = await readFile(artifactOutboxFile, "utf8");
    assert.match(outboxLog, /"runId":"run-1"/);
    assert.match(outboxLog, /"attempts":3/);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[아티팩트 재전송] pending artifact record를 저장한 뒤 성공 record를 제거한다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifact-replay-success-"));
  const artifactOutboxFile = join(artifactsRoot, "artifact-outbox.jsonl");
  const stored: string[] = [];

  try {
    const failingThenRecordedStore: ArtifactStore = {
      persistArtifacts: async () => {
        throw new Error("storage unavailable");
      }
    };

    const artifactStore = createArtifactStore(
      createRunnerTestConfig({
        artifactsRoot,
        artifactOutboxFile,
        artifactRetryDelaysMs: [1, 1]
      }),
      failingThenRecordedStore
    );

    await assert.rejects(
      () =>
        artifactStore.persistArtifacts({
          runId: "run-1",
          artifacts: [
            {
              artifactId: "artifact-1",
              artifactType: "SCREENSHOT",
              stepKey: "step_001",
              mimeType: "text/plain",
              fileExtension: "txt",
              content: "hello"
            }
          ]
        }),
      /artifact storage failed/
    );

    const summary = await replayArtifactOutbox(
      createRunnerTestConfig({
        artifactsRoot,
        artifactOutboxFile,
        artifactRetryDelaysMs: [1, 1]
      }),
      {
        persistArtifacts: async ({ runId, artifacts }) => {
          stored.push(`${runId}:${artifacts.length}`);
          return [];
        }
      }
    );

    assert.equal(summary.processedCount, 1);
    assert.equal(summary.storedCount, 1);
    assert.equal(summary.remainingCount, 0);
    assert.equal(summary.skipped, false);
    assert.deepEqual(stored, ["run-1:1"]);
    await assert.rejects(() => readFile(artifactOutboxFile, "utf8"), /ENOENT/);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[아티팩트 재전송] 저장 실패 record는 보존하고 attempts를 증가시킨다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifact-replay-fail-"));
  const artifactOutboxFile = join(artifactsRoot, "artifact-outbox.jsonl");

  try {
    const artifactStore = createArtifactStore(
      createRunnerTestConfig({
        artifactsRoot,
        artifactOutboxFile,
        artifactRetryDelaysMs: [1, 1]
      }),
      {
        persistArtifacts: async () => {
          throw new Error("storage unavailable");
        }
      }
    );

    await assert.rejects(
      () =>
        artifactStore.persistArtifacts({
          runId: "run-1",
          artifacts: [
            {
              artifactId: "artifact-1",
              artifactType: "SCREENSHOT",
              stepKey: "step_001",
              mimeType: "text/plain",
              fileExtension: "txt",
              content: "hello"
            }
          ]
        }),
      /artifact storage failed/
    );

    const summary = await replayArtifactOutbox(
      createRunnerTestConfig({
        artifactsRoot,
        artifactOutboxFile,
        artifactRetryDelaysMs: [1, 1]
      }),
      {
        persistArtifacts: async () => {
          throw new Error("still unavailable");
        }
      }
    );

    assert.equal(summary.processedCount, 1);
    assert.equal(summary.storedCount, 0);
    assert.equal(summary.remainingCount, 1);
    assert.equal(summary.skipped, false);
    const retained = await readFile(artifactOutboxFile, "utf8");
    assert.match(retained, /"attempts":6/);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[아티팩트 재전송] 활성 lock이 있으면 중복 replay를 실행하지 않는다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifact-replay-lock-skip-"));
  const artifactOutboxFile = join(artifactsRoot, "artifact-outbox.jsonl");
  const artifactOutboxLockFile = join(artifactsRoot, "artifact-outbox.lock");

  try {
    const artifactStore = createArtifactStore(
      createRunnerTestConfig({
        artifactsRoot,
        artifactOutboxFile,
        artifactOutboxLockFile,
        artifactRetryDelaysMs: [1, 1],
        artifactOutboxLockStaleMs: 60_000
      }),
      {
        persistArtifacts: async () => {
          throw new Error("storage unavailable");
        }
      }
    );

    await assert.rejects(
      () =>
        artifactStore.persistArtifacts({
          runId: "run-1",
          artifacts: [
            {
              artifactId: "artifact-1",
              artifactType: "SCREENSHOT",
              stepKey: "step_001",
              mimeType: "text/plain",
              fileExtension: "txt",
              content: "hello"
            }
          ]
        }),
      /artifact storage failed/
    );

    await writeFile(
      artifactOutboxLockFile,
      JSON.stringify({
        workerId: "other-worker",
        acquiredAt: new Date().toISOString()
      }),
      "utf8"
    );

    const summary = await replayArtifactOutbox(
      createRunnerTestConfig({
        artifactsRoot,
        artifactOutboxFile,
        artifactOutboxLockFile,
        artifactRetryDelaysMs: [1, 1],
        artifactOutboxLockStaleMs: 60_000
      }),
      {
        persistArtifacts: async () => {
          throw new Error("should not run");
        }
      }
    );

    assert.equal(summary.skipped, true);
    assert.equal(summary.processedCount, 0);
    const retained = await readFile(artifactOutboxFile, "utf8");
    assert.match(retained, /"runId":"run-1"/);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[아티팩트 재전송] 오래된 lock은 회수하고 replay를 계속한다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifact-replay-lock-stale-"));
  const artifactOutboxFile = join(artifactsRoot, "artifact-outbox.jsonl");
  const artifactOutboxLockFile = join(artifactsRoot, "artifact-outbox.lock");
  const stored: string[] = [];

  try {
    const artifactStore = createArtifactStore(
      createRunnerTestConfig({
        artifactsRoot,
        artifactOutboxFile,
        artifactOutboxLockFile,
        artifactRetryDelaysMs: [1, 1],
        artifactOutboxLockStaleMs: 1
      }),
      {
        persistArtifacts: async () => {
          throw new Error("storage unavailable");
        }
      }
    );

    await assert.rejects(
      () =>
        artifactStore.persistArtifacts({
          runId: "run-1",
          artifacts: [
            {
              artifactId: "artifact-1",
              artifactType: "SCREENSHOT",
              stepKey: "step_001",
              mimeType: "text/plain",
              fileExtension: "txt",
              content: "hello"
            }
          ]
        }),
      /artifact storage failed/
    );

    await writeFile(
      artifactOutboxLockFile,
      JSON.stringify({
        workerId: "stale-worker",
        acquiredAt: "2000-01-01T00:00:00.000Z"
      }),
      "utf8"
    );

    const summary = await replayArtifactOutbox(
      createRunnerTestConfig({
        artifactsRoot,
        artifactOutboxFile,
        artifactOutboxLockFile,
        artifactRetryDelaysMs: [1, 1],
        artifactOutboxLockStaleMs: 1
      }),
      {
        persistArtifacts: async ({ runId, artifacts }) => {
          stored.push(`${runId}:${artifacts.length}`);
          return [];
        }
      }
    );

    assert.equal(summary.skipped, false);
    assert.equal(summary.storedCount, 1);
    assert.deepEqual(stored, ["run-1:1"]);
    await assert.rejects(() => readFile(artifactOutboxFile, "utf8"), /ENOENT/);
    await assert.rejects(() => readFile(artifactOutboxLockFile, "utf8"), /ENOENT/);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[아티팩트 재전송] 긴 replay 중 lock heartbeat를 갱신한다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifact-replay-heartbeat-"));
  const artifactOutboxFile = join(artifactsRoot, "artifact-outbox.jsonl");
  const artifactOutboxLockFile = join(artifactsRoot, "artifact-outbox.lock");
  const stored: string[] = [];

  try {
    const artifactStore = createArtifactStore(
      createRunnerTestConfig({
        artifactsRoot,
        artifactOutboxFile,
        artifactOutboxLockFile,
        artifactRetryDelaysMs: [1],
        artifactOutboxLockStaleMs: 30,
        artifactOutboxHeartbeatIntervalMs: 10
      }),
      {
        persistArtifacts: async () => {
          throw new Error("storage unavailable");
        }
      }
    );

    await assert.rejects(
      () =>
        artifactStore.persistArtifacts({
          runId: "run-1",
          artifacts: [
            {
              artifactId: "artifact-1",
              artifactType: "SCREENSHOT",
              stepKey: "step_001",
              mimeType: "text/plain",
              fileExtension: "txt",
              content: "hello"
            }
          ]
        }),
      /artifact storage failed/
    );

    const config = createRunnerTestConfig({
      artifactsRoot,
      artifactOutboxFile,
      artifactOutboxLockFile,
      artifactRetryDelaysMs: [1],
      artifactOutboxLockStaleMs: 30,
      artifactOutboxHeartbeatIntervalMs: 10
    });

    const firstReplay = replayArtifactOutbox(config, {
      persistArtifacts: async ({ runId, artifacts }) => {
        await sleep(80);
        stored.push(`${runId}:${artifacts.length}`);
        return [];
      }
    });
    await sleep(45);
    const competingReplay = await replayArtifactOutbox(config, {
      persistArtifacts: async () => {
        throw new Error("should not run");
      }
    });
    const firstSummary = await firstReplay;

    assert.equal(competingReplay.skipped, true);
    assert.equal(firstSummary.storedCount, 1);
    assert.deepEqual(stored, ["run-1:1"]);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[아티팩트 outbox] 만료되었거나 최대 개수를 넘은 record를 정리한다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifact-prune-"));
  const artifactOutboxFile = join(artifactsRoot, "artifact-outbox.jsonl");

  try {
    const config = createRunnerTestConfig({
      artifactOutboxFile,
      artifactOutboxRetentionMs: 60_000,
      artifactOutboxMaxRecords: 2
    });

    await writeFile(
      artifactOutboxFile,
      [
        JSON.stringify({
          runId: "run-old",
          artifacts: [],
          failedAt: "2000-01-01T00:00:00.000Z",
          attempts: 1,
          retryDelaysMs: [1],
          errorMessage: "old"
        }),
        JSON.stringify({
          runId: "run-2",
          artifacts: [],
          failedAt: new Date().toISOString(),
          attempts: 1,
          retryDelaysMs: [1],
          errorMessage: "recent-2"
        }),
        JSON.stringify({
          runId: "run-3",
          artifacts: [],
          failedAt: new Date().toISOString(),
          attempts: 1,
          retryDelaysMs: [1],
          errorMessage: "recent-3"
        }),
        JSON.stringify({
          runId: "run-4",
          artifacts: [],
          failedAt: new Date().toISOString(),
          attempts: 1,
          retryDelaysMs: [1],
          errorMessage: "recent-4"
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const records = await readArtifactOutboxRecords(config);

    assert.deepEqual(records.map((record) => record.runId), ["run-3", "run-4"]);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[아티팩트 worker] 주기적으로 pending artifact outbox를 비운다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifact-replay-worker-"));
  const artifactOutboxFile = join(artifactsRoot, "artifact-outbox.jsonl");
  const stored: string[] = [];

  try {
    const artifactStore = createArtifactStore(
      createRunnerTestConfig({
        artifactsRoot,
        artifactOutboxFile,
        artifactRetryDelaysMs: [1, 1]
      }),
      {
        persistArtifacts: async () => {
          throw new Error("storage unavailable");
        }
      }
    );

    await assert.rejects(
      () =>
        artifactStore.persistArtifacts({
          runId: "run-1",
          artifacts: [
            {
              artifactId: "artifact-1",
              artifactType: "SCREENSHOT",
              stepKey: "step_001",
              mimeType: "text/plain",
              fileExtension: "txt",
              content: "hello"
            }
          ]
        }),
      /artifact storage failed/
    );

    const app = createRunnerApp({
      artifactsRoot,
      artifactOutboxFile,
      artifactOutboxReplayIntervalMs: 10
    });

    const worker = startArtifactOutboxReplayWorker(app.config, {
      persistArtifacts: async ({ runId, artifacts }) => {
        stored.push(`${runId}:${artifacts.length}`);
        return [];
      }
    });

    await sleep(80);
    await worker.close();

    assert.deepEqual(stored, ["run-1:1"]);
    await assert.rejects(() => readFile(artifactOutboxFile, "utf8"), /ENOENT/);
  } finally {
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[아티팩트 관측성] replay 처리 결과를 구조화된 운영 로그로 남긴다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifact-log-"));
  const artifactOutboxFile = join(artifactsRoot, "artifact-outbox.jsonl");
  const captured: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown, ...optional: unknown[]) => {
    captured.push(String(message));
    if (optional.length > 0) {
      captured.push(optional.map(String).join(" "));
    }
  };

  try {
    const config = createRunnerTestConfig({
      artifactOutboxFile
    });

    await writeFile(
      artifactOutboxFile,
      `${JSON.stringify({
        runId: "run-1",
        artifacts: [],
        failedAt: new Date().toISOString(),
        attempts: 1,
        retryDelaysMs: [1],
        errorMessage: "failed before"
      })}\n`,
      "utf8"
    );

    await replayArtifactOutbox(config, {
      persistArtifacts: async () => []
    });

    assert.ok(
      captured.some((line) => line.includes("\"component\":\"artifact-outbox\"") && line.includes("\"event\":\"replay_completed\""))
    );
  } finally {
    console.log = originalLog;
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[아티팩트 관측성] 저장 재시도 로그는 attempt마다가 아니라 집계 이벤트로 남긴다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifact-log-aggregate-"));
  const captured: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (message?: unknown, ...optional: unknown[]) => {
    captured.push(String(message));
    if (optional.length > 0) {
      captured.push(optional.map(String).join(" "));
    }
  };
  console.error = (message?: unknown, ...optional: unknown[]) => {
    captured.push(String(message));
    if (optional.length > 0) {
      captured.push(optional.map(String).join(" "));
    }
  };

  let attempts = 0;

  try {
    const artifactStore = createArtifactStore(
      createRunnerTestConfig({
        artifactsRoot,
        artifactRetryDelaysMs: [1, 1]
      }),
      {
        persistArtifacts: async () => {
          attempts += 1;
          if (attempts < 3) {
            throw new Error("storage unavailable");
          }

          return [];
        }
      }
    );

    await artifactStore.persistArtifacts({
      runId: "run-1",
      artifacts: [
        {
          artifactId: "artifact-1",
          artifactType: "SCREENSHOT",
          stepKey: "step_001",
          mimeType: "text/plain",
          fileExtension: "txt",
          content: "hello"
        }
      ]
    });

    assert.ok(captured.some((line) => line.includes("\"event\":\"retry_sequence_recovered\"")));
    assert.ok(!captured.some((line) => line.includes("\"event\":\"retry_attempt_failed\"")));
  } finally {
    console.log = originalLog;
    console.error = originalError;
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});

test("[아티팩트 관측성] idle 상태에서는 낮은 빈도의 heartbeat 로그만 남긴다", async () => {
  const artifactsRoot = await mkdtemp(join(tmpdir(), "wedge-runner-artifact-heartbeat-"));
  const artifactOutboxFile = join(artifactsRoot, "artifact-outbox.jsonl");
  const captured: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown, ...optional: unknown[]) => {
    captured.push(String(message));
    if (optional.length > 0) {
      captured.push(optional.map(String).join(" "));
    }
  };

  try {
    const app = createRunnerApp({
      artifactsRoot,
      artifactOutboxFile,
      artifactOutboxReplayIntervalMs: 10,
      artifactOutboxHeartbeatIntervalMs: 25
    });

    const worker = await app.startArtifactOutboxReplayWorker();
    await sleep(80);
    await worker.close();

    assert.ok(
      captured.some((line) => line.includes("\"component\":\"artifact-outbox\"") && line.includes("\"event\":\"worker_idle_heartbeat\""))
    );
  } finally {
    console.log = originalLog;
    await rm(artifactsRoot, { recursive: true, force: true });
  }
});
