import { AmbientContext, ContextKey } from '../kernel/context.js';
import { InvalidCausationIdError, InvalidCorrelationIdError } from '../kernel/errors.js';
import { requireUuid } from './message.js';

/** The tracing IDs that events raised while handling a command inherit (§5.5, §28). */
export interface ExecutionContextValue {
  readonly correlationId: string;
  /** The command or event that caused the work in progress. */
  readonly causationId: string | null;
}

const EXECUTION_CONTEXT = new ContextKey<ExecutionContextValue>('tarodomain.executionContext');

/**
 * Links events to the command that caused them (§5.5). The pipeline sets it before a handler
 * runs and clears it afterwards. `AggregateRoot.raise()` enriches events with it.
 *
 * The value lives in the ambient {@link AmbientContext} storage, so it is per request when
 * `AsyncLocalStorage` is installed (D2).
 */
export class ExecutionContext {
  private constructor() {}

  static set(value: ExecutionContextValue): void {
    AmbientContext.set(EXECUTION_CONTEXT, validateExecutionContext(value));
  }

  static get(): ExecutionContextValue | null {
    return AmbientContext.get(EXECUTION_CONTEXT) ?? null;
  }

  static clear(): void {
    AmbientContext.set(EXECUTION_CONTEXT, undefined);
  }

  /** Runs `fn` in a new scope with `value` set. The enclosing scope's context is untouched. */
  static run<R>(value: ExecutionContextValue, fn: () => R): R {
    const validated = validateExecutionContext(value);
    return AmbientContext.run(() => {
      AmbientContext.set(EXECUTION_CONTEXT, validated);
      return fn();
    });
  }
}

/** Checks both IDs and returns a frozen copy. */
export function validateExecutionContext(value: ExecutionContextValue): ExecutionContextValue {
  return Object.freeze({
    correlationId: requireUuid(value.correlationId, 'correlationId', InvalidCorrelationIdError),
    causationId:
      value.causationId === null ? null : requireUuid(value.causationId, 'causationId', InvalidCausationIdError),
  });
}
