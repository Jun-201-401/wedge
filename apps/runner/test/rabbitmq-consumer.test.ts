import assert from "node:assert/strict";
import test from "node:test";
import type { ConsumeMessage } from "amqplib";
import { RunnerMessageValidationError } from "../src/messaging/index.ts";
import { handleRunExecuteMessage, startRunExecuteQueueConsumer } from "../src/messaging/rabbitmq/index.ts";

test("[RabbitMQ consumer] run.execute 메시지 처리 성공 시 ack 한다", async () => {
  const calls: string[] = [];
  const message = createMessage('{"messageType":"run.execute.request"}');

  await handleRunExecuteMessage({
    channel: {
      ack: () => {
        calls.push("ack");
      },
      nack: () => {
        calls.push("nack");
      }
    },
    message,
    processRawMessage: async () => {
      calls.push("process");
    },
    requeueOnFailure: false
  });

  assert.deepEqual(calls, ["process", "ack"]);
});

test("[RabbitMQ consumer] 계약 검증 실패 메시지는 requeue 없이 reject 한다", async () => {
  const calls: Array<string | [string, boolean]> = [];
  const message = createMessage("invalid");

  await handleRunExecuteMessage({
    channel: {
      ack: () => {
        calls.push("ack");
      },
      nack: (_message, _allUpTo, requeue) => {
        calls.push(["nack", requeue ?? false]);
      }
    },
    message,
    processRawMessage: async () => {
      throw new RunnerMessageValidationError("bad payload");
    },
    requeueOnFailure: false
  });

  assert.deepEqual(calls, [["nack", false]]);
});

test("[RabbitMQ consumer] 실행 실패는 설정된 경우에만 requeue 한다", async () => {
  const noRequeueCalls: Array<[string, boolean]> = [];
  const requeueCalls: Array<[string, boolean]> = [];
  const message = createMessage("valid");

  await handleRunExecuteMessage({
    channel: {
      ack: () => {},
      nack: (_message, _allUpTo, requeue) => {
        noRequeueCalls.push(["nack", requeue ?? false]);
      }
    },
    message,
    processRawMessage: async () => {
      throw new Error("worker failed");
    },
    requeueOnFailure: false
  });

  await handleRunExecuteMessage({
    channel: {
      ack: () => {},
      nack: (_message, _allUpTo, requeue) => {
        requeueCalls.push(["nack", requeue ?? false]);
      }
    },
    message,
    processRawMessage: async () => {
      throw new Error("worker failed");
    },
    requeueOnFailure: true
  });

  assert.deepEqual(noRequeueCalls, [["nack", false]]);
  assert.deepEqual(requeueCalls, [["nack", true]]);
});

test("[RabbitMQ consumer] queue consume을 설정하고 종료 시 연결 자원을 닫는다", async () => {
  const events: string[] = [];
  let consumeHandler: ((message: ConsumeMessage | null) => void | Promise<void>) | undefined;

  const consumer = await startRunExecuteQueueConsumer({
    config: {
      mqUrl: "amqp://localhost",
      mqQueueRunExecute: "run.execute.request",
      mqPrefetch: 2,
      mqRequeueOnFailure: false
    },
    processRawMessage: async (rawMessage) => {
      events.push(`process:${rawMessage}`);
    },
    client: {
      connect: async (url) => {
        events.push(`connect:${url}`);

        return {
          createChannel: async () => ({
            prefetch: async (count) => {
              events.push(`prefetch:${count}`);
            },
            checkQueue: async (queue) => {
              events.push(`checkQueue:${queue}`);
            },
            consume: async (queue, onMessage) => {
              events.push(`consume:${queue}`);
              consumeHandler = onMessage;
              return {
                consumerTag: "consumer-tag"
              };
            },
            ack: () => {
              events.push("ack");
            },
            nack: () => {
              events.push("nack");
            },
            close: async () => {
              events.push("channel:close");
            }
          }),
          close: async () => {
            events.push("connection:close");
          }
        };
      }
    }
  });

  assert.deepEqual(events.slice(0, 4), [
    "connect:amqp://localhost",
    "prefetch:2",
    "checkQueue:run.execute.request",
    "consume:run.execute.request"
  ]);

  assert.ok(consumeHandler);
  await consumeHandler?.(createMessage('{"messageType":"run.execute.request"}'));
  assert.ok(events.includes('process:{"messageType":"run.execute.request"}'));
  assert.ok(events.includes("ack"));

  await consumer.close();
  assert.ok(events.includes("channel:close"));
  assert.ok(events.includes("connection:close"));
});

test("[RabbitMQ consumer] null delivery는 ack/reject 없이 무시한다", async () => {
  const events: string[] = [];
  let consumeHandler: ((message: ConsumeMessage | null) => void | Promise<void>) | undefined;

  await startRunExecuteQueueConsumer({
    config: {
      mqUrl: "amqp://localhost",
      mqQueueRunExecute: "run.execute.request",
      mqPrefetch: 1,
      mqRequeueOnFailure: false
    },
    processRawMessage: async (rawMessage) => {
      events.push(`process:${rawMessage}`);
    },
    client: {
      connect: async () => ({
        createChannel: async () => ({
          prefetch: async () => {},
          checkQueue: async () => {},
          consume: async (_queue, onMessage) => {
            consumeHandler = onMessage;
            return { consumerTag: "consumer-tag" };
          },
          ack: () => {
            events.push("ack");
          },
          nack: () => {
            events.push("nack");
          },
          close: async () => {}
        }),
        close: async () => {}
      })
    }
  });

  assert.ok(consumeHandler);
  await consumeHandler?.(null);
  assert.deepEqual(events, []);
});

function createMessage(content: string): ConsumeMessage {
  return {
    content: Buffer.from(content, "utf8"),
    fields: {} as ConsumeMessage["fields"],
    properties: {} as ConsumeMessage["properties"]
  };
}
