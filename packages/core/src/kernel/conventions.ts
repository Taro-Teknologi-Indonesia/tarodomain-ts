/** A handler found by naming convention, already bound to its owner. */
export type ConventionHandler = (message: unknown) => unknown;

/**
 * Finds the method named `prefix + name` on `target` or its prototype chain, bound to `target`.
 * This is how aggregates (`on[Event]`), projections (`on[Event]`) and sagas (`startsWhen[Event]`, …)
 * dispatch without decorators (§5.2, §12.2, §13.1).
 */
export function findHandler(target: object, prefix: string, name: string): ConventionHandler | undefined {
  const candidate: unknown = Reflect.get(target, prefix + name);
  return typeof candidate === 'function' ? (candidate.bind(target) as ConventionHandler) : undefined;
}
