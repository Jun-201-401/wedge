# Packet 09 - common-outbox-idempotency

## Scope

Read-only review of the common outbox, processed-message idempotency, runner/analysis/discovery/scenario-authoring dispatchers, Rabbit publishers/config, dead-letter handling, and operational reliability surfaces.

## Flow Map

1. Domain services enqueue outbox rows in the same transaction as aggregate state changes.
2. After-commit events and scheduled retry workers select pending/failed rows with row locks.
3. Per-domain dispatchers deserialize outbox messages, publish to RabbitMQ, and mark rows `PUBLISHED` or `FAILED`.
4. Runner/analyzer callbacks record processed messages for duplicate suppression.
5. Some runner queues have dead-letter listeners that settle failed run/agent state.

## Files Reviewed

- `apps/api-server/src/main/java/com/wedge/common/infrastructure/outbox/**`
- `apps/api-server/src/main/resources/mapper/common/outbox/OutboxMessageMapper.xml`
- `apps/api-server/src/main/java/com/wedge/common/**ProcessedMessage**`
- `apps/api-server/src/main/resources/mapper/common/ProcessedMessageMapper.xml`
- `apps/api-server/src/main/java/com/wedge/**/**/*OutboxDispatcher.java`
- Rabbit publishers and MQ config under run/discovery/scenario-authoring/analysis/common
- `apps/api-server/src/main/java/com/wedge/run/infrastructure/RunnerExecutionDeadLetterListener.java`
- `packages/contracts/mq/messages.schema.json`
- outbox/idempotency/MQ tests and operational docs

## Invariants Expected

- Domain state and outgoing command enqueue must be transactional.
- `PUBLISHED` must mean broker-routable/durable delivery has been accepted, or the state name must not imply that.
- Failed outbox rows must remain visible until terminally settled.
- Poison payloads must not wedge the retry scheduler.
- Every configured DLQ should settle or visibly surface the owning aggregate.
- Idempotency predicates must bind the full command/attempt identity.
- MQ contracts must require fields used for duplicate handling.

## Findings

### CRITICAL

None.

### HIGH

1. Outbox rows can be marked `PUBLISHED` before RabbitMQ confirms durable/routable delivery.

Evidence:

- Dispatchers call `publish(...)` then immediately `markPublished(...)`: `apps/api-server/src/main/java/com/wedge/run/application/RunExecuteOutboxDispatcher.java:47`, `apps/api-server/src/main/java/com/wedge/analysis/application/AnalysisRequestOutboxDispatcher.java:46`.
- Publishers use plain `RabbitTemplate.convertAndSend(...)`: `apps/api-server/src/main/java/com/wedge/run/infrastructure/RabbitRunRequestPublisher.java:39`, `apps/api-server/src/main/java/com/wedge/analysis/infrastructure/RabbitAnalysisRequestPublisher.java:33`.
- Application Rabbit config sets connection properties but no publisher confirms/returns: `apps/api-server/src/main/resources/application-prod.yml:14`.

Failure scenario:

If a routing key/exchange is wrong, a binding is missing, or Rabbit accepts the TCP publish but does not confirm durable/routable delivery, the row is marked `PUBLISHED` and excluded from retry, permanently losing the command.

Fix direction:

Enable publisher confirms and returns, set mandatory publishing, and only mark outbox rows `PUBLISHED` after positive broker confirmation. Add an integration test where an unroutable/negative-confirm publish keeps the row retryable.

2. Dead-letter handling only covers run/agent queues while discovery, scenario-authoring, and analysis DLQs are configured.

Evidence:

- Discovery and scenario-authoring queues have DLQ routing: `apps/api-server/src/main/java/com/wedge/common/infrastructure/RunnerMqConfig.java:67`, `:86`.
- Analysis queue has DLQ routing: `apps/api-server/src/main/java/com/wedge/analysis/infrastructure/AnalysisMqConfig.java:15`.
- The listener subscribes only to run and agent DLQs: `apps/api-server/src/main/java/com/wedge/run/infrastructure/RunnerExecutionDeadLetterListener.java:28`, `:33`.

Failure scenario:

A poison `discovery.execute.request`, `scenario-authoring.execute.request`, or `analysis.request` reaches max broker delivery attempts and lands in DLQ. No API listener marks the corresponding aggregate failed, so user-visible state can stay `QUEUED` or `RUNNING` indefinitely.

Fix direction:

Add DLQ listeners for every configured outbox queue, or a generic dead-letter listener that dispatches by message type and marks the owning aggregate failed with `x-death` metadata.

3. Outbox retry exhaustion has no explicit terminal failure model.

Evidence:

- Retry selection is capped by `attempt_count < 10`: `apps/api-server/src/main/java/com/wedge/common/infrastructure/outbox/OutboxMessagePersistenceAdapter.java:30`.
- Query excludes rows at max attempt count: `apps/api-server/src/main/resources/mapper/common/outbox/OutboxMessageMapper.xml:51`, `:55`.
- `markFailed` leaves rows in `FAILED` and schedules the next attempt: `apps/api-server/src/main/resources/mapper/common/outbox/OutboxMessageMapper.xml:70`.
- DDL has no `EXHAUSTED`, `DEAD_LETTERED`, `last_error`, or `exhausted_at`: `infra/db/migrations/V20260506__add_outbox_runtime_tables.sql:17`, `docs/wedge_schema.sql:518`.

Failure scenario:

A broker outage or permanent payload/config issue lasts through 10 attempts. The row remains `FAILED` but is no longer selected, with no terminal marker or alert metadata.

Fix direction:

Add an explicit `EXHAUSTED`/`DEAD_LETTERED` state, last-error metadata, exhausted timestamp, operational query, and alerting metric.

### MEDIUM

1. Poison outbox payloads can abort the retry worker before attempt count is updated.

Evidence:

- Due-message reads deserialize and map records before dispatcher-level `try/catch`: `apps/api-server/src/main/java/com/wedge/common/infrastructure/outbox/OutboxMessagePersistenceAdapter.java:157`.
- Bad JSON/schema throws `IllegalStateException`: `apps/api-server/src/main/java/com/wedge/common/infrastructure/outbox/OutboxMessagePersistenceAdapter.java:292`.
- Dispatcher catch blocks wrap already-materialized message publishing: `apps/api-server/src/main/java/com/wedge/analysis/application/AnalysisRequestOutboxDispatcher.java:44`.

Failure scenario:

A stored outbox row from an older schema or manual repair has malformed payload fields. The scheduled worker fails while building the batch, rolls back, does not increment `attempt_count`, and retries the same poison row every cycle.

Fix direction:

Claim raw rows first, deserialize per row inside the dispatcher failure boundary, and quarantine malformed rows with visible diagnostics.

2. Agent idempotency completion does not match the full lease identity tuple.

Evidence:

- Agent lease renew/release predicates include command identity fields such as run/task/attempt identity: `apps/api-server/src/main/resources/mapper/run/AgentIdempotencyMapper.xml:78`.
- `completeClaimed` matches only `idempotency_key_hash`, `status`, and `claimed_by`: `apps/api-server/src/main/resources/mapper/run/AgentIdempotencyMapper.xml:102`.

Failure scenario:

If key collision/misuse or stale worker context crosses attempts, completion can settle a claim with weaker identity than renew/release require.

Fix direction:

Make completion match the same tuple as renew/release: key hash, claimed worker, run id, task id, attempt id, and attempt index.

3. Run/discovery terminal idempotency is first-writer-wins only after completion.

Evidence:

- Terminal idempotency is recorded by `RunnerMessageIdempotencyService`: `apps/api-server/src/main/java/com/wedge/run/application/RunnerMessageIdempotencyService.java:38`.
- Mapper insert/update tracks terminal records but does not create an in-progress lease: `apps/api-server/src/main/resources/mapper/run/RunnerMessageIdempotencyMapper.xml:24`.

Failure scenario:

Concurrent duplicate terminal callbacks can both perform work until one wins the final idempotency record, depending on call ordering.

Fix direction:

Add an in-progress claim/lease or move duplicate suppression before state mutation for terminal callback handlers.

4. Analysis MQ exchange/DLX configuration can split publisher routing from queue bindings.

Evidence:

- `RabbitAnalysisRequestPublisher` publishes to `wedge.analyzer.mq.exchange`: `apps/api-server/src/main/java/com/wedge/analysis/infrastructure/RabbitAnalysisRequestPublisher.java:21`.
- `AnalysisMqConfig` binds the analysis queue to the shared `wedgeDirectExchange` bean: `apps/api-server/src/main/java/com/wedge/analysis/infrastructure/AnalysisMqConfig.java:34`.
- That shared exchange bean is created from `wedge.runner.mq.exchange`: `apps/api-server/src/main/java/com/wedge/common/infrastructure/RunnerMqConfig.java:16`.
- Analysis DLQ binding uses the shared dead-letter exchange bean: `apps/api-server/src/main/java/com/wedge/analysis/infrastructure/AnalysisMqConfig.java:39`.

Failure scenario:

An environment sets analyzer exchange/DLX properties differently from runner MQ properties. The publisher sends to one exchange while queue/DLQ bindings use another.

Fix direction:

Either explicitly share the runner exchange property for analysis, or define analyzer exchange/DLX beans from analyzer properties and bind queues to those beans. Add a config test with non-default analyzer exchange names.

5. MQ schema does not require fields used for duplicate handling.

Evidence:

- `idempotencyKey` is defined but not required for run messages: `packages/contracts/mq/messages.schema.json:255`, `:263`.
- Same pattern exists for analysis messages: `packages/contracts/mq/messages.schema.json:343`, `:351`.
- Operational docs rely on idempotency records for duplicate replay defense: `docs/runner_operational_runbook.md:40`.

Failure scenario:

A generated producer or schema-valid fixture omits `idempotencyKey`; consumers relying on it cannot safely deduplicate.

Fix direction:

Make `correlationId` and `idempotencyKey` required for all outbox-published MQ envelopes, or document and test a fallback idempotency rule.

6. Common outbox adapter is coupled to every domain message type.

Evidence:

- `OutboxMessagePersistenceAdapter` imports and hardcodes domain message types/event types: `apps/api-server/src/main/java/com/wedge/common/infrastructure/outbox/OutboxMessagePersistenceAdapter.java:6`, `:21`.
- Dispatch/retry/mark patterns are duplicated across multiple domain dispatchers: `apps/api-server/src/main/java/com/wedge/run/application/RunExecuteOutboxDispatcher.java:38`, `apps/api-server/src/main/java/com/wedge/scenarioauthoring/application/ScenarioAuthoringExecuteOutboxDispatcher.java:36`.

Failure scenario:

Every new queue/message requires changing common infrastructure and duplicating reliability logic, increasing drift risk across domains.

Fix direction:

Move domain-specific message codecs/event routing behind per-domain adapters while keeping common persistence a generic envelope store.

## Test Gaps

- No test for Rabbit negative confirm/unroutable return keeping outbox rows retryable.
- No DLQ tests for discovery, scenario-authoring, or analysis queues.
- No poisoned outbox payload test.
- No max-attempt exhaustion transition test.
- No contract test validating emitted MQ envelopes against `packages/contracts/mq/messages.schema.json`.

## Architectural Status

`BLOCK`.

The outbox provides a useful transactional enqueue plus scheduled retry spine, and callback/idempotency ledgers exist. The blocker is that this is currently treated as a reliability primitive while publish success, terminal failure visibility, and some idempotency predicates are weaker than the contracts imply.

## Verification Evidence

- Code-reviewer lane ran scoped dispatcher/MQ/DLQ Gradle tests and reported `BUILD SUCCESSFUL`.
- Static `rg` checks found no scoped hardcoded secrets, `System.out`, or empty catch blocks.
- Architect lane reviewed outbox/idempotency ownership and marked the packet `BLOCK`.
- No source files were edited.

## Recommendation

REQUEST CHANGES. Define the outbox reliability contract explicitly before relying on it operationally: confirmed publish or renamed attempted-publish semantics, visible terminal failure state, poison-row quarantine, DLQ settlement symmetry, and strict idempotency ownership predicates.
