import {
  FrameworkError,
  IncomparableValueError,
  ValueObjectConstructionError,
  ValueObjectInvalidError,
} from '../kernel/errors.js';
import { stableHash } from '../kernel/hash.js';
import { deepFreeze } from './message.js';

/**
 * An immutable object defined by its value, not its identity (§2.3).
 *
 * `validate(value)` runs during construction. Return `false` or throw to reject the value;
 * a `false` becomes `ValueObjectInvalidError`. The value is deep-frozen in place.
 *
 * Subclasses must accept the value as their first constructor argument, because `with()`
 * builds the new instance through the constructor.
 */
export abstract class ValueObject<T> {
  readonly value: T;

  constructor(value: T) {
    let valid: boolean | void;
    try {
      valid = this.validate(value);
    } catch (error) {
      if (error instanceof FrameworkError) throw error;
      throw new ValueObjectConstructionError(`${new.target.name} could not be constructed`, {
        cause: error,
        context: { valueObject: new.target.name },
      });
    }
    if (valid === false) {
      throw new ValueObjectInvalidError(`Invalid ${new.target.name}`, { context: { valueObject: new.target.name } });
    }
    this.value = deepFreeze(value);
  }

  /** Checks the invariants. Runs before any subclass field is initialised. */
  protected validate(_value: T): boolean | void {}

  /** Structural equality: the same class, and deeply equal values. */
  equals(other: unknown): boolean {
    return (
      other instanceof ValueObject && other.constructor === this.constructor && deepEquals(this.value, other.value)
    );
  }

  /** A hash consistent with `equals()`: equal value objects have equal hashes. */
  hashCode(): number {
    return stableHash(canonical(this));
  }

  /** Orders value objects. Not every value object is ordered: the default throws `IncomparableValueError`. */
  compareTo(_other: this): number {
    throw new IncomparableValueError(`${this.constructor.name} is not ordered`, {
      context: { valueObject: this.constructor.name },
    });
  }

  /** A new instance with the value `mutator` returns. The new value is validated. */
  with(mutator: (value: T) => T): this {
    const ValueObjectClass = this.constructor as new (value: T) => this;
    return new ValueObjectClass(mutator(this.value));
  }

  toJSON(): T {
    return this.value;
  }

  toString(): string {
    return typeof this.value === 'string' ? this.value : JSON.stringify(this.value);
  }
}

function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (a instanceof ValueObject || b instanceof ValueObject) return a instanceof ValueObject && a.equals(b);
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEquals(item, b[i]))
    );
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return (
    keysA.length === keysB.length &&
    keysA.every(
      (key) =>
        Object.hasOwn(b, key) &&
        deepEquals((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

/** A string that is equal for values `deepEquals` considers equal. */
function canonical(value: unknown): string {
  if (value instanceof ValueObject) return `${value.constructor.name}(${canonical(value.value)})`;
  if (value instanceof Date) return `Date(${value.getTime()})`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value}n`;
  return String(value);
}
