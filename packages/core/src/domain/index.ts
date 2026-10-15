export {
  DEFAULT_EVENT_VERSION,
  DomainEvent,
  eventNameOf,
  eventVersionOf,
  type EventClass,
  type EventEnvelope,
  type EventInit,
} from './domain-event.js';
export type { SerializedEvent } from './serialized-event.js';
export {
  Command,
  commandNameOf,
  type CommandClass,
  type CommandEnvelope,
  type CommandInit,
  type SerializedCommand,
} from './command.js';
export type { Metadata, MetadataValue } from './message.js';
export { ValueObject } from './value-object.js';
export { AggregateId } from './aggregate-id.js';
export {
  AggregateRoot,
  aggregateNameOf,
  type AggregateClass,
  type AggregateSnapshot,
} from './aggregate-root.js';
export { ExecutionContext, type ExecutionContextValue } from './execution-context.js';

// This barrel is also the @tarodomain/core/domain export, so a domain model gets the Kernel pieces
// it needs from one import, and nothing that reaches infrastructure.
export * from '../kernel/errors.js';
export { isUuid, isUuidv7, uuidv7 } from '../kernel/uuid.js';
