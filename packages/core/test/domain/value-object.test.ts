import { describe, expect, it } from 'vitest';
import { ValueObject } from '../../src/domain/value-object.js';
import {
  CommandValidationError,
  IncomparableValueError,
  ValueObjectConstructionError,
  ValueObjectInvalidError,
} from '../../src/kernel/errors.js';

class Money extends ValueObject<{ amount: number; currency: string }> {
  protected override validate(value: { amount: number; currency: string }): boolean {
    return Number.isFinite(value.amount) && /^[A-Z]{3}$/.test(value.currency);
  }

  override compareTo(other: Money): number {
    if (other.value.currency !== this.value.currency) {
      throw new IncomparableValueError('different currencies');
    }
    return this.value.amount - other.value.amount;
  }
}

class Weight extends ValueObject<{ amount: number; currency: string }> {}

class Email extends ValueObject<string> {
  protected override validate(value: string): void {
    if (!value.includes('@')) throw new ValueObjectInvalidError(`not an email: ${value}`);
  }
}

class Tags extends ValueObject<{ names: string[]; at: Date; nested: Email }> {}

describe('§2.3 ValueObject', () => {
  it('compares by value, not identity', () => {
    const a = new Money({ amount: 10, currency: 'IDR' });
    expect(a.equals(new Money({ currency: 'IDR', amount: 10 }))).toBe(true);
    expect(a.equals(new Money({ amount: 11, currency: 'IDR' }))).toBe(false);
    expect(a.equals(a)).toBe(true);
    expect(a.equals(null)).toBe(false);
    expect(a.equals({ value: { amount: 10, currency: 'IDR' } })).toBe(false);
  });

  it('never equals a value object of another class with the same value', () => {
    expect(new Money({ amount: 1, currency: 'IDR' }).equals(new Weight({ amount: 1, currency: 'IDR' }))).toBe(false);
  });

  it('compares nested arrays, dates and value objects structurally', () => {
    const make = () => new Tags({ names: ['a', 'b'], at: new Date(0), nested: new Email('a@b.c') });
    expect(make().equals(make())).toBe(true);
    expect(make().equals(new Tags({ names: ['a'], at: new Date(0), nested: new Email('a@b.c') }))).toBe(false);
    expect(make().equals(new Tags({ names: ['a', 'b'], at: new Date(1), nested: new Email('a@b.c') }))).toBe(false);
    expect(make().equals(new Tags({ names: ['a', 'b'], at: new Date(0), nested: new Email('x@b.c') }))).toBe(false);
  });

  it('has a hashCode consistent with equals', () => {
    const pairs: [ValueObject<unknown>, ValueObject<unknown>][] = [
      [new Money({ amount: 10, currency: 'IDR' }), new Money({ currency: 'IDR', amount: 10 })],
      [new Money({ amount: 0, currency: 'IDR' }), new Money({ amount: -0, currency: 'IDR' })],
      [new Weight({ amount: Number.NaN, currency: 'kg' }), new Weight({ amount: Number.NaN, currency: 'kg' })],
      [new Tags({ names: ['a'], at: new Date(5), nested: new Email('a@b') }), new Tags({ names: ['a'], at: new Date(5), nested: new Email('a@b') })],
    ];
    for (const [a, b] of pairs) {
      expect(a.equals(b)).toBe(true);
      expect(a.hashCode()).toBe(b.hashCode());
    }
    expect(new Money({ amount: 1, currency: 'IDR' }).hashCode()).not.toBe(new Money({ amount: 2, currency: 'IDR' }).hashCode());
  });

  it('rejects a value when validate() returns false', () => {
    expect(() => new Money({ amount: 1, currency: 'idr' })).toThrow(ValueObjectInvalidError);
  });

  it('passes framework errors thrown by validate() through unchanged', () => {
    expect(() => new Email('nope')).toThrow('not an email: nope');
    class Strict extends ValueObject<number> {
      protected override validate(): void {
        throw new CommandValidationError('custom');
      }
    }
    expect(() => new Strict(1)).toThrow(CommandValidationError);
  });

  it('wraps other errors from validate() in ValueObjectConstructionError', () => {
    class Fragile extends ValueObject<{ inner?: { x: number } }> {
      protected override validate(value: { inner?: { x: number } }): boolean {
        return value.inner!.x > 0;
      }
    }
    const error = (() => {
      try {
        new Fragile({});
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ValueObjectConstructionError);
    expect((error as Error).cause).toBeInstanceOf(TypeError);
  });

  it('deep-freezes its value', () => {
    const tags = new Tags({ names: ['a'], at: new Date(0), nested: new Email('a@b') });
    expect(Object.isFrozen(tags.value)).toBe(true);
    expect(Object.isFrozen(tags.value.names)).toBe(true);
    expect(() => tags.value.names.push('b')).toThrow(TypeError);
  });

  it('with() returns a new, validated instance of the same class', () => {
    const ten = new Money({ amount: 10, currency: 'IDR' });
    const twenty = ten.with((v) => ({ ...v, amount: v.amount * 2 }));
    expect(twenty).toBeInstanceOf(Money);
    expect(twenty.value).toEqual({ amount: 20, currency: 'IDR' });
    expect(ten.value.amount).toBe(10);
    expect(() => ten.with((v) => ({ ...v, currency: 'x' }))).toThrow(ValueObjectInvalidError);
  });

  it('orders only value objects that implement compareTo', () => {
    const one = new Money({ amount: 1, currency: 'IDR' });
    const two = new Money({ amount: 2, currency: 'IDR' });
    expect(one.compareTo(two)).toBeLessThan(0);
    expect(two.compareTo(one)).toBeGreaterThan(0);
    expect(() => one.compareTo(new Money({ amount: 1, currency: 'USD' }))).toThrow(IncomparableValueError);
    expect(() => new Email('a@b').compareTo(new Email('c@d'))).toThrow(IncomparableValueError);
  });

  it('serialises to its value', () => {
    expect(JSON.stringify({ email: new Email('a@b') })).toBe('{"email":"a@b"}');
    expect(String(new Email('a@b'))).toBe('a@b');
    expect(String(new Money({ amount: 1, currency: 'IDR' }))).toBe('{"amount":1,"currency":"IDR"}');
  });
});
