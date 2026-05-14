import amqp, { type ChannelModel, type ConsumeMessage } from "amqplib";
import type { RunnerConfig } from "../../config/index.ts";
import { logOperationalEvent } from "../../shared/utils.ts";
import { RunnerMessageValidationError } from "../index.ts";

const DEFAULT_MAX_DELIVERY_ATTEMPTS = 3;

export interface RunExecuteQueueConsumer {
  close: () => Promise<void>;
}

export type RunnerQueueConsumer = RunExecuteQueueConsumer;

export interface RunExecuteConsumerInput {
  config: Pick<RunnerConfig, "mqUrl" | "mqQueueRunExecute" | "mqPrefetch" | "mqRequeueOnFailure"> & Partial<Pick<RunnerConfig, "mqMaxDeliveryAttempts">>;
  processRawMessage: (rawMessage: string) => Promise<void>;
  client?: RabbitMqClient;
}

export interface AgentExecuteConsumerInput {
  config: Pick<RunnerConfig, "mqUrl" | "mqQueueAgentExecute" | "agentConcurrency" | "mqRequeueOnFailure"> & Partial<Pick<RunnerConfig, "mqMaxDeliveryAttempts">>;
  processRawMessage: (rawMessage: string) => Promise<void>;
  client?: RabbitMqClient;
}

export interface DiscoveryExecuteConsumerInput {
  config: Pick<RunnerConfig, "mqUrl" | "mqQueueDiscoveryExecute" | "mqPrefetch" | "mqRequeueOnFailure"> & Partial<Pick<RunnerConfig, "mqMaxDeliveryAttempts">>;
  processRawMessage: (rawMessage: string) => Promise<void>;
  client?: RabbitMqClient;
}

export interface RunnerQueuesConsumerInput {
  config: Pick<RunnerConfig, "mqUrl" | "mqQueueRunExecute" | "mqQueueAgentExecute" | "mqQueueDiscoveryExecute" | "mqPrefetch" | "agentConcurrency" | "mqRequeueOnFailure"> & Partial<Pick<RunnerConfig, "mqMaxDeliveryAttempts">>;
  processRawRunMessage: (rawMessage: string) => Promise<void>;
  processRawAgentMessage: (rawMessage: string) => Promise<void>;
  processRawDiscoveryMessage: (rawMessage: string) => Promise<void>;
  client?: RabbitMqClient;
}

export interface RabbitMqClient {
  connect: (url: string) => Promise<RabbitMqConnection>;
}

export interface RabbitMqConnection {
  createChannel: () => Promise<RabbitMqChannel>;
  close: () => Promise<void>;
}

export interface RabbitMqChannel {
  prefetch: (count: number) => Promise<unknown> | unknown;
  checkQueue: (queue: string) => Promise<unknown>;
  consume: (
    queue: string,
    onMessage: (message: ConsumeMessage | null) => void | Promise<void>,
    options: { noAck: boolean }
  ) => Promise<{ consumerTag: string }>;
  ack: (message: ConsumeMessage) => void;
  nack: (message: ConsumeMessage, allUpTo?: boolean, requeue?: boolean) => void;
  close: () => Promise<unknown>;
}

export async function startRunExecuteQueueConsumer({
  config,
  processRawMessage,
  client = defaultRabbitMqClient
}: RunExecuteConsumerInput): Promise<RunExecuteQueueConsumer> {
  return startSingleQueueConsumer({
    mqUrl: config.mqUrl,
    queue: config.mqQueueRunExecute,
    prefetch: config.mqPrefetch,
    requeueOnFailure: config.mqRequeueOnFailure,
    maxDeliveryAttempts: config.mqMaxDeliveryAttempts,
    processRawMessage,
    client
  });
}

export async function startAgentExecuteQueueConsumer({
  config,
  processRawMessage,
  client = defaultRabbitMqClient
}: AgentExecuteConsumerInput): Promise<RunExecuteQueueConsumer> {
  return startSingleQueueConsumer({
    mqUrl: config.mqUrl,
    queue: config.mqQueueAgentExecute,
    prefetch: config.agentConcurrency,
    requeueOnFailure: config.mqRequeueOnFailure,
    maxDeliveryAttempts: config.mqMaxDeliveryAttempts,
    processRawMessage,
    client
  });
}

export async function startDiscoveryExecuteQueueConsumer({
  config,
  processRawMessage,
  client = defaultRabbitMqClient
}: DiscoveryExecuteConsumerInput): Promise<RunExecuteQueueConsumer> {
  return startSingleQueueConsumer({
    mqUrl: config.mqUrl,
    queue: config.mqQueueDiscoveryExecute,
    prefetch: config.mqPrefetch,
    requeueOnFailure: config.mqRequeueOnFailure,
    maxDeliveryAttempts: config.mqMaxDeliveryAttempts,
    processRawMessage,
    client
  });
}

export async function startRunnerQueueConsumers({
  config,
  processRawRunMessage,
  processRawAgentMessage,
  processRawDiscoveryMessage,
  client = defaultRabbitMqClient
}: RunnerQueuesConsumerInput): Promise<RunnerQueueConsumer> {
  const connection = await client.connect(config.mqUrl);
  const channels: RabbitMqChannel[] = [];

  try {
    const runChannel = await startQueueConsumerOnNewChannel({
      connection,
      queue: config.mqQueueRunExecute,
      prefetch: config.mqPrefetch,
      requeueOnFailure: config.mqRequeueOnFailure,
      maxDeliveryAttempts: config.mqMaxDeliveryAttempts,
      processRawMessage: processRawRunMessage
    });
    channels.push(runChannel);

    const agentChannel = await startQueueConsumerOnNewChannel({
      connection,
      queue: config.mqQueueAgentExecute,
      prefetch: config.agentConcurrency,
      requeueOnFailure: config.mqRequeueOnFailure,
      maxDeliveryAttempts: config.mqMaxDeliveryAttempts,
      processRawMessage: processRawAgentMessage
    });
    channels.push(agentChannel);

    const discoveryChannel = await startQueueConsumerOnNewChannel({
      connection,
      queue: config.mqQueueDiscoveryExecute,
      prefetch: config.mqPrefetch,
      requeueOnFailure: config.mqRequeueOnFailure,
      maxDeliveryAttempts: config.mqMaxDeliveryAttempts,
      processRawMessage: processRawDiscoveryMessage
    });
    channels.push(discoveryChannel);
  } catch (error) {
    await closeQueueConsumerResources(channels, connection);
    throw error;
  }

  return {
    close: async () => {
      await closeQueueConsumerResources(channels, connection);
    }
  };
}

async function startQueueConsumerOnNewChannel({
  connection,
  queue,
  prefetch,
  requeueOnFailure,
  maxDeliveryAttempts,
  processRawMessage
}: {
  connection: RabbitMqConnection;
  queue: string;
  prefetch: number;
  requeueOnFailure: boolean;
  maxDeliveryAttempts?: number;
  processRawMessage: (rawMessage: string) => Promise<void>;
}): Promise<RabbitMqChannel> {
  const channel = await connection.createChannel();

  await channel.prefetch(prefetch);
  await channel.checkQueue(queue);
  await channel.consume(queue, createQueueConsumerHandler(channel, processRawMessage, requeueOnFailure, maxDeliveryAttempts), {
    noAck: false
  });

  return channel;
}

async function closeQueueConsumerResources(
  channels: RabbitMqChannel[],
  connection: RabbitMqConnection
): Promise<void> {
  const errors: unknown[] = [];

  for (const channel of [...channels].reverse()) {
    try {
      await channel.close();
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    await connection.close();
  } catch (error) {
    errors.push(error);
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  if (errors.length > 1) {
    throw new AggregateError(errors, "failed to close RabbitMQ consumer resources");
  }
}

async function startSingleQueueConsumer({
  mqUrl,
  queue,
  prefetch,
  requeueOnFailure,
  maxDeliveryAttempts,
  processRawMessage,
  client
}: {
  mqUrl: string;
  queue: string;
  prefetch: number;
  requeueOnFailure: boolean;
  maxDeliveryAttempts?: number;
  processRawMessage: (rawMessage: string) => Promise<void>;
  client: RabbitMqClient;
}): Promise<RunExecuteQueueConsumer> {
  const connection = await client.connect(mqUrl);
  const channel = await connection.createChannel();

  await channel.prefetch(prefetch);
  await channel.checkQueue(queue);
  await channel.consume(queue, createQueueConsumerHandler(channel, processRawMessage, requeueOnFailure, maxDeliveryAttempts), {
    noAck: false
  });

  return {
    close: async () => {
      await channel.close();
      await connection.close();
    }
  };
}

function createQueueConsumerHandler(
  channel: Pick<RabbitMqChannel, "ack" | "nack">,
  processRawMessage: (rawMessage: string) => Promise<void>,
  requeueOnFailure: boolean,
  maxDeliveryAttempts?: number
): (message: ConsumeMessage | null) => Promise<void> {
  return async (message) => {
    if (!message) {
      return;
    }

    await handleQueueMessage({
      channel,
      message,
      processRawMessage,
      requeueOnFailure,
      maxDeliveryAttempts
    });
  };
}

export async function handleRunExecuteMessage(input: {
  channel: Pick<RabbitMqChannel, "ack" | "nack">;
  message: ConsumeMessage;
  processRawMessage: (rawMessage: string) => Promise<void>;
  requeueOnFailure: boolean;
  maxDeliveryAttempts?: number;
}): Promise<void> {
  return handleQueueMessage(input);
}

export async function handleQueueMessage({
  channel,
  message,
  processRawMessage,
  requeueOnFailure,
  maxDeliveryAttempts
}: {
  channel: Pick<RabbitMqChannel, "ack" | "nack">;
  message: ConsumeMessage;
  processRawMessage: (rawMessage: string) => Promise<void>;
  requeueOnFailure: boolean;
  maxDeliveryAttempts?: number;
}): Promise<void> {
  const rawMessage = message.content.toString("utf8");

  try {
    await processRawMessage(rawMessage);
    channel.ack(message);
  } catch (error) {
    if (error instanceof RunnerMessageValidationError) {
      channel.nack(message, false, false);
      return;
    }

    const observedAttempts = resolveObservedDeliveryAttempts(message);
    const maxAttempts = normalizeMaxDeliveryAttempts(maxDeliveryAttempts);
    const shouldRequeue = requeueOnFailure && observedAttempts < maxAttempts;

    if (requeueOnFailure && !shouldRequeue) {
      logOperationalEvent(
        "rabbitmq-consumer",
        "poison_message_rejected",
        {
          observedAttempts,
          maxDeliveryAttempts: maxAttempts
        },
        "warn"
      );
    }

    channel.nack(message, false, shouldRequeue);
  }
}

function normalizeMaxDeliveryAttempts(value: number | undefined): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  return DEFAULT_MAX_DELIVERY_ATTEMPTS;
}

function resolveObservedDeliveryAttempts(message: ConsumeMessage): number {
  const deliveryCount = readPositiveHeaderNumber(message.properties.headers?.["x-delivery-count"]);
  const deathCount = readXDeathCount(message.properties.headers?.["x-death"]);

  return Math.max(
    deliveryCount ?? 0,
    deathCount !== null ? deathCount + 1 : 0,
    message.fields.redelivered ? 2 : 1
  );
}

function readXDeathCount(value: unknown): number | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const counts = value
    .map((entry) => typeof entry === "object" && entry !== null ? readPositiveHeaderNumber((entry as { count?: unknown }).count) : null)
    .filter((count): count is number => count !== null);

  return counts.length > 0 ? Math.max(...counts) : null;
}

function readPositiveHeaderNumber(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

const defaultRabbitMqClient: RabbitMqClient = {
  async connect(url) {
    return amqp.connect(url) as Promise<ChannelModel>;
  }
};
