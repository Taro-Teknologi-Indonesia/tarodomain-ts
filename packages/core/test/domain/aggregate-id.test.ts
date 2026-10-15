import { describe, expect, it } from 'vitest';
import { AggregateId } from '../../src/domain/aggregate-id.js';
import { ValueObjectInvalidError } from '../../src/kernel/errors.js';
import { isUuidv7 } from '../../src/kernel/uuid.js';

class AccountId extends AggregateId {
  declare private readonly _brand: 'AccountId';
}

class CustomerId extends AggregateId {
  declare private readonly _brand: 'CustomerId';
}

const V4 = '3B241101-E2BB-4255-8CAF-4136C566A962';

describe('§2.4 AggregateId', () => {
  it('generate() returns a fresh UUIDv7 of the subclass', () => {
    const id = AccountId.generate();
    expect(id).toBeInstanceOf(AccountId);
    expect(isUuidv7(id.value)).toBe(true);
    expect(id.equals(AccountId.generate())).toBe(false);
  });

  it('fromExisting() accepts any UUID version and normalises it to lower case', () => {
    const id = AccountId.fromExisting(V4);
    expect(id).toBeInstanceOf(AccountId);
    expect(id.value).toBe(V4.toLowerCase());
    expect(id.equals(AccountId.fromExisting(V4.toLowerCase()))).toBe(true);
    expect(id.toString()).toBe(V4.toLowerCase());
  });

  it('fromUuidv7() accepts only version 7', () => {
    const v7 = AccountId.generate().value;
    expect(AccountId.fromUuidv7(v7).value).toBe(v7);
    expect(() => AccountId.fromUuidv7(V4)).toThrow(ValueObjectInvalidError);
  });

  it('rejects strings that are not UUIDs', () => {
    expect(() => AccountId.fromExisting('acc-1')).toThrow(ValueObjectInvalidError);
    expect(() => new AccountId('')).toThrow(ValueObjectInvalidError);
  });

  it('keeps IDs of different subclasses apart', () => {
    const uuid = AccountId.generate().value;
    expect(AccountId.fromExisting(uuid).equals(CustomerId.fromExisting(uuid))).toBe(false);

    // The type-only brand stops the IDs mixing at compile time. `pnpm typecheck` verifies these.
    const accept = (id: AccountId) => id;
    accept(AccountId.generate());
    // @ts-expect-error a CustomerId is not an AccountId
    accept(CustomerId.generate());
  });

  it('serialises to the bare UUID', () => {
    const id = AccountId.fromExisting(V4);
    expect(JSON.stringify({ id })).toBe(`{"id":"${V4.toLowerCase()}"}`);
  });
});
