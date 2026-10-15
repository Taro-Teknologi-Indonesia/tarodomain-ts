import { describe, expect, it } from 'vitest';
import { AggregateId } from '../../src/domain/aggregate-id.js';
import {
  DomainEvent,
  envelopeFromSerialized,
  type EventInit,
  eventNameOf,
  eventVersionOf,
  freezeEvent,
  withExecutionContext,
} from '../../src/domain/domain-event.js';
import {
  InvalidCausationIdError,
  InvalidCorrelationIdError,
  InvalidEventIdError,
  SerializationError,
} from '../../src/kernel/errors.js';
import { isUuidv7, uuidv7 } from '../../src/kernel/uuid.js';

class MoneyDeposited extends DomainEvent {
  constructor(
    readonly accountId: string,
    readonly amount: number,
    init?: EventInit,
  ) {
    super(init);
  }
}

class Minified extends DomainEvent {
  static override readonly eventName = 'AccountClosed';
  static override readonly eventVersion = '1.2.0';
  constructor(readonly reason: string, init?: EventInit) {
    super(init);
  }
}

class Inheriting extends Minified {}

let constructions = 0;
class Counted extends DomainEvent {
  constructor(readonly value: number, init?: EventInit) {
    super(init);
    constructions++;
  }
}

describe('§2.1 DomainEvent', () => {
  it('fills the envelope with defaults', () => {
    const before = Date.now();
    const event = new MoneyDeposited('acc-1', 100);
    expect(isUuidv7(event.id)).toBe(true);
    expect(isUuidv7(event.correlationId)).toBe(true);
    expect(event.correlationId).not.toBe(event.id);
    expect(event.causationId).toBeNull();
    expect(event.metadata).toEqual({});
    expect(Object.isFrozen(event.metadata)).toBe(true);
    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(event.accountId).toBe('acc-1');
    expect(event.amount).toBe(100);
  });

  it('takes envelope values from init', () => {
    const init = {
      id: uuidv7(),
      correlationId: uuidv7(),
      causationId: uuidv7(),
      metadata: { userId: 'u-1' },
      occurredAt: new Date('2026-01-01T00:00:00Z'),
    };
    const event = new MoneyDeposited('acc-1', 100, init);
    expect(event).toMatchObject(init);
    expect(event.metadata).not.toBe(init.metadata);
  });

  it('validates IDs passed in init', () => {
    expect(() => new MoneyDeposited('a', 1, { id: 'nope' })).toThrow(InvalidEventIdError);
    expect(() => new MoneyDeposited('a', 1, { correlationId: 'nope' })).toThrow(InvalidCorrelationIdError);
    expect(() => new MoneyDeposited('a', 1, { causationId: 'nope' })).toThrow(InvalidCausationIdError);
  });

  it('names the event after its class unless the class overrides it', () => {
    expect(new MoneyDeposited('a', 1).eventName).toBe('MoneyDeposited');
    expect(new MoneyDeposited('a', 1).eventVersion).toBe('1.0.0');
    expect(new Minified('x').eventName).toBe('AccountClosed');
    expect(new Minified('x').eventVersion).toBe('1.2.0');
    expect(eventNameOf(Minified)).toBe('AccountClosed');
    expect(eventVersionOf(Minified)).toBe('1.2.0');
  });

  it('does not inherit a parent event class’s name or version', () => {
    expect(new Inheriting('x').eventName).toBe('Inheriting');
    expect(new Inheriting('x').eventVersion).toBe('1.0.0');
  });

  it('serialises to the storage shape', () => {
    const event = new MoneyDeposited('acc-1', 100, {
      causationId: uuidv7(),
      metadata: { userId: 'u-1' },
      occurredAt: new Date('2026-03-04T05:06:07.089Z'),
    });
    expect(event.serialize()).toEqual({
      event_id: event.id,
      event_type: 'MoneyDeposited',
      event_version: '1.0.0',
      causation_id: event.causationId,
      correlation_id: event.correlationId,
      data: { accountId: 'acc-1', amount: 100 },
      metadata: { userId: 'u-1' },
      occurred_at: '2026-03-04T05:06:07.089Z',
    });
  });

  it('serialises business fields as JSON: dates as ISO strings, value objects as their value', () => {
    class Stamped extends DomainEvent {
      constructor(readonly at: Date, readonly account: AggregateId, readonly note?: string, init?: EventInit) {
        super(init);
      }
    }
    const account = AggregateId.generate();
    const event = new Stamped(new Date('2026-01-01T00:00:00Z'), account);
    expect(event.serialize().data).toEqual({ at: '2026-01-01T00:00:00.000Z', account: account.value });
  });

  it('wraps values JSON cannot encode in SerializationError', () => {
    class Big extends DomainEvent {
      constructor(readonly value: bigint) {
        super();
      }
    }
    expect(() => new Big(1n).serialize()).toThrow(SerializationError);
  });

  describe('rehydrate', () => {
    it('never calls the constructor', () => {
      const original = new Counted(7);
      const before = constructions;
      const rehydrated = Counted.rehydrate(original.serialize().data, envelopeFromSerialized(original.serialize()));
      expect(constructions).toBe(before);
      expect(rehydrated).toBeInstanceOf(Counted);
      expect(rehydrated.value).toBe(7);
    });

    it('round-trips through serialize()', () => {
      const original = new MoneyDeposited('acc-1', 100, { causationId: uuidv7(), metadata: { ip: '10.0.0.1' } });
      const serialized = original.serialize();
      const rehydrated = MoneyDeposited.rehydrate(serialized.data, envelopeFromSerialized(serialized));
      expect(rehydrated.serialize()).toEqual(serialized);
      expect(rehydrated.eventName).toBe('MoneyDeposited');
      expect(rehydrated.occurredAt).toEqual(original.occurredAt);
      expect(Object.keys(rehydrated)).toEqual(Object.keys(original));
    });

    it('freezes the event and everything in it (D3)', () => {
      const serialized = new MoneyDeposited('acc-1', 100).serialize();
      const rehydrated = MoneyDeposited.rehydrate({ ...serialized.data, tags: ['a'] }, envelopeFromSerialized(serialized));
      expect(Object.isFrozen(rehydrated)).toBe(true);
      expect(Object.isFrozen(rehydrated.metadata)).toBe(true);
      expect(Object.isFrozen((rehydrated as unknown as { tags: string[] }).tags)).toBe(true);
      expect(() => ((rehydrated as { amount: number }).amount = 1)).toThrow(TypeError);
    });

    it('validates the envelope', () => {
      const envelope = envelopeFromSerialized(new MoneyDeposited('a', 1).serialize());
      expect(() => MoneyDeposited.rehydrate({}, { ...envelope, id: 'bad' })).toThrow(InvalidEventIdError);
      expect(() => MoneyDeposited.rehydrate({}, { ...envelope, correlationId: 'bad' })).toThrow(InvalidCorrelationIdError);
      expect(() => MoneyDeposited.rehydrate({}, { ...envelope, causationId: 'bad' })).toThrow(InvalidCausationIdError);
    });

    it('rejects data that collides with envelope fields', () => {
      const envelope = envelopeFromSerialized(new MoneyDeposited('a', 1).serialize());
      expect(() => MoneyDeposited.rehydrate({ id: 'x' }, envelope)).toThrow(SerializationError);
    });

    it('must be called on a concrete class', () => {
      const envelope = envelopeFromSerialized(new MoneyDeposited('a', 1).serialize());
      expect(() => (DomainEvent as unknown as typeof MoneyDeposited).rehydrate({}, envelope)).toThrow(SerializationError);
    });

    it('rejects a stored timestamp that is not a date', () => {
      const serialized = { ...new MoneyDeposited('a', 1).serialize(), occurred_at: 'yesterday' };
      expect(() => envelopeFromSerialized(serialized)).toThrow(SerializationError);
    });
  });

  it('freezeEvent freezes a constructed event deeply (D3)', () => {
    class Tagged extends DomainEvent {
      constructor(readonly tags: string[]) {
        super();
      }
    }
    const event = freezeEvent(new Tagged(['a']));
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.tags)).toBe(true);
  });

  it('withExecutionContext copies the event with the context’s IDs', () => {
    const event = freezeEvent(new MoneyDeposited('acc-1', 100));
    const context = { correlationId: uuidv7(), causationId: uuidv7() };
    const enriched = withExecutionContext(event, context);
    expect(enriched).toBeInstanceOf(MoneyDeposited);
    expect(enriched).toMatchObject({ ...context, id: event.id, accountId: 'acc-1', amount: 100 });
    expect(event.correlationId).not.toBe(context.correlationId);
    expect(withExecutionContext(enriched, context)).toBe(enriched);
  });
});
