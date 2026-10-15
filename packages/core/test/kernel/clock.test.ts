import { describe, expect, it } from 'vitest';
import { ManualClock, systemClock } from '../../src/kernel/clock.js';

describe('Clock', () => {
  it('systemClock reads the real time', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('systemClock.sleep waits', async () => {
    const start = performance.now();
    await systemClock.sleep(15);
    expect(performance.now() - start).toBeGreaterThanOrEqual(10);
  });

  it('ManualClock moves only when told to', async () => {
    const clock = new ManualClock(new Date('2026-01-01T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');

    clock.advance(1_500);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.500Z');

    await clock.sleep(60_000);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:01:01.500Z');

    clock.set(0);
    expect(clock.now().getTime()).toBe(0);
    expect(() => clock.advance(-1)).toThrow(RangeError);
  });
});
