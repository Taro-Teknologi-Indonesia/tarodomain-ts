import {
  InvalidCausationIdError,
  InvalidCorrelationIdError,
  InvalidEventIdError,
  SerializationError,
} from '../kernel/errors.js';
import { uuidv7 } from '../kernel/uuid.js';
import type { ExecutionContextValue } from './execution-context.js';
import {
  businessFields,
  cloneMessage,
  deepFreeze,
  freezeMetadata,
  type Metadata,
  ownStatic,
  rehydrateMessage,
  requireUuid,
  toJsonData,
} from './message.js';
import type { SerializedEvent } from './serialized-event.js';

/** Optional envelope values for a new event. Anything left out gets its default (§2.1). */
export interface EventInit {
  readonly id?: string;
  readonly correlationId?: string;
  readonly causationId?: string | null;
  readonly metadata?: Metadata;
  readonly occurredAt?: Date;
}

/** The complete envelope of an event, as stored. */
export interface EventEnvelope {
  readonly id: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Metadata;
  readonly occurredAt: Date;
}

/** A concrete event class. Its static `eventName` and `eventVersion` are optional. */
export type EventClass<E extends DomainEvent = DomainEvent> = (abstract new (...args: never[]) => E) & {
  readonly eventName?: string;
  readonly eventVersion?: string;
};

export const DEFAULT_EVENT_VERSION = '1.0.0';

const ENVELOPE_KEYS: ReadonlySet<string> = new Set(['id', 'correlationId', 'causationId', 'metadata', 'occurredAt']);

/** The event type name: the class's own static `eventName`, or else the class name. */
export function eventNameOf(eventClass: EventClass): string {
  const name = ownStatic(eventClass, 'eventName');
  return typeof name === 'string' ? name : eventClass.name;
}

/** The schema version: the class's own static `eventVersion`, or else `1.0.0`. */
export function eventVersionOf(eventClass: EventClass): string {
  const version = ownStatic(eventClass, 'eventVersion');
  return typeof version === 'string' ? version : DEFAULT_EVENT_VERSION;
}

/**
 * An immutable record of something that happened in the domain (§2.1).
 *
 * Subclasses declare their business fields as constructor parameters and pass an optional
 * {@link EventInit} last:
 *
 * ```ts
 * class MoneyDeposited extends DomainEvent {
 *   constructor(readonly accountId: string, readonly amount: number, init?: EventInit) {
 *     super(init);
 *   }
 * }
 * ```
 *
 * The type name defaults to the class name. Set `static override readonly eventName` when
 * builds are minified, and `static override readonly eventVersion` when the schema changes.
 *
 * Events are frozen once they cross a framework boundary (`raise`, `rehydrate`, `publish`).
 * The base constructor can't freeze them, because subclass fields are assigned after it runs (D3).
 */
export abstract class DomainEvent {
  declare static readonly eventName?: string;
  declare static readonly eventVersion?: string;

  readonly id: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Metadata;
  readonly occurredAt: Date;

  constructor(init: EventInit = {}) {
    this.id = init.id === undefined ? uuidv7() : requireUuid(init.id, 'id', InvalidEventIdError);
    this.correlationId =
      init.correlationId === undefined
        ? uuidv7()
        : requireUuid(init.correlationId, 'correlationId', InvalidCorrelationIdError);
    this.causationId =
      init.causationId == null ? null : requireUuid(init.causationId, 'causationId', InvalidCausationIdError);
    this.metadata = freezeMetadata(init.metadata);
    this.occurredAt = init.occurredAt ?? new Date();
  }

  get eventName(): string {
    return eventNameOf(this.constructor as EventClass);
  }

  get eventVersion(): string {
    return eventVersionOf(this.constructor as EventClass);
  }

  serialize(): SerializedEvent {
    return {
      event_id: this.id,
      event_type: this.eventName,
      event_version: this.eventVersion,
      causation_id: this.causationId,
      correlation_id: this.correlationId,
      data: toJsonData(businessFields(this, ENVELOPE_KEYS), `Event ${this.eventName}`),
      metadata: { ...this.metadata },
      occurred_at: this.occurredAt.toISOString(),
    };
  }

  /**
   * Builds an event of this class from stored data without calling its constructor (§2.1).
   * The envelope is validated and the result is frozen.
   */
  static rehydrate<E extends DomainEvent>(
    this: EventClass<E>,
    data: Readonly<Record<string, unknown>>,
    envelope: EventEnvelope,
  ): E {
    if ((this as unknown) === DomainEvent) {
      throw new SerializationError('Call rehydrate() on a concrete event class, not on DomainEvent');
    }
    return rehydrateMessage(this.prototype, validateEnvelope(envelope), data, ENVELOPE_KEYS, `Event ${eventNameOf(this)}`);
  }
}

/** The envelope of a stored event. */
export function envelopeFromSerialized(serialized: SerializedEvent): EventEnvelope {
  const occurredAt = new Date(serialized.occurred_at);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new SerializationError(`Event ${serialized.event_id} has an invalid occurred_at`, {
      context: { eventId: serialized.event_id, occurredAt: serialized.occurred_at },
    });
  }
  return {
    id: serialized.event_id,
    correlationId: serialized.correlation_id,
    causationId: serialized.causation_id,
    metadata: serialized.metadata,
    occurredAt,
  };
}

/** Freezes an event and everything it holds (D3). */
export function freezeEvent<E extends DomainEvent>(event: E): E {
  return deepFreeze(event);
}

/** A copy of `event` that carries the context's correlation and causation IDs (§5.2 step 1). */
export function withExecutionContext<E extends DomainEvent>(event: E, context: ExecutionContextValue): E {
  if (event.correlationId === context.correlationId && event.causationId === context.causationId) return event;
  return cloneMessage(event, { correlationId: context.correlationId, causationId: context.causationId });
}

function validateEnvelope(envelope: EventEnvelope): EventEnvelope {
  return {
    id: requireUuid(envelope.id, 'id', InvalidEventIdError),
    correlationId: requireUuid(envelope.correlationId, 'correlationId', InvalidCorrelationIdError),
    causationId:
      envelope.causationId === null
        ? null
        : requireUuid(envelope.causationId, 'causationId', InvalidCausationIdError),
    metadata: freezeMetadata(envelope.metadata),
    occurredAt: new Date(envelope.occurredAt.getTime()),
  };
}
