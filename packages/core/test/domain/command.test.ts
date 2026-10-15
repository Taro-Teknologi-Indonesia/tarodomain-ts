import { describe, expect, it } from 'vitest';
import { Command, type CommandInit, commandNameOf, envelopeFromSerializedCommand } from '../../src/domain/command.js';
import {
  InvalidCommandCausationIdError,
  InvalidCommandCorrelationIdError,
  InvalidCommandIdError,
  SerializationError,
} from '../../src/kernel/errors.js';
import { isUuidv7, uuidv7 } from '../../src/kernel/uuid.js';

class DepositMoney extends Command {
  constructor(
    readonly accountId: string,
    readonly amount: number,
    init?: CommandInit,
  ) {
    super(init);
  }
}

class Minified extends Command {
  static override readonly commandName = 'OpenAccount';
}

let constructions = 0;
class Counted extends Command {
  constructor(readonly value: number, init?: CommandInit) {
    super(init);
    constructions++;
  }
}

describe('§2.2 Command', () => {
  it('fills the envelope with defaults', () => {
    const command = new DepositMoney('acc-1', 50);
    expect(isUuidv7(command.id)).toBe(true);
    expect(isUuidv7(command.correlationId)).toBe(true);
    expect(command.causationId).toBeNull();
    expect(command.metadata).toEqual({});
    expect(command.timestamp).toBeInstanceOf(Date);
  });

  it('takes envelope values from init, and validates them', () => {
    const init = { id: uuidv7(), correlationId: uuidv7(), causationId: uuidv7(), metadata: { userId: 'u-1' } };
    expect(new DepositMoney('a', 1, init)).toMatchObject(init);
    expect(() => new DepositMoney('a', 1, { id: 'x' })).toThrow(InvalidCommandIdError);
    expect(() => new DepositMoney('a', 1, { correlationId: 'x' })).toThrow(InvalidCommandCorrelationIdError);
    expect(() => new DepositMoney('a', 1, { causationId: 'x' })).toThrow(InvalidCommandCausationIdError);
  });

  it('names the command after its class unless the class overrides it', () => {
    expect(new DepositMoney('a', 1).commandName).toBe('DepositMoney');
    expect(new Minified().commandName).toBe('OpenAccount');
    expect(commandNameOf(Minified)).toBe('OpenAccount');
  });

  it('serialises for queue messages', () => {
    const command = new DepositMoney('acc-1', 50, { timestamp: new Date('2026-01-01T00:00:00Z') });
    expect(command.serialize()).toEqual({
      command_id: command.id,
      command_type: 'DepositMoney',
      causation_id: null,
      correlation_id: command.correlationId,
      data: { accountId: 'acc-1', amount: 50 },
      metadata: {},
      timestamp: '2026-01-01T00:00:00.000Z',
    });
  });

  it('rehydrates without calling the constructor, frozen', () => {
    const serialized = new Counted(3, { causationId: uuidv7() }).serialize();
    const before = constructions;
    const command = Counted.rehydrate(serialized.data, envelopeFromSerializedCommand(serialized));
    expect(constructions).toBe(before);
    expect(command).toBeInstanceOf(Counted);
    expect(command.serialize()).toEqual(serialized);
    expect(Object.isFrozen(command)).toBe(true);
  });

  it('validates the envelope on rehydrate', () => {
    const envelope = envelopeFromSerializedCommand(new DepositMoney('a', 1).serialize());
    expect(() => DepositMoney.rehydrate({}, { ...envelope, id: 'x' })).toThrow(InvalidCommandIdError);
    expect(() => (Command as unknown as typeof DepositMoney).rehydrate({}, envelope)).toThrow(SerializationError);
    expect(() =>
      envelopeFromSerializedCommand({ ...new DepositMoney('a', 1).serialize(), timestamp: 'never' }),
    ).toThrow(SerializationError);
  });
});
