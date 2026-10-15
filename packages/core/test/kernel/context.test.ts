import { afterEach, describe, expect, it } from 'vitest';
import { AmbientContext, ContextKey, type ContextStorage, GlobalContextStorage } from '../../src/kernel/context.js';

const USER = new ContextKey<string>('user');
const TENANT = new ContextKey<string>('tenant');

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe('GlobalContextStorage (D2)', () => {
  it('sets, reads and removes values outside any scope', () => {
    const storage = new GlobalContextStorage();
    expect(storage.get(USER)).toBeUndefined();
    storage.set(USER, 'ana');
    expect(storage.get(USER)).toBe('ana');
    storage.set(USER, undefined);
    expect(storage.get(USER)).toBeUndefined();
  });

  it('opens a scope that starts as a copy of the enclosing one', () => {
    const storage = new GlobalContextStorage();
    storage.set(USER, 'ana');
    const seen = storage.run(() => {
      const inherited = storage.get(USER);
      storage.set(USER, 'budi');
      storage.set(TENANT, 't1');
      return [inherited, storage.get(USER), storage.get(TENANT)];
    });
    expect(seen).toEqual(['ana', 'budi', 't1']);
    expect(storage.get(USER)).toBe('ana');
    expect(storage.get(TENANT)).toBeUndefined();
  });

  it('nests scopes', () => {
    const storage = new GlobalContextStorage();
    storage.run(() => {
      storage.set(USER, 'outer');
      storage.run(() => {
        storage.set(USER, 'inner');
        expect(storage.get(USER)).toBe('inner');
      });
      expect(storage.get(USER)).toBe('outer');
    });
    expect(storage.get(USER)).toBeUndefined();
  });

  it('keeps a scope open until an async function settles', async () => {
    const storage = new GlobalContextStorage();
    const result = await storage.run(async () => {
      storage.set(USER, 'ana');
      await tick();
      return storage.get(USER);
    });
    expect(result).toBe('ana');
    expect(storage.get(USER)).toBeUndefined();
  });

  it('closes the scope when the function throws or rejects', async () => {
    const storage = new GlobalContextStorage();
    expect(() =>
      storage.run(() => {
        storage.set(USER, 'ana');
        throw new Error('sync');
      }),
    ).toThrow('sync');
    expect(storage.get(USER)).toBeUndefined();

    await expect(
      storage.run(async () => {
        storage.set(USER, 'ana');
        await tick();
        throw new Error('async');
      }),
    ).rejects.toThrow('async');
    expect(storage.get(USER)).toBeUndefined();
  });

  it('removes every scope after overlapping async runs, whatever order they finish in', async () => {
    const storage = new GlobalContextStorage();
    let releaseFirst!: () => void;
    const first = storage.run(async () => {
      storage.set(USER, 'first');
      await new Promise<void>((resolve) => (releaseFirst = resolve));
    });
    const second = storage.run(async () => {
      storage.set(USER, 'second');
      await tick();
    });
    await second;
    releaseFirst();
    await first;
    expect(storage.get(USER)).toBeUndefined();
  });
});

describe('AmbientContext', () => {
  const original = AmbientContext.storage;
  afterEach(() => AmbientContext.use(original));

  it('delegates to the installed storage', () => {
    const calls: string[] = [];
    const recording: ContextStorage = {
      run: (fn) => {
        calls.push('run');
        return fn();
      },
      get: <T>(key: ContextKey<T>) => {
        calls.push(`get ${key.description}`);
        return undefined;
      },
      set: (key) => {
        calls.push(`set ${key.description}`);
      },
    };
    AmbientContext.use(recording);
    expect(AmbientContext.storage).toBe(recording);
    AmbientContext.run(() => AmbientContext.set(USER, 'ana'));
    AmbientContext.get(USER);
    expect(calls).toEqual(['run', 'set user', 'get user']);
  });
});
