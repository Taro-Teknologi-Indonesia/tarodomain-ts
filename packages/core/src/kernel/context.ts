/** A typed key for a value held in a {@link ContextStorage}. */
export class ContextKey<T> {
  declare readonly _type: T;
  readonly description: string;

  constructor(description: string) {
    this.description = description;
  }
}

/**
 * Request-scoped storage for ambient values: the `ExecutionContext` (§5.5) and, on providers
 * that defer writes, the active unit of work (D2).
 *
 * `run(fn)` opens a scope that starts as a copy of the enclosing one. Values set inside it are
 * visible to `fn` and the work it awaits, and are gone when it ends.
 */
export interface ContextStorage {
  run<R>(fn: () => R): R;
  get<T>(key: ContextKey<T>): T | undefined;
  /** Sets `key` in the current scope. `undefined` removes it. */
  set<T>(key: ContextKey<T>, value: T | undefined): void;
}

/**
 * The default storage: one process-wide stack of scopes.
 *
 * Correct for one request at a time, which is how a Worker processes commands sequentially.
 * Concurrent requests in one process see each other's values while they overlap, though every
 * scope is still removed when it ends. Install `AsyncLocalStorage` from
 * `@tarodomain/core/async-context` when requests run concurrently.
 */
export class GlobalContextStorage implements ContextStorage {
  readonly #root = new Map<ContextKey<unknown>, unknown>();
  readonly #scopes: Map<ContextKey<unknown>, unknown>[] = [];

  run<R>(fn: () => R): R {
    const scope = new Map(this.#current());
    this.#scopes.push(scope);
    const exit = () => {
      const index = this.#scopes.lastIndexOf(scope);
      if (index !== -1) this.#scopes.splice(index, 1);
    };

    let result: R;
    try {
      result = fn();
    } catch (error) {
      exit();
      throw error;
    }
    if (isPromiseLike(result)) {
      return Promise.resolve(result).finally(exit) as R;
    }
    exit();
    return result;
  }

  get<T>(key: ContextKey<T>): T | undefined {
    return this.#current().get(key) as T | undefined;
  }

  set<T>(key: ContextKey<T>, value: T | undefined): void {
    if (value === undefined) this.#current().delete(key);
    else this.#current().set(key, value);
  }

  #current(): Map<ContextKey<unknown>, unknown> {
    return this.#scopes.at(-1) ?? this.#root;
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** The process-wide holder of the active {@link ContextStorage}. */
export class AmbientContext {
  static #storage: ContextStorage = new GlobalContextStorage();

  private constructor() {}

  static get storage(): ContextStorage {
    return AmbientContext.#storage;
  }

  /** Replaces the storage. Call it once at startup, before any request runs. */
  static use(storage: ContextStorage): void {
    AmbientContext.#storage = storage;
  }

  static run<R>(fn: () => R): R {
    return AmbientContext.#storage.run(fn);
  }

  static get<T>(key: ContextKey<T>): T | undefined {
    return AmbientContext.#storage.get(key);
  }

  static set<T>(key: ContextKey<T>, value: T | undefined): void {
    AmbientContext.#storage.set(key, value);
  }
}
