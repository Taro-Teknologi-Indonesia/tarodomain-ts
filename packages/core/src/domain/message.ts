// Helpers shared by DomainEvent and Command, which carry the same envelope (§2.2, §28.1).

import { type FrameworkError, type FrameworkErrorOptions, SerializationError } from '../kernel/errors.js';
import { isUuid } from '../kernel/uuid.js';

export type MetadataValue = string | number | boolean | null;

/** Free-form message metadata, such as `userId`, `tenantId` or the client IP. Frozen. */
export type Metadata = Readonly<Record<string, MetadataValue>>;

type IdErrorClass = new (message: string, options?: FrameworkErrorOptions) => FrameworkError;

/** Returns `value` if it is a UUID, otherwise throws `ErrorClass`. */
export function requireUuid(value: unknown, field: string, ErrorClass: IdErrorClass): string {
  if (!isUuid(value)) {
    throw new ErrorClass(`${field} must be a UUID, got ${JSON.stringify(value)}`, { context: { field, value } });
  }
  return value;
}

export function freezeMetadata(metadata: Metadata | undefined): Metadata {
  return Object.freeze({ ...metadata });
}

/** Reads a static property declared on `target` itself, ignoring one inherited from a parent class. */
export function ownStatic(target: object, key: string): unknown {
  return Object.hasOwn(target, key) ? Reflect.get(target, key) : undefined;
}

/** The own enumerable properties of `message` that are not envelope fields. */
export function businessFields(message: object, envelopeKeys: ReadonlySet<string>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(message)) {
    if (!envelopeKeys.has(key)) fields[key] = value;
  }
  return fields;
}

/**
 * A JSON-safe deep copy of `value`: dates become ISO strings, value objects become their `value`,
 * `undefined` fields are dropped. This is exactly what comes back from any store.
 */
export function toJsonData(value: Readonly<Record<string, unknown>>, label: string): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch (error) {
    throw new SerializationError(`${label} cannot be serialized to JSON`, { cause: error, context: { label } });
  }
}

/** Freezes `value` and every object and array reachable from it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value) || ArrayBuffer.isView(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return value;
}

/**
 * Builds an instance of `prototype`'s class from stored fields without calling its constructor
 * (§2.1), then freezes it (D3).
 */
export function rehydrateMessage<T extends object>(
  prototype: T,
  envelope: object,
  data: Readonly<Record<string, unknown>>,
  envelopeKeys: ReadonlySet<string>,
  label: string,
): T {
  const instance = Object.create(prototype) as T;
  for (const [key, value] of Object.entries(envelope)) defineField(instance, key, value);
  for (const [key, value] of Object.entries(data)) {
    if (envelopeKeys.has(key)) {
      throw new SerializationError(`${label} data contains the reserved envelope field "${key}"`, {
        context: { label, field: key },
      });
    }
    defineField(instance, key, value);
  }
  return deepFreeze(instance);
}

/** A copy of `message` with some fields replaced. Works on frozen messages; the copy is not frozen. */
export function cloneMessage<T extends object>(message: T, patch: Readonly<Record<string, unknown>>): T {
  const clone = Object.create(Object.getPrototypeOf(message) as object) as T;
  for (const [key, value] of Object.entries(message)) {
    defineField(clone, key, Object.hasOwn(patch, key) ? patch[key] : value);
  }
  return clone;
}

function defineField(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}
