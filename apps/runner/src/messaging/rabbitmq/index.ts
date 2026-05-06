import amqp, { type ChannelModel, type ConsumeMessage } from "amqplib";
import type { RunnerConfig } from "../../config/index.ts";
import { RunnerMessageValidationError } from "../index.ts";

export interface RunExecuteQueueConsumer {
  close: () => Promise<void>;
}

export type RunnerQueueConsumer = RunExecuteQueueConsumer;

export interface RunExecuteConsumerInput {
  config: Pick<RunnerConfig, "mqUrl" | "mqQueueRunExecute" | "mqPrefetch" | "mqRequeueOnFailure">;
  processRawMessage: (rawMessage: string) => Promise<void>;
  client?: RabbitMqClient;
}

export interface AgentExecuteConsumerInput {
  config: Pick<RunnerConfig, "mqUrl" | "mqQueueAgentExecute" | "mqPrefetch" | "mqRequeueOnFailure">;
  processRawMessage: (rawMessage: string) => Promise<void>;
  client?: RabbitMqClient;
}

export interface DiscoveryExecuteConsumerInput {
  config: Pick<RunnerConfig, "mqUrl" | "mqQueueDiscoveryExecute" | "mqPrefetch" | "mqRequeueOnFailure">;
  processRawMessage: (rawMessage: string) => Promise<void>;
  client?: RabbitMqClient;
}

export interface RunnerQueuesConsumerInput {
  config: Pick<RunnerConfig, "mqUrl" | "mqQueueRunExecute" | "mqQueueAgentExecute" | "mqQueueDiscoveryExecute" | "mqPrefetch" | "mqRequeueOnFailure">;
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
    prefetch: config.mqPrefetch,
    requeueOnFailure: config.mqRequeueOnFailure,
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
  const channel = await connection.createChannel();

  await channel.prefetch(config.mqPrefetch);
  await channel.checkQueue(config.mqQueueRunExecute);
  await channel.checkQueue(config.mqQueueAgentExecute);
  await channel.checkQueue(config.mqQueueDiscoveryExecute);
  await channel.consume(
    config.mqQueueRunExecute,
    createQueueConsumerHandler(channel, processRawRunMessage, config.mqRequeueOnFailure),
    { noAck: false }
  );
  await channel.consume(
    config.mqQueueAgentExecute,
    createQueueConsumerHandler(channel, processRawAgentMessage, config.mqRequeueOnFailure),
    { noAck: false }
  );
  await channel.consume(
    config.mqQueueDiscoveryExecute,
    createQueueConsumerHandler(channel, processRawDiscoveryMessage, config.mqRequeueOnFailure),
    { noAck: false }
  );

  return {
    close: async () => {
      await channel.close();
      await connection.close();
    }
  };
}

async function startSingleQueueConsumer({
  mqUrl,
  queue,
  prefetch,
  requeueOnFailure,
  processRawMessage,
  client
}: {
  mqUrl: string;
  queue: string;
  prefetch: number;
  requeueOnFailure: boolean;
  processRawMessage: (rawMessage: string) => Promise<void>;
  client: RabbitMqClient;
}): Promise<RunExecuteQueueConsumer> {
  const connection = await client.connect(mqUrl);
  const channel = await connection.createChannel();

  await channel.prefetch(prefetch);
  await channel.checkQueue(queue);
  await channel.consume(queue, createQueueConsumerHandler(channel, processRawMessage, requeueOnFailure), {
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
  requeueOnFailure: boolean
): (message: ConsumeMessage | null) => Promise<void> {
  return async (message) => {
    if (!message) {
      return;
    }

    await handleQueueMessage({
      channel,
      message,
      processRawMessage,
      requeueOnFailure
    });
  };
}

export async function handleRunExecuteMessage(input: {
  channel: Pick<RabbitMqChannel, "ack" | "nack">;
  message: ConsumeMessage;
  processRawMessage: (rawMessage: string) => Promise<void>;
  requeueOnFailure: boolean;
}): Promise<void> {
  return handleQueueMessage(input);
}

export async function handleQueueMessage({
  channel,
  message,
  processRawMessage,
  requeueOnFailure
}: {
  channel: Pick<RabbitMqChannel, "ack" | "nack">;
  message: ConsumeMessage;
  processRawMessage: (rawMessage: string) => Promise<void>;
  requeueOnFailure: boolean;
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

    channel.nack(message, false, requeueOnFailure);
  }
}

const defaultRabbitMqClient: RabbitMqClient = {
  async connect(url) {
    return amqp.connect(url) as Promise<ChannelModel>;
  }
};
