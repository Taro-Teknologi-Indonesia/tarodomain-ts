import { ValueObjectInvalidError } from '../kernel/errors.js';
import { isUuid, isUuidv7, uuidv7 } from '../kernel/uuid.js';
import { ValueObject } from './value-object.js';

/**
 * A typed UUID that identifies an aggregate (§2.4). Stored in lower case.
 *
 * TypeScript compares classes structurally, so give each subclass a type-only brand to keep
 * IDs from mixing at compile time. The brand emits no code:
 *
 * ```ts
 * class AccountId extends AggregateId {
 *   declare private readonly _brand: 'AccountId';
 * }
 * ```
 */
export class AggregateId extends ValueObject<string> {
  constructor(value: string) {
    super(typeof value === 'string' ? value.toLowerCase() : value);
  }

  protected override validate(value: string): void {
    if (!isUuid(value)) {
      throw new ValueObjectInvalidError(`${this.constructor.name} must be a UUID, got ${JSON.stringify(value)}`, {
        context: { valueObject: this.constructor.name, value },
      });
    }
  }

  /** A fresh ID, from a new UUIDv7. */
  static generate<T extends AggregateId>(this: new (value: string) => T): T {
    return new this(uuidv7());
  }

  /** An ID from any valid UUID, whatever its version. */
  static fromExisting<T extends AggregateId>(this: new (value: string) => T, uuid: string): T {
    return new this(uuid);
  }

  /** An ID from a UUID that must be version 7. */
  static fromUuidv7<T extends AggregateId>(this: new (value: string) => T, uuid: string): T {
    if (!isUuidv7(uuid)) {
      throw new ValueObjectInvalidError(`${this.name} must be a UUIDv7, got ${JSON.stringify(uuid)}`, {
        context: { valueObject: this.name, value: uuid },
      });
    }
    return new this(uuid);
  }

  override toString(): string {
    return this.value;
  }
}
