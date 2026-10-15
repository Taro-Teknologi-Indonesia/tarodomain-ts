import { afterEach, describe, expect, it } from 'vitest';
import { AggregateId } from '../../src/domain/aggregate-id.js';
import { AggregateRoot, aggregateNameOf, PRIVATE_SNAPSHOT_KEY } from '../../src/domain/aggregate-root.js';
import { DomainEvent, type EventInit, freezeEvent } from '../../src/domain/domain-event.js';
import { ExecutionContext } from '../../src/domain/execution-context.js';
import {
  InvalidAggregateStateError,
  InvalidCorrelationIdError,
  MissingEventHandlerError,
  SerializationError,
} from '../../src/kernel/errors.js';
import { uuidv7 } from '../../src/kernel/uuid.js';

class AccountId extends AggregateId {
  declare private readonly _brand: 'AccountId';
}

class AccountOpened extends DomainEvent {
  constructor(readonly ownerId: string, init?: EventInit) {
    super(init);
  }
}

class MoneyDeposited extends DomainEvent {
  constructor(readonly amount: number, init?: EventInit) {
    super(init);
  }
}

class AccountFrozen extends DomainEvent {}

class BankAccount extends AggregateRoot<AccountId> {
  ownerId = '';
  balance = 0;
  #audit: string[] = [];

  static open(id: AccountId, ownerId: string): BankAccount {
    const account = new BankAccount(id);
    account.raise(new AccountOpened(ownerId));
    return account;
  }

  deposit(amount: number): void {
    this.raise(new MoneyDeposited(amount));
  }

  freeze(): void {
    this.raise(new AccountFrozen());
  }

  raiseEvent(event: DomainEvent): void {
    this.raise(event);
  }

  get audit(): readonly string[] {
    return this.#audit;
  }

  protected onAccountOpened(event: AccountOpened): void {
    this.ownerId = event.ownerId;
    this.#audit.push('opened');
  }

  protected onMoneyDeposited(event: MoneyDeposited): void {
    if (event.amount <= 0) throw new InvalidAggregateStateError('deposit must be positive');
    this.balance += event.amount;
    this.#audit.push(`deposited ${event.amount}`);
  }

  protected override toSnapshotState(): unknown {
    return { audit: this.#audit };
  }

  protected override restoreSnapshotState(state: unknown): void {
    this.#audit = [...(state as { audit: string[] }).audit];
  }
}

class Lenient extends BankAccount {
  ignored: string[] = [];
  protected override onUnknownEvent(event: DomainEvent): void {
    this.ignored.push(event.eventName);
  }
}

const history = (): DomainEvent[] => [new AccountOpened('owner-1'), new MoneyDeposited(100), new MoneyDeposited(50)];

describe('§5 AggregateRoot', () => {
  afterEach(() => ExecutionContext.clear());

  describe('§5.2 raise and apply', () => {
    it('applies events through on[EventName] and queues them', () => {
      const account = BankAccount.open(AccountId.generate(), 'owner-1');
      account.deposit(100);

      expect(account.ownerId).toBe('owner-1');
      expect(account.balance).toBe(100);
      expect(account.version).toBe(2);
      expect(account.committedVersion).toBe(0);
      expect(account.hasUncommittedChanges).toBe(true);
      expect(account.getUncommittedChanges().map((e) => e.eventName)).toEqual(['AccountOpened', 'MoneyDeposited']);
    });

    it('freezes raised events (D3)', () => {
      const account = BankAccount.open(AccountId.generate(), 'owner-1');
      const [opened] = account.getUncommittedChanges();
      expect(Object.isFrozen(opened)).toBe(true);
    });

    it('returns a copy of the uncommitted events', () => {
      const account = BankAccount.open(AccountId.generate(), 'owner-1');
      account.getUncommittedChanges().pop();
      expect(account.getUncommittedChanges()).toHaveLength(1);
    });

    it('marks changes committed', () => {
      const account = BankAccount.open(AccountId.generate(), 'owner-1');
      account.deposit(10);
      account.markChangesAsCommitted();
      expect(account.hasUncommittedChanges).toBe(false);
      expect(account.version).toBe(2);
      expect(account.committedVersion).toBe(2);

      account.deposit(5);
      expect(account.version).toBe(3);
      expect(account.committedVersion).toBe(2);
    });

    it('throws MissingEventHandlerError for an event without a handler', () => {
      const account = BankAccount.open(AccountId.generate(), 'owner-1');
      expect(() => account.freeze()).toThrow(MissingEventHandlerError);
      expect(account.version).toBe(1);
      expect(account.getUncommittedChanges()).toHaveLength(1);
    });

    it('still counts an event that an overridden onUnknownEvent() ignores', () => {
      const account = new Lenient(AccountId.generate());
      account.loadFromHistory([new AccountOpened('o'), new AccountFrozen()]);
      expect(account.ignored).toEqual(['AccountFrozen']);
      expect(account.version).toBe(2);
    });

    it('leaves the aggregate unchanged when a handler throws', () => {
      const account = BankAccount.open(AccountId.generate(), 'owner-1');
      expect(() => account.deposit(-5)).toThrow(InvalidAggregateStateError);
      expect(account.version).toBe(1);
      expect(account.balance).toBe(0);
      expect(account.getUncommittedChanges()).toHaveLength(1);
    });
  });

  describe('loadFromHistory', () => {
    it('replays events without queueing them', () => {
      const account = new BankAccount(AccountId.generate());
      account.loadFromHistory(history());
      expect(account.balance).toBe(150);
      expect(account.version).toBe(3);
      expect(account.committedVersion).toBe(3);
      expect(account.hasUncommittedChanges).toBe(false);
    });

    it('continues from a snapshot version', () => {
      const account = new BankAccount(AccountId.generate());
      account.loadFromHistory([new MoneyDeposited(25)], 10);
      expect(account.version).toBe(11);
    });

    it('refuses to load history over uncommitted changes', () => {
      const account = BankAccount.open(AccountId.generate(), 'owner-1');
      expect(() => account.loadFromHistory(history())).toThrow(InvalidAggregateStateError);
    });

    it('rejects a snapshot version that is not a non-negative integer', () => {
      expect(() => new BankAccount(AccountId.generate()).loadFromHistory([], -1)).toThrow(InvalidAggregateStateError);
    });
  });

  describe('§5.4 snapshots', () => {
    it('round-trips public and #private state', () => {
      const id = AccountId.generate();
      const original = new BankAccount(id);
      original.loadFromHistory(history());

      const snapshot = original.toSnapshot();
      expect(snapshot).toEqual({
        data: {
          ownerId: 'owner-1',
          balance: 150,
          [PRIVATE_SNAPSHOT_KEY]: { audit: ['opened', 'deposited 100', 'deposited 50'] },
        },
        version: 3,
      });

      const restored = new BankAccount(id);
      restored.restoreSnapshot(JSON.parse(JSON.stringify(snapshot.data)) as Record<string, unknown>, snapshot.version);
      expect(restored.ownerId).toBe('owner-1');
      expect(restored.balance).toBe(150);
      expect(restored.audit).toEqual(['opened', 'deposited 100', 'deposited 50']);
      expect(restored.version).toBe(3);
      expect(restored.id).toBe(id);
      expect(restored).not.toHaveProperty(PRIVATE_SNAPSHOT_KEY);

      restored.loadFromHistory([new MoneyDeposited(1)]);
      expect(restored.balance).toBe(151);
      expect(restored.version).toBe(4);
    });

    it('produces JSON-safe data that does not alias live state', () => {
      class Listy extends BankAccount {
        items = [{ n: 1 }];
      }
      const account = new Listy(AccountId.generate());
      const { data } = account.toSnapshot();
      account.items[0]!.n = 2;
      expect(data.items).toEqual([{ n: 1 }]);
    });

    it('excludes the id and ignores one in the data', () => {
      const id = AccountId.generate();
      const account = new BankAccount(id);
      expect(account.toSnapshot().data).not.toHaveProperty('id');
      account.restoreSnapshot({ id: 'other', balance: 5 }, 1);
      expect(account.id).toBe(id);
      expect(account.balance).toBe(5);
    });

    it('discards uncommitted events on restore', () => {
      const account = BankAccount.open(AccountId.generate(), 'owner-1');
      account.restoreSnapshot({ ownerId: 'x', balance: 7 }, 5);
      expect(account.hasUncommittedChanges).toBe(false);
      expect(account.version).toBe(5);
      expect(account.committedVersion).toBe(5);
    });

    it('fails loudly on state JSON cannot carry', () => {
      class Big extends BankAccount {
        big = 1n;
      }
      expect(() => new Big(AccountId.generate()).toSnapshot()).toThrow(SerializationError);
    });
  });

  describe('§28 correlation and causation enrichment', () => {
    it('enriches raised events from the instance context set by the repository', () => {
      const context = { correlationId: uuidv7(), causationId: uuidv7() };
      const account = new BankAccount(AccountId.generate());
      account.loadFromHistory([new AccountOpened('o')]);
      account._setExecutionContext(context);
      account.deposit(10);

      const [deposited] = account.getUncommittedChanges();
      expect(deposited).toBeInstanceOf(MoneyDeposited);
      expect(deposited).toMatchObject({ ...context, amount: 10 });
    });

    it('falls back to the ambient ExecutionContext, for aggregates created by a factory', () => {
      const context = { correlationId: uuidv7(), causationId: uuidv7() };
      ExecutionContext.set(context);
      const account = BankAccount.open(AccountId.generate(), 'owner-1');
      expect(account.getUncommittedChanges()[0]).toMatchObject(context);
    });

    it('prefers the instance context over the ambient one', () => {
      const instance = { correlationId: uuidv7(), causationId: uuidv7() };
      ExecutionContext.set({ correlationId: uuidv7(), causationId: null });
      const account = new BankAccount(AccountId.generate());
      account._setExecutionContext(instance);
      account.raiseEvent(new AccountOpened('o'));
      expect(account.getUncommittedChanges()[0]).toMatchObject(instance);
    });

    it('keeps the event’s own IDs when no context is set, and after it is cleared', () => {
      const account = new BankAccount(AccountId.generate());
      account._setExecutionContext({ correlationId: uuidv7(), causationId: null });
      account._clearExecutionContext();
      const event = new AccountOpened('o');
      account.raiseEvent(event);
      expect(account.getUncommittedChanges()[0]).toMatchObject({ id: event.id, correlationId: event.correlationId });
    });

    it('can re-raise an already frozen event', () => {
      const context = { correlationId: uuidv7(), causationId: uuidv7() };
      const account = new BankAccount(AccountId.generate());
      account._setExecutionContext(context);
      account.raiseEvent(freezeEvent(new AccountOpened('o')));
      expect(account.getUncommittedChanges()[0]).toMatchObject(context);
    });

    it('validates the instance context', () => {
      const account = new BankAccount(AccountId.generate());
      expect(() => account._setExecutionContext({ correlationId: 'x', causationId: null })).toThrow(
        InvalidCorrelationIdError,
      );
    });
  });

  it('names the aggregate after its class unless the class overrides it', () => {
    class Minified extends BankAccount {
      static override readonly aggregateName = 'SavingsAccount';
    }
    class Sub extends Minified {}
    expect(aggregateNameOf(BankAccount)).toBe('BankAccount');
    expect(aggregateNameOf(Minified)).toBe('SavingsAccount');
    expect(aggregateNameOf(Sub)).toBe('Sub');
  });
});
