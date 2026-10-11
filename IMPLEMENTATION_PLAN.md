# TaroDomain TypeScript — Implementation Plan

Source of truth: [`packages/tarodomain-spec/README.md`](packages/tarodomain-spec/README.md), the TaroDomain Design Specification v1.0, pinned at commit `983d2cb`. Section numbers (§) below refer to that document.

## 1. Goals

- Implement the full spec in TypeScript as a set of npm packages under the `@tarodomain` scope.
- Keep the core platform-agnostic. Cloudflare and AWS live in separate provider packages (§1.1, §24).
- Follow the spec's style: OOP with method-name conventions (`on[Event]`, `startsWhen[Event]`, …), no decorators (§1.1).
- Make every adapter swappable and verify each one against the same shared conformance test suite.
- Get a version running fully locally (in-memory) before any cloud provider.

**Non-goals for v0.1:** a CLI or project generator beyond the template functions in §26.3, adapters for other databases (Postgres and so on), and performance tuning beyond what the spec describes.

## 2. Repository layout

```
tarodomain-ts/
├── packages/
│   ├── core/             @tarodomain/core        — everything platform-agnostic + in-memory + LocalProvider
│   ├── cloudflare/       @tarodomain/cloudflare  — D1, Queues, CloudflareWorker
│   ├── aws/              @tarodomain/aws         — DynamoDB, SQS, AwsLambda
│   └── tarodomain-spec/  (git submodule)         — the design spec, not a workspace package
├── examples/
│   └── bank-account/     reference app: BankAccount aggregate, TransferSaga, BalanceProjection
├── IMPLEMENTATION_PLAN.md
└── package.json / pnpm-workspace.yaml / tsconfig.base.json / vitest.config.ts
```

**Tooling (already set up):** pnpm 10 workspaces, TypeScript 7 (strict, `NodeNext`, ESM only) and vitest 5. Each package exports a `source` condition, so tests and typechecking run against `src/` with no build step. `pnpm build` emits `dist/` in dependency order.

### 2.1 Planned module structure of `@tarodomain/core`

| Module | Contents | Spec |
|---|---|---|
| `errors/` | `FrameworkError`, four category bases, all 51 error codes, `shouldRetry()` | §22 |
| `util/` | UUIDv7 (monotonic), backoff/jitter, stable hashing | §2.1, §16.2 |
| `domain/` | `DomainEvent`, `Command`, `ValueObject`, `AggregateId`, `ExecutionContext` | §2, §5.5 |
| `events/` | `EventRegistry`, upcasters, `EventStore` wrapper, `EventStoreAdapter` contract | §3, §7 |
| `aggregate/` | `AggregateRoot` | §5 |
| `repository/` | `Repository`, `EventSourcedRepository`, `StateRepository`, `SnapshotStoreAdapter` contract | §6, §8 |
| `commands/` | `CommandHandler`, `CommandRegistry`, `CommandDispatcher` | §4 |
| `bus/` | `EventBus`, `EventHandler`, `InMemoryEventBus`, queue-consumer logic | §10 |
| `pipeline/` | `StrongConsistencyPipeline`, `EventualConsistencyPipeline`, `UnitOfWork`, `ConcurrencyChecker` | §11, §15, §16 |
| `idempotency/` | `CommandIdempotencyStore`, `ProcessedEventStore` contracts | §12.3, §14 |
| `projection/` | `Projection`, `ShardProjection`, `ShardManager` | §12 |
| `saga/` | `ProcessManager`, `SagaStateMachine`, `CompensationStack`, `SagaEventHandler`, `SagaStoreAdapter`, `SagaTimeout`, `SagaTimeoutScheduler` | §9, §13, §17, §19 |
| `subscription/` | `SubscriptionManager`, `CronDispatcher`, `BackpressureController` | §18 |
| `rebuild/` | `ProjectionRebuilder`, `SagaRebuilder` | §20 |
| `dlq/` | `DeadLetterStore` contract, `DeadLetterWriter`, `RetryPolicy` | §21 |
| `di/` | `Token<T>`, `Container` (singleton/transient/request, cycle detection) | §23 |
| `provider/` | `Provider` interface | §24.1 |
| `memory/` | In-memory implementations of every adapter, `InMemoryUnitOfWork`, `LocalProvider` | §24.2 |
| `builder/` | `DddFramework.builder()`, `Framework` | §25 |
| `validation/` | `FrameworkValidator`, `DispatchGuard`, type helpers (`defineEvents`, `ProjectionOf`, …) | §29 |
| `tracing/` | `CorrelationTrace` | §28.3 |
| `testing/` (subpath export) | Adapter conformance suites that provider packages reuse | — |

## 3. Phases

Each phase ends with green `pnpm typecheck && pnpm test` and a check-in with you before the next phase starts.

### Phase 0 — Scaffolding ✅
Workspace, package skeletons, build/typecheck/test tooling, spec submodule. Also done: npm publish metadata (§8), Changesets (independent versioning), the CI workflow (typecheck/test/build on Node 22 and 24), a manual-only release workflow, and placeholder READMEs for each package.

### Phase 1 — Domain foundations (core)
- Error hierarchy (§22), UUIDv7, `DomainEvent` (+ `serialize`, `rehydrate`), `Command`, `ValueObject`, `AggregateId` (§2)
- `EventRegistry` with the upcaster chain (§3.4)
- `AggregateRoot`: `raise`/`applyEvent`, uncommitted buffer, versioning, snapshots, execution-context enrichment (§5)
- DI `Container` (§23)

**Exit:** unit tests for every primitive, including upcaster chains, rehydration without calling constructors, and immutability.

### Phase 2 — Persistence contracts and in-memory adapters (core)
- Adapter interfaces: event store, snapshot, saga, processed events, command idempotency, dead letters
- In-memory implementations for all of them, sharing one `InMemoryDatabase` so that `InMemoryUnitOfWork` can roll back
- `EventStore` wrapper (§3.3, §7), `EventSourcedRepository` and `StateRepository` base (§6)
- **Conformance test suites** in `@tarodomain/core/testing`, written against the interfaces and run against the in-memory adapters now, D1 and DynamoDB later

**Exit:** the in-memory adapters pass every conformance suite. Optimistic concurrency, category and `$all` streams, and subscription cursors are covered.

### Phase 3 — Command side (core)
- `CommandHandler`, `CommandRegistry`, `CommandDispatcher` (§4)
- `InMemoryEventBus` with fail-fast and collect-results modes (§10.4)
- `ConcurrencyChecker` (§11.5, §16), `UnitOfWork` (§11.4)
- `StrongConsistencyPipeline` and `EventualConsistencyPipeline` with command idempotency (§11, §14.1)

**Exit:** concurrent-modification retry, rollback on handler failure and duplicate-command tests.

### Phase 4 — Read side and process managers (core)
- `Projection`, `ShardProjection`, `ShardManager` (§12)
- `ProcessManager`, `SagaStateMachine`, `CompensationStack`, `SagaEventHandler` (§13, §17)

**Exit:** a state-machine transition table test covering every row of §13.2, correlation/causation propagation across a saga chain (§28.2), and the tests for saga guarantees G1–G3 (section 4).

### Phase 5 — Operational components (core)
- `SubscriptionManager`, `CronDispatcher`, `BackpressureController` (§18)
- `SagaTimeout`, `SagaTimeoutScheduler` (§19)
- `ProjectionRebuilder`, `SagaRebuilder` (§20)
- `RetryPolicy`, `DeadLetterWriter` (§21), `CorrelationTrace` (§28.3)

**Exit:** catch-up and rebuild produce the same read model as live dispatch. Timed-out sagas compensate or fail.

### Phase 6 — Framework assembly and local runtime (core + example) → **v0.1 milestone**
- `Provider` interface and `LocalProvider` (§24)
- `DddFramework.builder()` and `Framework`: `dispatch`, `fetchHandler`, `queueHandler`, `scheduledHandler` (§25)
- Startup validation, runtime `DispatchGuard`, type-level helpers (§29)
- `examples/bank-account`, end to end: open, deposit, transfer with a compensating failure path, in both strong and eventual modes

**Exit:** the example's end-to-end tests pass using only `@tarodomain/core`.

### Phase 7 — Cloudflare provider (`@tarodomain/cloudflare`)
- D1 schema and migrations for all 10 tables, with `schema_migrations` (§27.1–27.2)
- D1 adapters for every store (§24.3)
- `TransactionalDatabase` and `D1UnitOfWork` (§11.4), `CloudflareQueueEventBus` with chunks of 100 (§10.3)
- `CloudflareProvider`, `CloudflareWorker` (`fetch` / `queue` / `scheduled`, `GET /health`, `POST /migrate`) (§26.1)
- Template generators: `generateCloudflareWorkerTs`, `generateWranglerToml` (§26.3)

**Testing:** run the conformance suites against a D1-compatible shim over `node:sqlite`, so real SQLite semantics apply without Cloudflare tooling. Optionally, add a smoke test under Miniflare/`wrangler dev`.

### Phase 8 — AWS provider (`@tarodomain/aws`)
- DynamoDB table and GSI definitions (§27.3), DynamoDB adapters (§24.4), including the 25-item transaction split (§7.2)
- `SqsEventBus` with chunks of 10 and FIFO `MessageGroupId` support (§10.3)
- `AwsProvider`, `AwsLambda` (§26.2), `generateAwsLambdaTs`, `generateAwsSamTemplate` (§26.3)

**Testing:** run the conformance suites against DynamoDB Local in Docker, skipped automatically when it isn't running. Unit tests cover SQS chunking.

### Phase 9 — Hardening and release
- CI: add a DynamoDB Local service container for the AWS conformance suite
- API docs (TypeDoc), and replace the placeholder package READMEs with real usage guides
- Switch the release workflow from manual to `push: main`, and publish the first versions to npm with provenance

## 4. Saga guarantees (decided)

The spec leaves these gaps open. They are now hard requirements, and each one gets a dedicated test in Phase 4.

**G1 — No event is ever skipped because of re-entrancy** (§13.3 step 6, §11.1).
In strong mode, commands dispatched by a saga run synchronously. Their events reach the same saga *before* its state has been saved. `SagaEventHandler` queues those re-entrant events per saga instance, saves the current event's state, then processes the queue, all inside the same transaction. During that cycle it holds the saga's latest state in an in-memory, write-through cache. This is required on D1, where writes deferred by the unit of work can't be read before commit.
*Test:* a three-step saga completes within a single strong-mode `dispatch()` on both the in-memory and D1 providers.

**G2 — Compensations are never lost** (§13.5, §17).
The compensation stack must survive the saga being reloaded from the store, and a crash part-way through compensating. Mechanism (decided — option (a) over spec-literal closures):
`registerCompensation('refundWithdrawal', description?)` pushes a step *name*. At compensation time the framework calls `compensateRefundWithdrawal()` on the saga, which builds its commands from the **current** state. That preserves the spec's "evaluated at compensation time" semantics. The name stack is stored in the saga record, in a new `compensations` JSON column on `sagas` (D1) and a `compensations` attribute (DynamoDB), so it survives reloads. Popped steps are persisted too, so a crash mid-compensation resumes without repeating finished steps. *This departs from §13.5/§17, which register closures; replaying events to rebuild closures was rejected because it costs an event-store read per compensation and breaks once events fall outside retention or sit in an uncommitted D1 transaction.*
*Test:* a saga is reloaded from the store between every step, fails at step 3, and issues the compensations for steps 2 and 1 in that order. A crash during compensation resumes without repeating finished steps.

**G3 — No saga command executes twice.**
Saga state alone can't guarantee this. State is saved *after* dispatch (§13.3), so a crash between dispatch and save means the event gets reprocessed. Three layers together prevent duplicates:
1. **Deterministic command IDs.** Each command's ID is derived from `(sagaType, sagaId, event.id, index)`, so a retry regenerates identical IDs.
2. **Command idempotency** (`processed_commands`, §14.1) skips any command ID that has already been processed. This is what stops duplicates in eventual mode, where earlier commands have already committed independently.
3. **Saga state plus `processed_events`** (§13.3) stop the saga from re-handling an event once its state has been saved.

In strong mode, a failure rolls back everything in one transaction, which is a further safeguard.
*Constraints, documented and checked where possible:* saga handlers must be deterministic for a given (event, state): the same commands, in the same order, with no `Date.now()` or random values in command fields. Retries must happen within the 7-day `processed_commands` retention.
*Test:* force a failure after command 1 of 2 in eventual mode, retry, and assert that command 1 executed exactly once.

## 5. Open decisions

Each item has a recommendation. Phase 1 needs only items 4 and 5, so the rest can be settled before Phase 3.

| # | Topic | Issue | Recommendation |
|---|---|---|---|
| 4 | **ExecutionContext is module-level** (§5.5) | The spec itself notes it is unsafe under concurrent requests. | Use pluggable storage. Keep the module-level default, and offer `AsyncLocalStorage` (works on Node and on Workers with `nodejs_compat`). |
| 5 | **Freezing events** (§2.1) | Business fields are subclass constructor parameters, so they get assigned after the base constructor runs. The base class cannot freeze the event. | Mark fields `readonly` in the types, and freeze at the framework boundary (`raise`, `rehydrate`, `publish`). |
| 6 | **`CommandHandler.aggregateType`** (§4.1) | It is an abstract *instance* property, but the builder needs it *before* constructing the handler, to choose the right repository. | Make it a `static aggregateType` on the handler class, or accept `{ aggregate }` in `.command(...)`. |
| 7 | **`.useCloudflare()` / `.useAws()` on the builder** (§25.1) | `@tarodomain/core` can't import the provider packages. | Core keeps `.useProvider(p)` and `.useLocal()`. Provider packages register `.useCloudflare()` / `.useAws()` through TypeScript module augmentation when imported. |
| 8 | **Eventual mode under `LocalProvider`** (§24.2) | The spec lists `InMemoryEventBus`, but a plain bus with no subscribers would never deliver events to projections. | An in-memory queue drained by the framework's own `queueHandler()`: automatic by default, manual `drain()` in tests. |
| 9 | **D1 strong mode reads inside a transaction** (§11.4) | `TransactionalDatabase` defers writes, so reads in the same transaction don't see them. Example: a saga touching the same aggregate twice in one synchronous chain. | Document it as a limitation. Item 1 removes the saga case. Two writes to one aggregate in one strong chain fail on commit with a concurrency error. |
| 10 | **Nested dispatch in strong mode** | A saga dispatching a command starts a pipeline inside an active `UnitOfWork`. | Nested pipelines join the outer transaction, with no nested begin/commit or retry. The outer retry covers everything. |
| 11 | **Unknown (non-framework) errors** | Should `shouldRetry` treat a plain `Error` as retryable? | Yes, treat it as infrastructure. Otherwise a network blip gets dead-lettered or skipped instead of retried. |
| 12 | **Event arriving at a completed saga** (§13.1 step 1) | The spec throws `SagaAlreadyCompletedError`. In strong mode that rolls back the entire command, for example when a late event in the same correlation chain arrives. | `ProcessManager.handle` throws as specified. `SagaEventHandler` logs and skips. |
| 13 | **HTTP wire format** (§26.1) | Not specified. | `POST /commands/{CommandType}` with the business fields as a JSON body. `x-request-id` becomes the correlation ID and `x-command-id` the idempotency key. |
| 14 | **npm scope** | Is `@tarodomain` available, and owned by you? The packages publish under it. | Create the `tarodomain` npm organization, or pick another scope, before Phase 9. |

## 6. Testing strategy

- **Unit tests:** next to each package, under `packages/*/test`.
- **Conformance suites:** one behavioural contract per adapter interface, shipped from `@tarodomain/core/testing` and run against in-memory, D1 and DynamoDB. They guarantee that providers behave identically.
- **End-to-end tests:** `examples/bank-account/test` exercises the whole framework through `Framework.dispatch()` and `fetchHandler()`.
- **Spec traceability:** test files name the § they cover, for example `describe('§13.2 SagaStateMachine')`.

## 7. Conventions

- ESM only, `.js` extensions in relative imports (`NodeNext`), no default exports.
- No decorators, no runtime reflection libraries. Dispatch works through method-name conventions, as the spec requires.
- Zero runtime dependencies in `@tarodomain/core`. Provider packages depend only on their platform SDKs.

## 8. Publishing

Every package under `packages/` (except the spec submodule) is published to npm on its own, with its own version. `examples/` are private.

- **Core is a peer dependency of providers.** `@tarodomain/cloudflare` and `@tarodomain/aws` declare `@tarodomain/core` in `peerDependencies`, not `dependencies`. An app must have exactly one copy of core, because `instanceof FrameworkError`, the `EventRegistry` and the provider registration (item 7) all break if two copies get installed. Within the workspace, core is also a `devDependency` (`workspace:*`).
- **Workspace ranges are rewritten on publish.** `workspace:^` becomes a real caret range (e.g. `^0.3.0`) in the published manifest.
- **The `source` export condition is dev-only.** `publishConfig.exports` replaces `exports` at publish time, so consumers only ever resolve `dist/`.
- **Published files:** `dist/` (JS, `.d.ts`, source maps) and `src/` (so source maps and go-to-definition work), plus `LICENSE`.
- **Versioning:** semver per package. While on `0.x`, a breaking change in core requires a minor bump of core *and* a bump of each provider's peer range. Changesets handles this automatically.
- Public API is re-exported from each package's `src/index.ts`. Internal helpers start with `_` or stay unexported.
