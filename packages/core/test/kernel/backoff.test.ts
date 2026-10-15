import { describe, expect, it } from 'vitest';
import { type BackoffOptions, computeBackoff } from '../../src/kernel/backoff.js';

const CONCURRENCY_DEFAULTS: BackoffOptions = { initialMs: 10, multiplier: 2, maxMs: 1_000, jitter: 0.1 };
const NO_JITTER: BackoffOptions = { ...CONCURRENCY_DEFAULTS, jitter: 0 };

describe('§16.2 Backoff with jitter', () => {
  it('grows exponentially: 10ms → 20ms → 40ms', () => {
    expect([0, 1, 2].map((attempt) => computeBackoff(attempt, NO_JITTER))).toEqual([10, 20, 40]);
  });

  it('caps the delay at maxMs', () => {
    expect(computeBackoff(20, NO_JITTER)).toBe(1_000);
    expect(computeBackoff(20, { ...CONCURRENCY_DEFAULTS, maxMs: 50 }, () => 0.5)).toBe(50);
  });

  it('applies jitter of at most ±10% around the capped delay', () => {
    expect(computeBackoff(2, CONCURRENCY_DEFAULTS, () => 0)).toBe(36);
    expect(computeBackoff(2, CONCURRENCY_DEFAULTS, () => 0.5)).toBe(40);
    expect(computeBackoff(2, CONCURRENCY_DEFAULTS, () => 0.999_999)).toBe(44);

    for (let attempt = 0; attempt < 12; attempt++) {
      const base = Math.min(10 * 2 ** attempt, 1_000);
      for (let i = 0; i < 200; i++) {
        const delay = computeBackoff(attempt, CONCURRENCY_DEFAULTS);
        expect(delay).toBeGreaterThanOrEqual(Math.floor(base * 0.9));
        expect(delay).toBeLessThanOrEqual(Math.ceil(base * 1.1));
      }
    }
  });

  it('matches the §21.3 retry policy defaults: 100ms → 200ms → 400ms', () => {
    const policy: BackoffOptions = { initialMs: 100, multiplier: 2, maxMs: 10_000, jitter: 0 };
    expect([0, 1, 2].map((attempt) => computeBackoff(attempt, policy))).toEqual([100, 200, 400]);
  });

  it('returns whole, non-negative milliseconds', () => {
    const delay = computeBackoff(0, { initialMs: 3, multiplier: 1.5, maxMs: 100, jitter: 0.1 }, () => 0.37);
    expect(Number.isInteger(delay)).toBe(true);
    expect(computeBackoff(-1, NO_JITTER)).toBe(10);
  });
});
