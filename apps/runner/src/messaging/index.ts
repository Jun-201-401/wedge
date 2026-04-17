export interface RunnerMessage {
  kind: "placeholder";
  description: string;
}

export function registerMessageHandlers(): string {
  return "runner-messaging-scaffold";
}
