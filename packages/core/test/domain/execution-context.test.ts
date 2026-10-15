import { afterEach, describe, expect, it } from 'vitest';
import { ExecutionContext } from '../../src/domain/execution-context.js';
import { InvalidCausationIdError, InvalidCorrelationIdError } from '../../src/kernel/errors.js';
import { uuidv7 } from '../../src/kernel/uuid.js';

describe('§5.5 ExecutionContext', () => {
  afterEach(() => ExecutionContext.clear());

  it('sets, reads and clears the tracing IDs', () => {
    expect(ExecutionContext.get()).toBeNull();
    const value = { correlationId: uuidv7(), causationId: uuidv7() };
    ExecutionContext.set(value);
    expect(ExecutionContext.get()).toEqual(value);
    expect(Object.isFrozen(ExecutionContext.get())).toBe(true);
    ExecutionContext.clear();
    expect(ExecutionContext.get()).toBeNull();
  });

  it('accepts a null causation ID for root commands', () => {
    ExecutionContext.set({ correlationId: uuidv7(), causationId: null });
    expect(ExecutionContext.get()?.causationId).toBeNull();
  });

  it('validates both IDs', () => {
    expect(() => ExecutionContext.set({ correlationId: 'x', causationId: null })).toThrow(InvalidCorrelationIdError);
    expect(() => ExecutionContext.set({ correlationId: uuidv7(), causationId: 'x' })).toThrow(InvalidCausationIdError);
    expect(() => ExecutionContext.run({ correlationId: 'x', causationId: null }, () => {})).toThrow(InvalidCorrelationIdError);
  });

  it('run() scopes the context, so a nested dispatch leaves the outer one intact', async () => {
    const outer = { correlationId: uuidv7(), causationId: uuidv7() };
    const inner = { correlationId: outer.correlationId, causationId: uuidv7() };

    await ExecutionContext.run(outer, async () => {
      await ExecutionContext.run(inner, async () => {
        expect(ExecutionContext.get()).toEqual(inner);
        ExecutionContext.clear();
      });
      expect(ExecutionContext.get()).toEqual(outer);
    });
    expect(ExecutionContext.get()).toBeNull();
  });
});
