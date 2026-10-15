/** The four error categories (§22.1). The category decides retryability and HTTP status. */
export type ErrorCategory = 'domain' | 'concurrency' | 'infrastructure' | 'configuration';

const CATEGORY_TRAITS: Readonly<Record<ErrorCategory, { readonly retryable: boolean; readonly httpStatus: number }>> = {
  domain: { retryable: false, httpStatus: 400 },
  concurrency: { retryable: true, httpStatus: 409 },
  infrastructure: { retryable: true, httpStatus: 500 },
  configuration: { retryable: false, httpStatus: 500 },
};

export interface FrameworkErrorOptions {
  /** Structured details about the failure, such as the aggregate ID or stream version. */
  readonly context?: Readonly<Record<string, unknown>>;
  /** The underlying error, if this one wraps another. */
  readonly cause?: unknown;
}

export interface FrameworkErrorJson {
  readonly name: string;
  readonly code: string;
  readonly category: ErrorCategory;
  readonly message: string;
  readonly retryable: boolean;
  readonly httpStatus: number;
  readonly context: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export interface HttpErrorResponse {
  readonly status: number;
  readonly body: {
    readonly error: {
      readonly code: string;
      readonly category: ErrorCategory;
      readonly message: string;
      readonly retryable: boolean;
      readonly context?: Readonly<Record<string, unknown>>;
    };
  };
}

export interface ErrorLogEntry extends FrameworkErrorJson {
  readonly level: 'warn' | 'error';
  readonly stack?: string;
}

/**
 * Base class of every error the framework throws (§22.3).
 *
 * Subclasses declare `code` and inherit `category` from one of the four category bases.
 * `retryable` and `httpStatus` derive from the category. User code extends the category
 * bases too, for example `class InsufficientFundsError extends DomainError`.
 */
export abstract class FrameworkError extends Error {
  abstract readonly code: string;
  abstract readonly category: ErrorCategory;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(message: string, options: FrameworkErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.context = Object.freeze({ ...options.context });
  }

  get retryable(): boolean {
    return CATEGORY_TRAITS[this.category].retryable;
  }

  get httpStatus(): number {
    return CATEGORY_TRAITS[this.category].httpStatus;
  }

  toJSON(): FrameworkErrorJson {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      retryable: this.retryable,
      httpStatus: this.httpStatus,
      context: this.context,
      ...(this.cause === undefined ? {} : { cause: describeCause(this.cause) }),
    };
  }

  /**
   * The HTTP response for this error. `context` is included for client errors only (4xx),
   * so server-side details never reach the caller. The cause is never included.
   */
  toHttpResponse(): HttpErrorResponse {
    const status = this.httpStatus;
    return {
      status,
      body: {
        error: {
          code: this.code,
          category: this.category,
          message: this.message,
          retryable: this.retryable,
          ...(status < 500 ? { context: this.context } : {}),
        },
      },
    };
  }

  /** A structured log entry. Domain errors log as warnings: they are rejections, not faults. */
  toLogEntry(): ErrorLogEntry {
    return {
      level: this.category === 'domain' ? 'warn' : 'error',
      ...this.toJSON(),
      ...(this.stack === undefined ? {} : { stack: this.stack }),
    };
  }
}

function describeCause(cause: unknown): unknown {
  if (cause instanceof FrameworkError) return cause.toJSON();
  if (cause instanceof Error) return { name: cause.name, message: cause.message };
  return String(cause);
}

/**
 * Whether an operation that failed with `error` is worth retrying (§21.3, §22.1).
 *
 * Framework errors answer through their category. Anything else is treated as an
 * infrastructure failure and retried, so a network blip is not dead-lettered (D1).
 */
export function shouldRetry(error: unknown): boolean {
  return error instanceof FrameworkError ? error.retryable : true;
}

// ─── Category bases ────────────────────────────────────────────────────────────

/** A business rule violation. Retrying won't help. HTTP 400. */
export abstract class DomainError extends FrameworkError {
  readonly category = 'domain';
}

/** A transient conflict. Retrying might succeed. HTTP 409. */
export abstract class ConcurrencyError extends FrameworkError {
  readonly category = 'concurrency';
}

/** A transient failure. Retrying might succeed. HTTP 500. */
export abstract class InfrastructureError extends FrameworkError {
  readonly category = 'infrastructure';
}

/** A framework misconfiguration. Retrying won't help. HTTP 500. */
export abstract class ConfigurationError extends FrameworkError {
  readonly category = 'configuration';
}

// ─── Domain (19) ───────────────────────────────────────────────────────────────

export class InvalidEventIdError extends DomainError {
  readonly code = 'INVALID_EVENT_ID';
}
export class InvalidCorrelationIdError extends DomainError {
  readonly code = 'INVALID_CORRELATION_ID';
}
export class InvalidCausationIdError extends DomainError {
  readonly code = 'INVALID_CAUSATION_ID';
}
export class AggregateAlreadyExistsError extends DomainError {
  readonly code = 'AGGREGATE_ALREADY_EXISTS';
}
export class AggregateNotFoundError extends DomainError {
  readonly code = 'AGGREGATE_NOT_FOUND';
}
export class InvalidAggregateStateError extends DomainError {
  readonly code = 'INVALID_AGGREGATE_STATE';
}
export class CommandValidationError extends DomainError {
  readonly code = 'COMMAND_VALIDATION';
}
export class InvalidCommandIdError extends DomainError {
  readonly code = 'INVALID_COMMAND_ID';
}
export class InvalidCommandCorrelationIdError extends DomainError {
  readonly code = 'INVALID_COMMAND_CORRELATION_ID';
}
export class InvalidCommandCausationIdError extends DomainError {
  readonly code = 'INVALID_COMMAND_CAUSATION_ID';
}
export class SagaAlreadyCompletedError extends DomainError {
  readonly code = 'SAGA_ALREADY_COMPLETED';
}
export class SagaAlreadyStartedError extends DomainError {
  readonly code = 'SAGA_ALREADY_STARTED';
}
export class SagaNotStartedError extends DomainError {
  readonly code = 'SAGA_NOT_STARTED';
}
export class CompensationFailedError extends DomainError {
  readonly code = 'COMPENSATION_FAILED';
}
export class SagaTimeoutError extends DomainError {
  readonly code = 'SAGA_TIMEOUT';
}
export class InvalidSagaTransitionError extends DomainError {
  readonly code = 'INVALID_SAGA_TRANSITION';
}
export class ValueObjectInvalidError extends DomainError {
  readonly code = 'VALUE_OBJECT_INVALID';
}
export class IncomparableValueError extends DomainError {
  readonly code = 'INCOMPARABLE_VALUE';
}
export class ValueObjectConstructionError extends DomainError {
  readonly code = 'VALUE_OBJECT_CONSTRUCTION_FAILED';
}

// ─── Concurrency (3) ───────────────────────────────────────────────────────────

export class OptimisticConcurrencyError extends ConcurrencyError {
  readonly code = 'OPTIMISTIC_CONCURRENCY';
}
export class CommandAlreadyProcessedError extends ConcurrencyError {
  readonly code = 'COMMAND_ALREADY_PROCESSED';
}
export class ConcurrentModificationError extends ConcurrencyError {
  readonly code = 'CONCURRENT_MODIFICATION';
}

// ─── Infrastructure (18) ───────────────────────────────────────────────────────

export class EventStoreError extends InfrastructureError {
  readonly code = 'EVENT_STORE_ERROR';
}
export class EventAppendError extends InfrastructureError {
  readonly code = 'EVENT_APPEND_FAILED';
}
export class EventLoadError extends InfrastructureError {
  readonly code = 'EVENT_LOAD_FAILED';
}
export class StreamNotFoundError extends InfrastructureError {
  readonly code = 'STREAM_NOT_FOUND';
}
export class SnapshotStoreError extends InfrastructureError {
  readonly code = 'SNAPSHOT_STORE_ERROR';
}
export class SnapshotLoadError extends InfrastructureError {
  readonly code = 'SNAPSHOT_LOAD_FAILED';
}
export class SnapshotSaveError extends InfrastructureError {
  readonly code = 'SNAPSHOT_SAVE_FAILED';
}
export class EventBusError extends InfrastructureError {
  readonly code = 'EVENT_BUS_ERROR';
}
export class EventPublishError extends InfrastructureError {
  readonly code = 'EVENT_PUBLISH_FAILED';
}
export class EventHandlerError extends InfrastructureError {
  readonly code = 'EVENT_HANDLER_FAILED';
}
export class SagaStoreError extends InfrastructureError {
  readonly code = 'SAGA_STORE_ERROR';
}
export class ProjectionError extends InfrastructureError {
  readonly code = 'PROJECTION_ERROR';
}
export class ProjectionHandlerError extends InfrastructureError {
  readonly code = 'PROJECTION_HANDLER_FAILED';
}
export class ProjectionIdempotencyViolationError extends InfrastructureError {
  readonly code = 'PROJECTION_IDEMPOTENCY_VIOLATION';
}
export class QueueError extends InfrastructureError {
  readonly code = 'QUEUE_ERROR';
}
export class SerializationError extends InfrastructureError {
  readonly code = 'SERIALIZATION_ERROR';
}
export class OperationTimeoutError extends InfrastructureError {
  readonly code = 'OPERATION_TIMEOUT';
}
export class DeadLetterError extends InfrastructureError {
  readonly code = 'DEAD_LETTER';
}

// ─── Configuration (11) ────────────────────────────────────────────────────────

export class MissingEventHandlerError extends ConfigurationError {
  readonly code = 'MISSING_EVENT_HANDLER';
}
export class UnknownEventTypeError extends ConfigurationError {
  readonly code = 'UNKNOWN_EVENT_TYPE';
}
export class DuplicateEventRegistrationError extends ConfigurationError {
  readonly code = 'DUPLICATE_EVENT_REGISTRATION';
}
export class EventVersionMismatchError extends ConfigurationError {
  readonly code = 'EVENT_VERSION_MISMATCH';
}
export class CommandHandlerNotRegisteredError extends ConfigurationError {
  readonly code = 'COMMAND_HANDLER_NOT_REGISTERED';
}
export class InvalidConfigurationError extends ConfigurationError {
  readonly code = 'INVALID_CONFIGURATION';
}
export class MissingDependencyError extends ConfigurationError {
  readonly code = 'MISSING_DEPENDENCY';
}
export class AggregateNotRegisteredError extends ConfigurationError {
  readonly code = 'AGGREGATE_NOT_REGISTERED';
}
export class ProjectionNotRegisteredError extends ConfigurationError {
  readonly code = 'PROJECTION_NOT_REGISTERED';
}
export class SagaNotRegisteredError extends ConfigurationError {
  readonly code = 'SAGA_NOT_REGISTERED';
}
export class CircularDependencyError extends ConfigurationError {
  readonly code = 'CIRCULAR_DEPENDENCY';
}
