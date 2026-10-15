# TaroDomain TypeScript — Implementation Plan

Source of truth: [`packages/tarodomain-spec/README.md`](packages/tarodomain-spec/README.md), the TaroDomain Design Specification v1.0, pinned at commit `ce4394a`. Section numbers (§) below refer to that document.

This plan is organised around the spec's Layered Architecture (§1.2). Every module belongs to exactly one layer, the layers are built bottom-up, and a test stops imports from crossing layers in the wrong direction.

## 1. Goals

- Implement the full spec in TypeScript as a set of npm packages under the `@tarodomain` scope.
- Make the §1.2 layers real in the code: one directory per layer, a one-way import rule, and a test that enforces it.
- Keep the Domain layer pure. User domain code (aggregates, events, commands, value objects) never reaches persistence, buses or platforms (§1.1).
- Keep the core platform-agnostic. Cloudflare lives in a separate provider package (§24).
- Follow the spec's style: OOP with method-name conventions (`on[Event]`, `startsWhen[Event]`, …), no decorators (§1.1).
- Verify every adapter against the same shared conformance suite, and run fully locally (in-memory) before any cloud provider.

**Non-goals for v0.1:** a CLI or project generator beyond the template functions in §26.3, adapters for other databases (Postgres and so on), and performance tuning beyond what the spec describes.

**Deferred: the AWS provider.** This plan skips everything AWS-specific in the spec: DynamoDB (§7.2, §24.4, §27.3), `SqsEventBus` (§10.3), `AwsProvider` (§24.2), `AwsLambda` (§26.2) and the AWS templates (§26.3). Nothing in core depends on AWS, so a `@tarodomain/aws` package can be added later on top of the `Provider` interface and the conformance suites.

## 2. The layers in code

### 2.1 Layer map

Each layer in the §1.2 diagram gets one directory in `packages/core/src/`. The diagram's side-by-side boxes (Command Pipeline and Event Bus; the three handler columns) share a directory and become sub-modules.

| Layer (§1.2) | Directory | Contents | Spec |
|---|---|---|---|
| Worker Entry Point | `entry/` | HTTP command router, queue and cron entry logic, template generators | §26 |
| Framework (builder) | `framework/` | `TaroDomain.builder()`, `Framework`, DI container, startup validation | §15.3–15.4, §23, §25, §29.1 |
| Command Pipeline + Event Bus | `dispatch/` | `EventBus` and `EventHandler` contracts, strong and eventual pipelines, `InMemoryEventBus`, queue consumer, cron catch-up, dead letters, saga timeouts, rebuild | §10.1–10.2, §10.4–10.5, §11, §14.1, §15.1–15.2, §16, §18, §19.1, §19.3, §20, §21.2–21.3, §29.2 |
| Command / Projection / Saga Handlers | `handlers/` | `CommandHandler`, `Projection`, `ProcessManager`, `SagaEventHandler` | §4, §12, §13, §17, §19.2, §29.3 |
| Domain Layer (pure) | `domain/` | `DomainEvent`, `Command`, `ValueObject`, `AggregateId`, `AggregateRoot`, `ExecutionContext` | §2, §5, §28.1 |
| Persistence Layer (adapters) | `persistence/` | Store contracts, `UnitOfWork` contract, `EventRegistry`, `EventStore`, repositories | §3, §6–9, §11.4, §12.3, §14, §21.1, §28.3 |
| Platform Layer (provider) | `platform/` | `Provider` interface, in-memory adapters, `LocalProvider` | §7.2, §10.3, §24, §27 |
| *Kernel (implicit)* | `kernel/` | Error hierarchy, UUIDv7, backoff, stable hashing, convention lookup, `Clock` and `Logger` | §22, §2.1, §16.2 |

The diagram leaves the Kernel implicit. It holds the cross-cutting pieces every layer needs and imports nothing.

```
packages/core/src/        kernel/ domain/ persistence/ handlers/ dispatch/ platform/ framework/ entry/ testing/
packages/cloudflare/src/  platform/ entry/
```

`testing/` holds the adapter conformance suites (§3.3). It sits outside the layer chain: it may import any layer, and nothing else in `src/` may import it.

### 2.2 Import rule

The diagram shows the **call path**: a request enters at the top and reaches the database at the bottom. It can't also be the **import graph**. Read that way, the Domain layer would import Persistence and the Platform, and the spec requires domain code free of infrastructure (§1.1). So the code uses dependency inversion:

- Each contract **lives in the layer where the spec defines it**. Persistence has `EventStoreAdapter`, the other store contracts and `UnitOfWork`. Handlers have `CommandDispatcher`. Dispatch has `EventBus`, `EventHandler` and the `QueueMessage` port.
- The **Platform layer implements** those contracts. It sits at the bottom of the call path but near the top of the import order, because it plugs implementations into contracts that other layers define.
- Only the **Framework** picks a platform, through the `Provider` interface.

That gives one linear import order. A module may import from its own layer or from any layer to its left:

```
kernel → domain → persistence → handlers → dispatch → platform → framework → entry
```

One exception keeps the Event Bus contracts in the Event Bus layer, where §1.2 and §10 put them. Two layers to its left need them. `Repository.save()` publishes right after appending (§6.2 step 4), and `CommandHandler` receives the bus (§4.1). Projections and saga handlers implement `EventHandler` (§12.1, §13.3). So a module may also import another layer's **contract module** (`contracts.ts`), wherever that layer sits, provided that:

- the import is type-only (`import type`), so it is erased at runtime and can't create a load cycle;
- the contract module holds only interfaces and types, and imports only from Kernel, Domain and other contract modules.

Today only `dispatch/bus/contracts.ts` (`EventBus`, `EventHandler`) needs this.

`UnitOfWork` (§11.4) lives in Persistence, even though the spec describes it with the Command Pipeline, because it is the transaction boundary over the stores. The pipelines call it and the Platform implements it. Both sit to the right of Persistence, so it needs no exception.

`SerializedEvent` lives in Domain, because `DomainEvent.serialize()` and `rehydrate()` produce and consume it (§2.1). It is plain data, with no I/O.

### 2.3 Enforcement

`packages/core/test/architecture.test.ts` scans every file under `src/` and resolves its relative imports to a layer directory. It fails when:

- a module imports from a layer to its right, unless it is a type-only import from a contract module;
- a contract module contains runtime code, or imports anything other than Kernel, Domain and other contract modules;
- anything other than a test imports `testing/`;
- a module outside `platform/node/` imports a `node:*` built-in, so core keeps running unchanged on Workers;
- a module inside `src/` imports a layer's `index.ts` barrel. Barrels are for the public API only, and internal barrel imports create cycles.

It needs no extra dependency. The Cloudflare package gets a smaller version: its `platform/` must not import its `entry/`.

### 2.4 Packages and entry points

| Package | Layers |
|---|---|
| `@tarodomain/core` | All layers. Platform holds only the local provider; Entry holds only platform-neutral logic. |
| `@tarodomain/cloudflare` | Platform (D1, Queues, `CloudflareProvider`) and Entry (`CloudflareWorker`, `.useCloudflare()`, templates) |

`@tarodomain/core` has four export paths:

| Export | Contents | Why it is separate |
|---|---|---|
| `.` | The full public API | Default import |
| `./domain` | The Domain layer, plus the Kernel pieces it uses (errors, UUIDv7) | A user's domain modules import from here, so they can't reach infrastructure by accident |
| `./testing` | Adapter conformance suites | Imports vitest (an optional peer dependency), which keeps the main entry free of runtime dependencies |
| `./async-context` | `AsyncLocalStorage` context storage (D2) | Imports `node:async_hooks`, which keeps the main entry free of `node:*` imports |

## 3. Layer by layer

Decisions D1–D12 referenced here are collected in section 6.

### 3.1 Kernel — `kernel/`

Cross-cutting building blocks. Imports nothing.

| Component | Notes | Spec |
|---|---|---|
| `FrameworkError`, four category bases, all 51 error codes | `retryable` and `httpStatus` derive from the category. `toJSON`, `toHttpResponse`, `toLogEntry`. | §22 |
| `shouldRetry(error)` | A plain `Error` counts as infrastructure, so it is retryable (D1) | §21.3, §22.1 |
| UUIDv7 | Monotonic within a millisecond. Uses `crypto.getRandomValues`, available on Node and Workers. | §2.1 |
| Backoff with jitter | `initialMs * multiplier^attempt`, capped at `maxMs`, ±10% | §11.5, §16.2, §21.3 |
| Stable hash | Gives the same result on every runtime (FNV-1a). Routes shards with `hash(shardKey) % shardCount`. | §12.1 |
| Convention lookup | `findHandler(target, prefix, eventName)`, shared by aggregates, projections and sagas | §5.2, §12.2, §13.1 |
| `Clock`, `Logger` ports | Default to `Date.now` and `console`. Tests control time for timeouts, TTL cleanup and backoff. | — |

**Tests:** every error code has the right category, HTTP status and retryability; UUIDv7 stays ordered under bursts; backoff stays within its bounds.

### 3.2 Domain — `domain/` (pure)

Everything a user's domain model extends. Imports only Kernel.

| Component | Notes | Spec |
|---|---|---|
| `DomainEvent` | Envelope fields, `serialize()`, static `rehydrate()` via `Object.create` and `defineProperty`. `eventName` can be overridden for minified builds. | §2.1 |
| `SerializedEvent` | The storage shape (`event_id`, `event_type`, …) | §2.1 |
| `Command` | Same envelope, with `timestamp`. `commandName` is used to deserialize queue messages. | §2.2, §4.3 |
| `ValueObject<T>` | Structural `equals`, a `hashCode` consistent with it, optional `compareTo`, `validate`, `with` | §2.3 |
| `AggregateId` | `generate`, `fromExisting`, `fromUuidv7`. The static factories return the subclass type. | §2.4 |
| `AggregateRoot<TId>` | `raise`/`applyEvent`, `#version`, `#uncommitted`, `committedVersion`, `loadFromHistory`, snapshot hooks, execution-context enrichment | §5 |
| `ExecutionContext` | `set`/`get`/`clear` over pluggable storage (D2) | §5.5 |

**A TypeScript caveat.** TypeScript compares classes structurally. `class AccountId extends AggregateId {}` and `class CustomerId extends AggregateId {}` are therefore interchangeable at compile time, which defeats the point of §2.4. Subclasses add a type-only brand (`declare private readonly _brand: 'AccountId'`), which emits no runtime code. The docs and the example both use this pattern.

**Decisions:** D2 (context storage), D3 (freezing events).

**Tests:** rehydration never calls the constructor; events are frozen after `raise` and `rehydrate`; `on[EventName]` dispatch, and `MissingEventHandlerError` when no handler exists; a snapshot round trip, including `#private` state through `toSnapshotState`/`restoreSnapshotState`; correlation and causation enrichment.

### 3.3 Persistence — `persistence/`

The contracts every store must satisfy, and the framework-provided wrappers on top of them. No database code.

| Component | Notes | Spec |
|---|---|---|
| Store contracts | `EventStoreAdapter`, `SnapshotStoreAdapter`, `SagaStoreAdapter`, `ProcessedEventStore`, `CommandIdempotencyStore`, `DeadLetterStore` | §3.2, §8.1, §9.1, §12.3, §14.1, §21.1 |
| `UnitOfWork` contract | `begin`, `commit`, `rollback`, `execute`, `isActive`. The transaction boundary over the stores, used by the strong pipeline. | §11.4 |
| `EventRegistry` | Maps type and version to a factory, and applies the upcaster chain on read | §3.4 |
| `EventStore` | The serialization boundary over the adapter | §3.3, §7.1 |
| Stream IDs | Per aggregate (`Type-uuid`), per category (`Type`), global (`$all`) | §3.1 |
| `Repository<T>`, `EventSourcedRepository<T>`, `StateRepository<T>` | Loading the snapshot is non-critical and falls back to a full replay. Save appends, publishes through `EventBus` (from `dispatch/bus/contracts.ts`), marks the changes committed, then maybe snapshots. | §6 |
| `CorrelationTrace` | Builds the causation tree from `loadByCorrelationId` | §28.3 |

`SagaSaveInput` and `SagaRecord` gain a `compensations` field, which G2 requires (section 4).

**Conformance suites** live in `src/testing/` and ship as `./testing`. There is one behavioural contract per store interface. Together they cover optimistic concurrency, category and `$all` streams, `loadStreamAfterEvent`, subscription cursors that only move forward, idempotent `markProcessed`, filtering in `loadTimedOut`, and TTL cleanup with `deleteOld`. They run against the in-memory adapters from M2, and against D1 in M7.

**Tests:** upcaster chains (v1.0.0 → v1.1.0 → v1.2.0); `EventSourcedRepository` with and without snapshots, including the fallback when loading a snapshot fails, and `AggregateNotFoundError`; `StateRepository` publishing events after `saveState`.

### 3.4 Handlers — `handlers/`

Application logic that reacts to commands and events. There are three sub-modules, matching the diagram's three columns.

| Sub-module | Components | Spec |
|---|---|---|
| `command/` | `CommandHandler<C, A>` with `load`, `loadOrNull`, `save`, `exists`; `CommandRegistry` (class → handler, name → class); the `CommandDispatcher` interface; `RegistryCommandDispatcher`; `NullCommandDispatcher`, used by saga rebuild | §4, §20.2 |
| `projection/` | `Projection<TDb>` (idempotent `handle`, convention dispatch, unknown events marked as processed), `ShardProjection`, `ShardManager`, rebuild hooks | §12 |
| `saga/` | `ProcessManager<TState>`, `SagaStateMachine`, `CompensationStack` (named steps, G2), `SagaEventHandler`, the `SagaTimeout` event | §13, §17, §19.2 |
| `types.ts` | `defineEvents`, `ProjectionOf`, `SagaOf`, `RequiredProjectionOf`. Type-level only. | §29.3 |

`Projection` and `SagaEventHandler` implement `EventHandler`, imported type-only from `dispatch/bus/contracts.ts` (section 2.2).

`SagaEventHandler` dispatches through the `CommandDispatcher` interface. At runtime it gets the consistency router from Dispatch, so saga commands receive the same idempotency checks and consistency routing as HTTP commands. G3 depends on this.

**Decisions:** D4 (`aggregateType` on handlers), D5 (an event reaching a completed saga).

**Tests:** one case per row of the §13.2 transition table; handler priority (`completedWhen` > `compensateWhen` > `continueWhen` > `startsWhen`); deterministic saga command IDs; G2; sharded projections handle only their own events. Tests use in-memory stores and a recording `CommandDispatcher`, with no pipelines.

### 3.5 Command Pipeline + Event Bus — `dispatch/`

Everything that moves commands and events to handlers, whether synchronously, through a queue, or pulled by cron.

| Sub-module | Components | Spec |
|---|---|---|
| `pipeline/` | `StrongConsistencyPipeline`, `EventualConsistencyPipeline`, `ConcurrencyChecker`, command idempotency (check before, mark after), `ConsistencyRouter`, `DispatchGuard` | §11, §14.1, §15, §16, §29.2 |
| `bus/` | `contracts.ts` with the `EventBus` and `EventHandler` interfaces (section 2.2); `InMemoryEventBus` (`SubscribableEventBus`, with fail-fast and collect-results modes); `QueueConsumer` over a platform-neutral `QueueMessage` port (`body`, `ack()`, `retry({ delaySeconds })`) | §10.1–10.2, §10.4–10.5 |
| `catchup/` | `SubscriptionManager`, `CronDispatcher`, `BackpressureController` | §18 |
| `failure/` | `RetryPolicy`, `DeadLetterWriter` | §21.2–21.3 |
| `timeout/` | `SagaTimeoutScheduler`, one instance per timeout setting | §19.1, §19.3 |
| `rebuild/` | `ProjectionRebuilder`, `SagaRebuilder` | §20 |

`ConsistencyRouter` implements `CommandDispatcher` and picks the pipeline for each command (§11.3). It lives here, not in Framework, so `SagaEventHandler` can use it without importing a layer to its right. `Framework.dispatch()` delegates to it.

In strong mode, the idempotency mark is written inside the unit of work, so a rollback discards it along with everything else.

**Decisions:** D6 (nested dispatch in strong mode), D7 (the eventual-mode crash window).

**Tests:** an optimistic-concurrency retry reloads the aggregate and re-executes the command; a failing handler rolls back the events, projection rows and saga state together; duplicate command IDs are skipped; G1 and G3; catch-up and rebuild produce the same read model as live dispatch; backpressure stops at its time and event budgets; timed-out sagas compensate or fail.

**Walking skeleton.** Building bottom-up means the builder doesn't exist until M6. To get end-to-end feedback earlier, M4 ends with one test that wires a pipeline, a repository and the in-memory stores by hand and runs `OpenAccount` → `AccountOpened` → projection row.

### 3.6 Platform — `platform/` and the Cloudflare package

Concrete implementations of the contracts above, selected through `Provider` (§24.1).

**Local (in core, `platform/local/`)**

- In-memory adapters for every store. They share one `InMemoryDatabase`, so `InMemoryUnitOfWork` can roll all of them back together.
- `InMemoryQueueEventBus` for eventual mode (D8).
- `LocalProvider`.
- `platform/node/`: the `AsyncLocalStorage` context storage, exported as `./async-context` (D2).

**Cloudflare (`@tarodomain/cloudflare`, `src/platform/`)**

- The D1 schema and migrations for all 10 tables, tracked in `schema_migrations`, plus the `sagas.compensations` column (§27.1–27.2, G2).
- D1 adapters for every store (§24.3).
- `TransactionalDatabase` and `D1UnitOfWork` (§11.4). The proxy collects writes only while a unit of work is active, and otherwise passes them straight to D1. So a projection can hold one `db` handle that works both in the strong pipeline and in the queue consumer. The active unit of work is kept in the same context storage as `ExecutionContext` (D2), so two concurrent requests in one isolate never share a transaction.
- `CloudflareQueueEventBus`, sending in chunks of 100 (§10.3).
- `CloudflareProvider`.

**Decisions:** D2, D8, D9.

**Tests:** every adapter passes the conformance suites. D1 runs against a D1-compatible shim over `node:sqlite`, which gives real SQLite semantics without Cloudflare tooling; a Miniflare smoke test is optional. The queue bus gets unit tests for chunking.

### 3.7 Framework — `framework/`

Assembles the layers into a running application.

| Component | Notes | Spec |
|---|---|---|
| `Token<T>`, `Container` | singleton, transient and request lifetimes; `createScope`; cycle detection | §23 |
| `TaroDomain.builder()` | `.useProvider()`, `.useLocal()`, `.consistency()`, `.snapshotEvery()`, `.aggregate()`, `.command()`, `.projection()`, `.saga()`, `.events()`, `.validation()`, `.skipValidation()`, `.build()` | §25.1 |
| Assembly | Two event buses, two repositories per aggregate and two pipelines. Repository mode (`event_sourced` or `state`) is set per aggregate. | §11.3, §15.3, §15.4 |
| `Framework` | `dispatch`, `fetchHandler`, `queueHandler`, `scheduledHandler`, `getConsistencyFor`, service accessors | §25.2 |
| `FrameworkValidator` | Runs inside `build()`. Errors throw one `InvalidConfigurationError` that lists every issue; warnings go to the `Logger`. | §29.1 |

**Decisions:** D4, D10.

**Tests:** the validator rejects each misconfiguration listed in §29.1; per-command consistency overrides route to the right pipeline; DI lifetimes and cycle detection.

### 3.8 Worker Entry Point — `entry/` and the Cloudflare package

Turns platform triggers into framework calls.

**Platform-neutral (in core)**

- The HTTP router behind `fetchHandler()` (D11). Errors become responses through `FrameworkError.toHttpResponse()`.
- Queue entry over `QueueMessage`.
- The scheduled job: cron catch-up, then saga timeouts, within the backpressure budget.
- `generatePackageJson`, `generateTsConfig` (§26.3).

**Cloudflare**

- `CloudflareWorker`, whose `export` returns `{ fetch, queue, scheduled }` and adapts `MessageBatch` to `QueueMessage` (§26.1).
- `.useCloudflare()` (D10).
- `generateCloudflareWorkerTs`, `generateWranglerToml`.

**Tests:** end to end through `fetchHandler()` in `examples/bank-account`; snapshot tests of the template output.

## 4. Saga guarantees (decided)

The spec leaves these gaps open. They are hard requirements, and each gets a dedicated test. Each one spans several layers, so the layers involved and the milestone that tests it are listed.

**G1 — No event is ever skipped because of re-entrancy** (§13.3 step 6, §11.1).
In strong mode, commands dispatched by a saga run synchronously. Their events reach the same saga *before* its state has been saved. `SagaEventHandler` queues those re-entrant events per saga instance, saves the current event's state, then processes the queue, all inside the same transaction. During that cycle it holds the saga's latest state in an in-memory, write-through cache. This is required on D1, where writes deferred by the unit of work can't be read before commit.
*Layers:* Handlers (`SagaEventHandler`), Dispatch (strong pipeline), Platform (unit of work).
*Test (M4, repeated on D1 in M7):* a three-step saga completes within a single strong-mode `dispatch()`.

**G2 — Compensations are never lost** (§13.5, §17).
The compensation stack must survive the saga being reloaded from the store, and a crash part-way through compensating. Mechanism (decided — option (a) over spec-literal closures):
`registerCompensation('refundWithdrawal', description?)` pushes a step *name*. At compensation time the framework calls `compensateRefundWithdrawal()` on the saga, which builds its commands from the **current** state. That preserves the spec's "evaluated at compensation time" semantics. The name stack is stored in the saga record, in a new `compensations` JSON column on `sagas`, so it survives reloads. Popped steps are persisted too, so a crash mid-compensation resumes without repeating finished steps. *This departs from §13.5/§17, which register closures. Replaying events to rebuild closures was rejected: it costs an event-store read per compensation, and it breaks once events fall outside retention or sit in an uncommitted D1 transaction.*
*Layers:* Handlers (`CompensationStack`, `ProcessManager`), Persistence (`compensations` on saga records), Platform (schemas).
*Test (M3):* a saga is reloaded from the store between every step, fails at step 3, and issues the compensations for steps 2 and 1 in that order. A crash during compensation resumes without repeating finished steps.

**G3 — No saga command executes twice.**
Saga state alone can't guarantee this. State is saved *after* dispatch (§13.3), so a crash between dispatch and save means the event gets reprocessed. Three layers together prevent duplicates:
1. **Deterministic command IDs.** Each command's ID is derived from `(sagaType, sagaId, event.id, index)`, so a retry regenerates identical IDs.
2. **Command idempotency** (`processed_commands`, §14.1) skips any command ID that has already been processed. This is what stops duplicates in eventual mode, where earlier commands have already committed independently.
3. **Saga state plus `processed_events`** (§13.3) stop the saga from re-handling an event once its state has been saved.

In strong mode, a failure rolls back everything in one transaction, which is a further safeguard. The narrower window between an event append and its idempotency mark is covered by D7.
*Constraints, documented and checked where possible:* saga handlers must be deterministic for a given (event, state): the same commands, in the same order, with no `Date.now()` or random values in command fields. Retries must happen within the 7-day `processed_commands` retention.
*Layers:* Handlers (command IDs), Dispatch (command idempotency).
*Test (M4):* force a failure after command 1 of 2 in eventual mode, retry, and assert that command 1 executed exactly once.

## 5. Build sequence

Milestones follow the import order, left to right. Each ends with green `pnpm typecheck && pnpm test` and a check-in with you before the next one starts. The Platform layer is delivered in slices: local stores in M2 (the layers above need them for tests), the local provider in M6, then Cloudflare in M7.

### M0 — Scaffolding ✅
pnpm 10 workspaces, TypeScript 7 (strict, `NodeNext`, ESM only), vitest 5, the `source` export condition, the spec submodule, npm publish metadata, Changesets, CI (typecheck, test and build on Node 22 and 24), a manual-only release workflow, and placeholder READMEs.

### M1 — Kernel and Domain
- Everything in sections 3.1 and 3.2.
- The architecture test (section 2.3), in place from the first layer onward.
- The `./domain` export.

**Exit:** unit tests for every primitive. The architecture test passes.

### M2 — Persistence, with local stores
- Everything in section 3.3.
- From Dispatch, ahead of the rest of that layer: `dispatch/bus/contracts.ts`, which the repositories need.
- From Platform: the in-memory store adapters, the `InMemoryDatabase` they share, and `InMemoryUnitOfWork` over it.
- Conformance suites and the `./testing` export.

**Exit:** the in-memory adapters pass every conformance suite.

### M3 — Handlers
- Everything in section 3.4.

**Exit:** the §13.2 table test passes, and so does G2.

### M4 — Dispatch, write path
- `pipeline/` and `bus/` from section 3.5.

**Exit:** the walking skeleton, G1, G3, rollback and concurrency-retry tests pass.

### M5 — Dispatch, operations
- `catchup/`, `failure/`, `timeout/` and `rebuild/` from section 3.5.

**Exit:** catch-up and rebuild produce the same read model as live dispatch. Timed-out sagas compensate or fail.

### M6 — Local provider, Framework and Entry → **v0.1 milestone**
- From Platform: `LocalProvider`, `InMemoryQueueEventBus`, `./async-context`.
- Everything in section 3.7, and the platform-neutral part of section 3.8.
- `examples/bank-account`, end to end: open, deposit, transfer with a compensating failure path, in both strong and eventual modes.

**Exit:** the example's end-to-end tests pass using only `@tarodomain/core`.

### M7 — Cloudflare (`@tarodomain/cloudflare`)
- The Cloudflare parts of sections 3.6 and 3.8.

**Exit:** the D1 adapters pass the conformance suites on the `node:sqlite` shim, G1 passes on D1, and the example runs on `CloudflareProvider` over the shim.

### M8 — Hardening and release
- API docs (TypeDoc), and replace the placeholder package READMEs with real usage guides.
- Switch the release workflow from manual to `push: main`, and publish the first versions to npm with provenance.

## 6. Open decisions

Each item has a recommendation and the milestone that needs it settled. They are ordered by layer, left to right.

| # | Layer | Topic | Issue | Recommendation | Needed by |
|---|---|---|---|---|---|
| D1 | Kernel | **Unknown (non-framework) errors** | Should `shouldRetry` treat a plain `Error` as retryable? | Yes, treat it as infrastructure. Otherwise a network blip gets dead-lettered or skipped instead of retried. | M1 |
| D2 | Domain, Platform | **ExecutionContext is module-level** (§5.5) | The spec itself notes it is unsafe under concurrent requests. | Use pluggable storage. Keep the module-level default in Domain, and offer `AsyncLocalStorage` through `./async-context` (works on Node, and on Workers with `nodejs_compat`). The same storage holds the active D1 unit of work. | M1 |
| D3 | Domain | **Freezing events** (§2.1) | Business fields are subclass constructor parameters, so they get assigned after the base constructor runs. The base class cannot freeze the event. | Mark fields `readonly` in the types, and freeze at the framework boundary (`raise`, `rehydrate`, `publish`). | M1 |
| D4 | Handlers, Framework | **`CommandHandler.aggregateType`** (§4.1) | It is an abstract *instance* property, but the builder needs it *before* constructing the handler, to choose the right repository. | Make it a `static aggregateType` on the handler class, or accept `{ aggregate }` in `.command(...)`. | M3 |
| D5 | Handlers | **Event arriving at a completed saga** (§13.1 step 1) | The spec throws `SagaAlreadyCompletedError`. In strong mode that rolls back the entire command, for example when a late event in the same correlation chain arrives. | `ProcessManager.handle` throws as specified. `SagaEventHandler` logs and skips. | M3 |
| D6 | Dispatch | **Nested dispatch in strong mode** | A saga dispatching a command starts a pipeline inside an active `UnitOfWork`. | Nested pipelines join the outer transaction, with no nested begin/commit or retry. The outer retry covers everything. | M4 |
| D7 | Dispatch | **Eventual-mode crash window** (§11.2, §14.1) | The event append and the idempotency mark are separate writes. A crash between them lets a retry re-run the command against the new state, for example depositing twice. | For v0.1, document it. After v0.1, evaluate writing the mark in the same atomic write as the append (the same D1 batch), which needs an optional extra-writes parameter on `appendToStream`. | M4 |
| D8 | Platform | **Eventual mode under `LocalProvider`** (§24.2) | The spec lists `InMemoryEventBus`, but a plain bus with no subscribers would never deliver events to projections. | An in-memory queue drained by the framework's own `queueHandler()`: automatic by default, manual `drain()` in tests. | M6 |
| D9 | Platform | **D1 strong-mode reads inside a transaction** (§11.4) | `TransactionalDatabase` defers writes, so reads in the same transaction don't see them. Example: a saga touching the same aggregate twice in one synchronous chain. | Document it as a limitation. G1 removes the saga case. Two writes to one aggregate in one strong chain fail on commit with a concurrency error. | M7 |
| D10 | Framework, Entry | **`.useCloudflare()` on the builder** (§25.1) | `@tarodomain/core` can't import the provider packages. | Core keeps `.useProvider(p)` and `.useLocal()`. `@tarodomain/cloudflare` registers `.useCloudflare()` through TypeScript module augmentation when imported. A future AWS package would add `.useAws()` the same way. | M7 |
| D11 | Entry | **HTTP wire format** (§26.1) | Not specified. `POST /migrate` is also unauthenticated in the spec. | `POST /commands/{CommandType}` with the business fields as a JSON body. `x-request-id` becomes the correlation ID and `x-command-id` the idempotency key. `POST /migrate` stays disabled unless the app configures a migration secret, sent as a bearer token. | M6 |
| D12 | Release | **npm scope** | Is `@tarodomain` available, and owned by you? The packages publish under it. | Create the `tarodomain` npm organization, or pick another scope, before M8. | M8 |

## 7. Testing and conventions

**Testing**

- **Unit tests:** in `packages/*/test`, mirroring the layer directories (`test/domain/`, `test/handlers/`, …).
- **Architecture test:** enforces the import rule (section 2.3).
- **Conformance suites:** one behavioural contract per store interface, shipped from `@tarodomain/core/testing` and run against in-memory and D1 (section 3.3). They guarantee that providers behave identically.
- **End-to-end tests:** `examples/bank-account/test` exercises the whole framework through `Framework.dispatch()` and `fetchHandler()`.
- **Spec traceability:** test names cite the § they cover, for example `describe('§13.2 SagaStateMachine')`.

**Conventions**

- ESM only, `.js` extensions in relative imports (`NodeNext`), no default exports.
- No decorators, no runtime reflection libraries. Dispatch works through method-name conventions, as the spec requires.
- Zero runtime dependencies in `@tarodomain/core`. Provider packages depend only on their platform SDKs.
- The public API is re-exported from each package's `src/index.ts`. Internal helpers start with `_` or stay unexported.

## 8. Publishing

Every package under `packages/` (except the spec submodule) is published to npm on its own, with its own version. `examples/` are private.

- **Core is a peer dependency of providers.** `@tarodomain/cloudflare` declares `@tarodomain/core` in `peerDependencies`, not `dependencies`. An app must have exactly one copy of core, because `instanceof FrameworkError`, the `EventRegistry` and the provider registration (D10) all break if two copies get installed. Within the workspace, core is also a `devDependency` (`workspace:*`).
- **Workspace ranges are rewritten on publish.** `workspace:^` becomes a real caret range (e.g. `^0.3.0`) in the published manifest.
- **The `source` export condition is dev-only.** `publishConfig.exports` replaces `exports` at publish time, so consumers only ever resolve `dist/`. Each subpath export (`./domain`, `./testing`, `./async-context`) needs an entry in both.
- **vitest is an optional peer dependency of core**, needed only by `./testing`.
- **Published files:** `dist/` (JS, `.d.ts`, source maps) and `src/` (so source maps and go-to-definition work), plus `LICENSE`.
- **Versioning:** semver per package. While on `0.x`, a breaking change in core requires a minor bump of core *and* a bump of each provider's peer range. Changesets handles this automatically.
