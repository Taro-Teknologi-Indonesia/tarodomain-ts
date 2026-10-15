import { describe, expect, it } from 'vitest';
import * as errors from '../../src/kernel/errors.js';
import {
  AggregateNotFoundError,
  ConcurrencyError,
  ConfigurationError,
  DomainError,
  type ErrorCategory,
  EventStoreError,
  FrameworkError,
  InfrastructureError,
  InvalidConfigurationError,
  OptimisticConcurrencyError,
  shouldRetry,
} from '../../src/kernel/errors.js';

// §22.2, verbatim.
const SPEC_CODES: Readonly<Record<ErrorCategory, readonly string[]>> = {
  domain: [
    'INVALID_EVENT_ID', 'INVALID_CORRELATION_ID', 'INVALID_CAUSATION_ID', 'AGGREGATE_ALREADY_EXISTS',
    'AGGREGATE_NOT_FOUND', 'INVALID_AGGREGATE_STATE', 'COMMAND_VALIDATION', 'INVALID_COMMAND_ID',
    'INVALID_COMMAND_CORRELATION_ID', 'INVALID_COMMAND_CAUSATION_ID', 'SAGA_ALREADY_COMPLETED',
    'SAGA_ALREADY_STARTED', 'SAGA_NOT_STARTED', 'COMPENSATION_FAILED', 'SAGA_TIMEOUT', 'INVALID_SAGA_TRANSITION',
    'VALUE_OBJECT_INVALID', 'INCOMPARABLE_VALUE', 'VALUE_OBJECT_CONSTRUCTION_FAILED',
  ],
  concurrency: ['OPTIMISTIC_CONCURRENCY', 'COMMAND_ALREADY_PROCESSED', 'CONCURRENT_MODIFICATION'],
  infrastructure: [
    'EVENT_STORE_ERROR', 'EVENT_APPEND_FAILED', 'EVENT_LOAD_FAILED', 'STREAM_NOT_FOUND', 'SNAPSHOT_STORE_ERROR',
    'SNAPSHOT_LOAD_FAILED', 'SNAPSHOT_SAVE_FAILED', 'EVENT_BUS_ERROR', 'EVENT_PUBLISH_FAILED', 'EVENT_HANDLER_FAILED',
    'SAGA_STORE_ERROR', 'PROJECTION_ERROR', 'PROJECTION_HANDLER_FAILED', 'PROJECTION_IDEMPOTENCY_VIOLATION',
    'QUEUE_ERROR', 'SERIALIZATION_ERROR', 'OPERATION_TIMEOUT', 'DEAD_LETTER',
  ],
  configuration: [
    'MISSING_EVENT_HANDLER', 'UNKNOWN_EVENT_TYPE', 'DUPLICATE_EVENT_REGISTRATION', 'EVENT_VERSION_MISMATCH',
    'COMMAND_HANDLER_NOT_REGISTERED', 'INVALID_CONFIGURATION', 'MISSING_DEPENDENCY', 'AGGREGATE_NOT_REGISTERED',
    'PROJECTION_NOT_REGISTERED', 'SAGA_NOT_REGISTERED', 'CIRCULAR_DEPENDENCY',
  ],
};

// §22.1, verbatim.
const SPEC_CATEGORIES: Readonly<Record<ErrorCategory, { retryable: boolean; httpStatus: number }>> = {
  domain: { retryable: false, httpStatus: 400 },
  concurrency: { retryable: true, httpStatus: 409 },
  infrastructure: { retryable: true, httpStatus: 500 },
  configuration: { retryable: false, httpStatus: 500 },
};

const CATEGORY_BASES = {
  domain: DomainError,
  concurrency: ConcurrencyError,
  infrastructure: InfrastructureError,
  configuration: ConfigurationError,
} as const;

type ConcreteError = new (message: string, options?: errors.FrameworkErrorOptions) => FrameworkError;

// Every exported concrete error class, instantiated once.
const concreteErrors = (Object.values(errors) as unknown[])
  .filter((value): value is ConcreteError => typeof value === 'function' && value.prototype instanceof FrameworkError)
  .map((ErrorClass) => new ErrorClass('test'))
  .filter((error) => typeof error.code === 'string');

describe('§22 Error hierarchy', () => {
  it('defines exactly the 51 codes of §22.2', () => {
    const specCodes = Object.values(SPEC_CODES).flat();
    expect(specCodes).toHaveLength(51);
    expect(concreteErrors.map((e) => e.code).sort()).toEqual([...specCodes].sort());
  });

  describe.each(Object.keys(SPEC_CODES) as ErrorCategory[])('%s errors', (category) => {
    const inCategory = concreteErrors.filter((e) => SPEC_CODES[category].includes(e.code));

    it.each(inCategory.map((e) => [e.code, e] as const))('%s has the category, status and retryability of §22.1', (_, error) => {
      expect(error.category).toBe(category);
      expect(error).toBeInstanceOf(CATEGORY_BASES[category]);
      expect(error.retryable).toBe(SPEC_CATEGORIES[category].retryable);
      expect(error.httpStatus).toBe(SPEC_CATEGORIES[category].httpStatus);
    });
  });

  it('names each error after its class and keeps the cause', () => {
    const cause = new Error('disk full');
    const error = new EventStoreError('append failed', { cause, context: { streamId: 'Account-1' } });
    expect(error.name).toBe('EventStoreError');
    expect(error.message).toBe('append failed');
    expect(error.cause).toBe(cause);
    expect(error.context).toEqual({ streamId: 'Account-1' });
    expect(Object.isFrozen(error.context)).toBe(true);
    expect(error).toBeInstanceOf(Error);
  });

  it('lets user code define its own domain errors', () => {
    class InsufficientFundsError extends DomainError {
      readonly code = 'INSUFFICIENT_FUNDS';
    }
    const error = new InsufficientFundsError('balance too low');
    expect(error.category).toBe('domain');
    expect(error.retryable).toBe(false);
    expect(error.toHttpResponse().status).toBe(400);
  });

  it('serialises to JSON, including a nested cause', () => {
    const inner = new OptimisticConcurrencyError('version 3 expected, found 4');
    const error = new EventStoreError('append failed', { cause: inner, context: { streamId: 'Account-1' } });
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: 'EventStoreError',
      code: 'EVENT_STORE_ERROR',
      category: 'infrastructure',
      message: 'append failed',
      retryable: true,
      httpStatus: 500,
      context: { streamId: 'Account-1' },
      cause: {
        name: 'OptimisticConcurrencyError',
        code: 'OPTIMISTIC_CONCURRENCY',
        category: 'concurrency',
        message: 'version 3 expected, found 4',
        retryable: true,
        httpStatus: 409,
        context: {},
      },
    });
    expect(new EventStoreError('x', { cause: new TypeError('boom') }).toJSON().cause).toEqual({
      name: 'TypeError',
      message: 'boom',
    });
    expect(new EventStoreError('x', { cause: 42 }).toJSON().cause).toBe('42');
  });

  it('includes context in HTTP responses for client errors only', () => {
    const notFound = new AggregateNotFoundError('BankAccount not found', { context: { id: 'acc-1' } });
    expect(notFound.toHttpResponse()).toEqual({
      status: 400,
      body: {
        error: {
          code: 'AGGREGATE_NOT_FOUND',
          category: 'domain',
          message: 'BankAccount not found',
          retryable: false,
          context: { id: 'acc-1' },
        },
      },
    });

    const internal = new EventStoreError('D1 unavailable', { context: { sql: 'INSERT …' }, cause: new Error('x') });
    expect(internal.toHttpResponse()).toEqual({
      status: 500,
      body: { error: { code: 'EVENT_STORE_ERROR', category: 'infrastructure', message: 'D1 unavailable', retryable: true } },
    });
  });

  it('logs domain errors as warnings and everything else as errors', () => {
    expect(new AggregateNotFoundError('x').toLogEntry()).toMatchObject({ level: 'warn', code: 'AGGREGATE_NOT_FOUND' });
    const entry = new InvalidConfigurationError('bad config').toLogEntry();
    expect(entry).toMatchObject({ level: 'error', code: 'INVALID_CONFIGURATION' });
    expect(entry.stack).toContain('InvalidConfigurationError');
  });
});

describe('§21.3 shouldRetry', () => {
  it('follows the category of framework errors', () => {
    expect(shouldRetry(new OptimisticConcurrencyError('x'))).toBe(true);
    expect(shouldRetry(new EventStoreError('x'))).toBe(true);
    expect(shouldRetry(new AggregateNotFoundError('x'))).toBe(false);
    expect(shouldRetry(new InvalidConfigurationError('x'))).toBe(false);
  });

  it('treats unknown errors as infrastructure, so they are retried (D1)', () => {
    expect(shouldRetry(new Error('ECONNRESET'))).toBe(true);
    expect(shouldRetry(new TypeError('fetch failed'))).toBe(true);
    expect(shouldRetry('a thrown string')).toBe(true);
  });
});
