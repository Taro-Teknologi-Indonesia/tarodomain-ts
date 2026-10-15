export interface BackoffOptions {
  /** Delay before the first retry (attempt 0), in milliseconds. */
  readonly initialMs: number;
  /** Factor applied to the delay after each attempt. */
  readonly multiplier: number;
  /** Upper bound on the delay before jitter, in milliseconds. */
  readonly maxMs: number;
  /** Relative jitter. `0.1` spreads each delay uniformly over ±10%. */
  readonly jitter: number;
}

/**
 * Exponential backoff with jitter (§11.5, §16.2, §21.3): `initialMs * multiplier^attempt`,
 * capped at `maxMs`, then offset by up to ±`jitter`. Returns whole milliseconds.
 *
 * With `{ initialMs: 10, multiplier: 2, jitter: 0.1 }`, attempts 0, 1 and 2 wait about
 * 10ms, 20ms and 40ms.
 */
export function computeBackoff(attempt: number, options: BackoffOptions, random: () => number = Math.random): number {
  const base = Math.min(options.initialMs * options.multiplier ** Math.max(0, attempt), options.maxMs);
  const offset = base * options.jitter * (random() * 2 - 1);
  return Math.max(0, Math.round(base + offset));
}
