import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from "amqplib";
import type { RunnerConfig } from "../../config/index.ts";
import { RunnerMessageValidationError } from "../index.ts";

export interface RunExecuteQueueConsumer {
  close: () => Promise<void>;
}

export interface RunExecuteConsumerInput {
  config: Pick<RunnerConfig, "mqUrl" | "mqQueueRunExecute" | "mqPrefetch" | "mqRequeueOnFailure">;
  processRawMessage: (rawMessage: string) => Promise<void>;
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
  assertQueue: (queue: string, options: { durable: boolean }) => Promise<unknown>;
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
  const connection = await client.connect(config.mqUrl);
  const channel = await connection.createChannel();

  await channel.prefetch(config.mqPrefetch);
  await channel.assertQueue(config.mqQueueRunExecute, {
    durable: true
  });
  await channel.consume(config.mqQueueRunExecute, createRunExecuteConsumerHandler(channel, processRawMessage, config.mqRequeueOnFailure), {
    noAck: false
  });

  return {
    close: async () => {
      await channel.close();
      await connection.close();
    }
  };
}

function createRunExecuteConsumerHandler(
  channel: Pick<RabbitMqChannel, "ack" | "nack">,
  processRawMessage: (rawMessage: string) => Promise<void>,
  requeueOnFailure: boolean
): (message: ConsumeMessage | null) => Promise<void> {
  return async (message) => {
    if (!message) {
      return;
    }

    await handleRunExecuteMessage({
      channel,
      message,
      processRawMessage,
      requeueOnFailure
    });
  };
}

export async function handleRunExecuteMessage({
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
