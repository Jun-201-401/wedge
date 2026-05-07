export interface AgentDeadline {
  readonly expiresAtMs: number;
}

export class AgentBudgetExceededError extends Error {
  constructor(phase: string) {
    super(`Agent execution exceeded max_duration_ms during ${phase}.`);
    this.name = "AgentBudgetExceededError";
  }
}

export function createAgentDeadline(maxDurationMs: number): AgentDeadline {
  return {
    expiresAtMs: Date.now() + maxDurationMs
  };
}

export function remainingAgentBudgetMs(deadline: AgentDeadline): number {
  return deadline.expiresAtMs - Date.now();
}

export function assertAgentDeadline(deadline: AgentDeadline, phase: string): void {
  if (remainingAgentBudgetMs(deadline) <= 0) {
    throw new AgentBudgetExceededError(phase);
  }
}

export async function runWithinAgentDeadline<T>(
  deadline: AgentDeadline,
  phase: string,
  operation: () => Promise<T> | T
): Promise<T> {
  assertAgentDeadline(deadline, phase);
  const remainingMs = remainingAgentBudgetMs(deadline);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new AgentBudgetExceededError(phase)), Math.max(1, remainingMs));
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function runSideEffectWithDeadlineCleanup<T>(
  deadline: AgentDeadline,
  phase: string,
  operation: () => Promise<T> | T
): Promise<T> {
  assertAgentDeadline(deadline, phase);
  const remainingMs = remainingAgentBudgetMs(deadline);
  const operationPromise = Promise.resolve().then(operation);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operationPromise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new AgentBudgetExceededError(phase)), Math.max(1, remainingMs));
      })
    ]);
  } catch (error) {
    if (error instanceof AgentBudgetExceededError) {
      try {
        await operationPromise;
      } catch {
        // The run has already exceeded its Agent duration budget. Swallow the
        // late operation error so the terminal outcome stays EXHAUSTED while
        // still preventing side effects from continuing after executeAgentRun
        // returns.
      }
    }

    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
