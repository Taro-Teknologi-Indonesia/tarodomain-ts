import { InvalidAggregateStateError, MissingEventHandlerError } from '../kernel/errors.js';
import { findHandler } from '../kernel/conventions.js';
import type { AggregateId } from './aggregate-id.js';
import { type DomainEvent, freezeEvent, withExecutionContext } from './domain-event.js';
import { ExecutionContext, type ExecutionContextValue, validateExecutionContext } from './execution-context.js';
import { ownStatic, toJsonData } from './message.js';

/** An aggregate's business state at a version, from `toSnapshot()` (§5.4). JSON-safe. */
export interface AggregateSnapshot {
  readonly data: Record<string, unknown>;
  readonly version: number;
}

/** A concrete aggregate class. The framework constructs it with only an ID (§5.3). */
export type AggregateClass<A extends AggregateRoot = AggregateRoot> = (abstract new (id: never) => A) & {
  readonly aggregateName?: string;
};

/** Where `toSnapshot()` puts the state returned by `toSnapshotState()`. */
export const PRIVATE_SNAPSHOT_KEY = '#private';

/** The aggregate type name used in stream IDs: the class's own static `aggregateName`, or else the class name. */
export function aggregateNameOf(aggregateClass: AggregateClass): string {
  const name = ownStatic(aggregateClass, 'aggregateName');
  return typeof name === 'string' ? name : aggregateClass.name;
}

/**
 * The entry point to an aggregate, and the only object that raises domain events (§5).
 *
 * - The constructor takes only the ID and must not raise events: rehydration reuses it.
 *   Static factories such as `BankAccount.open(id, owner)` create instances and raise.
 * - State changes happen in `on[EventName]` methods, which `raise()` and replay both call.
 * - Snapshots hold every own enumerable field except `id`. Override `toSnapshotState()` and
 *   `restoreSnapshotState()` for `#private` fields. Snapshot data goes through JSON, so use
 *   those hooks for fields JSON can't carry, such as dates and value objects.
 */
export abstract class AggregateRoot<TId extends AggregateId = AggregateId> {
  declare static readonly aggregateName?: string;

  readonly id: TId;
  #version = 0;
  #uncommitted: DomainEvent[] = [];
  #context: ExecutionContextValue | null = null;

  constructor(id: TId) {
    this.id = id;
  }

  /** The number of events applied, including uncommitted ones. */
  get version(): number {
    return this.#version;
  }

  /** The version in the store: what the next append expects (§7.3). */
  get committedVersion(): number {
    return this.#version - this.#uncommitted.length;
  }

  get hasUncommittedChanges(): boolean {
    return this.#uncommitted.length > 0;
  }

  /**
   * Applies `event` and queues it for persistence (§5.2). When an execution context is set, on
   * this instance or ambiently, the queued event carries its correlation and causation IDs.
   */
  protected raise(event: DomainEvent): void {
    const context = this.#context ?? ExecutionContext.get();
    const enriched = freezeEvent(context === null ? event : withExecutionContext(event, context));
    this.applyEvent(enriched);
    this.#uncommitted.push(enriched);
  }

  /** Calls `on[EventName]`, or `onUnknownEvent()` when there is none, then increments the version. */
  protected applyEvent(event: DomainEvent): void {
    const handler = findHandler(this, 'on', event.eventName);
    if (handler === undefined) this.onUnknownEvent(event);
    else handler(event);
    this.#version++;
  }

  /** Called for an event without an `on[EventName]` method. Throws `MissingEventHandlerError` by default. */
  protected onUnknownEvent(event: DomainEvent): void {
    throw new MissingEventHandlerError(`${this.constructor.name} has no handler on${event.eventName}()`, {
      context: { aggregate: this.constructor.name, eventName: event.eventName },
    });
  }

  /** Replays stored events. Nothing is queued. `snapshotVersion` is the version the events follow. */
  loadFromHistory(events: readonly DomainEvent[], snapshotVersion?: number): void {
    if (this.#uncommitted.length > 0) {
      throw new InvalidAggregateStateError(
        `${this.constructor.name} has uncommitted changes and cannot load history`,
        { context: { aggregate: this.constructor.name, uncommitted: this.#uncommitted.length } },
      );
    }
    if (snapshotVersion !== undefined) this.#version = requireVersion(snapshotVersion);
    for (const event of events) this.applyEvent(freezeEvent(event));
  }

  getUncommittedChanges(): DomainEvent[] {
    return [...this.#uncommitted];
  }

  markChangesAsCommitted(): void {
    this.#uncommitted = [];
  }

  toSnapshot(): AggregateSnapshot {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this)) {
      if (key !== 'id') fields[key] = value;
    }
    const privateState = this.toSnapshotState();
    if (privateState !== undefined) fields[PRIVATE_SNAPSHOT_KEY] = privateState;
    return { data: toJsonData(fields, `Snapshot of ${this.constructor.name}`), version: this.#version };
  }

  restoreSnapshot(data: Readonly<Record<string, unknown>>, version: number): void {
    const { [PRIVATE_SNAPSHOT_KEY]: privateState, id: _id, ...fields } = data;
    Object.assign(this, fields);
    if (privateState !== undefined) this.restoreSnapshotState(privateState);
    this.#version = requireVersion(version);
    this.#uncommitted = [];
  }

  /** State for `#private` fields, stored with the snapshot. `undefined` stores nothing. */
  protected toSnapshotState(): unknown {
    return undefined;
  }

  /** Restores what `toSnapshotState()` returned. */
  protected restoreSnapshotState(_state: unknown): void {}

  /** @internal Set by the repository on load, so raised events carry the command's IDs. */
  _setExecutionContext(context: ExecutionContextValue): void {
    this.#context = validateExecutionContext(context);
  }

  /** @internal Cleared by the repository after save. */
  _clearExecutionContext(): void {
    this.#context = null;
  }
}

function requireVersion(version: number): number {
  if (!Number.isInteger(version) || version < 0) {
    throw new InvalidAggregateStateError(`Aggregate version must be a non-negative integer, got ${version}`, {
      context: { version },
    });
  }
  return version;
}
