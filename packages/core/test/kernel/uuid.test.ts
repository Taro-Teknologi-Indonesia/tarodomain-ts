import { describe, expect, it } from 'vitest';
import { isUuid, isUuidv7, uuidv7, Uuidv7Generator, uuidv7Timestamp } from '../../src/kernel/uuid.js';

const V4 = '3b241101-e2bb-4255-8caf-4136c566a962';

function expectStrictlyIncreasing(ids: string[]): void {
  for (let i = 1; i < ids.length; i++) {
    if (!(ids[i - 1]! < ids[i]!)) throw new Error(`ids[${i - 1}] ${ids[i - 1]} >= ids[${i}] ${ids[i]}`);
  }
}

describe('§2.1 UUIDv7', () => {
  it('has the RFC 9562 layout: version 7, variant 10', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isUuidv7(id)).toBe(true);
  });

  it('encodes the current time in its first 48 bits', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    expect(uuidv7Timestamp(id)).toBeGreaterThanOrEqual(before);
    expect(uuidv7Timestamp(id)).toBeLessThanOrEqual(after);
  });

  it('stays unique and ordered under a burst', () => {
    const ids = Array.from({ length: 20_000 }, () => uuidv7());
    expect(new Set(ids).size).toBe(ids.length);
    expectStrictlyIncreasing(ids);
  });

  it('stays ordered when every ID falls in the same millisecond', () => {
    const generator = new Uuidv7Generator(() => 1_700_000_000_000);
    const ids = Array.from({ length: 20_000 }, () => generator.next());
    expectStrictlyIncreasing(ids);
    expect(ids.every((id) => uuidv7Timestamp(id) === 1_700_000_000_000)).toBe(true);
  });

  it('stays ordered when the clock steps backwards', () => {
    const times = [5_000, 5_001, 4_000, 4_000, 5_001, 6_000];
    const generator = new Uuidv7Generator(() => times.shift()!);
    const ids = Array.from({ length: 6 }, () => generator.next());
    expectStrictlyIncreasing(ids);
    expect(ids.map(uuidv7Timestamp)).toEqual([5_000, 5_001, 5_001, 5_001, 5_001, 6_000]);
  });

  it('encodes timestamps across the full 48-bit range', () => {
    const max = 2 ** 48 - 1;
    expect(uuidv7Timestamp(new Uuidv7Generator(() => max).next())).toBe(max);
    expect(new Uuidv7Generator(() => 0).next().startsWith('00000000-0000-7')).toBe(true);
  });

  it('recognises UUIDs of any version, and v7 only where asked', () => {
    expect(isUuid(V4)).toBe(true);
    expect(isUuid(V4.toUpperCase())).toBe(true);
    expect(isUuidv7(V4)).toBe(false);
    for (const invalid of ['', 'not-a-uuid', V4.slice(1), `${V4}0`, V4.replaceAll('-', ''), 42, null, undefined]) {
      expect(isUuid(invalid)).toBe(false);
      expect(isUuidv7(invalid)).toBe(false);
    }
  });
});
