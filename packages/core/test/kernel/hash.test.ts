import { describe, expect, it } from 'vitest';
import { InvalidConfigurationError } from '../../src/kernel/errors.js';
import { shardIndex, stableHash } from '../../src/kernel/hash.js';

describe('§12.1 Stable hash', () => {
  it('is 32-bit FNV-1a (reference vectors)', () => {
    expect(stableHash('')).toBe(0x811c9dc5);
    expect(stableHash('a')).toBe(0xe40c292c);
    expect(stableHash('foobar')).toBe(0xbf9cf968);
  });

  it('hashes the UTF-8 bytes, so non-ASCII keys are stable too', () => {
    // 'é' is 0xC3 0xA9 in UTF-8.
    let expected = 0x811c9dc5;
    for (const byte of [0xc3, 0xa9]) expected = Math.imul(expected ^ byte, 0x01000193) >>> 0;
    expect(stableHash('é')).toBe(expected);
  });

  it('routes each key to one shard in range', () => {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 4_000; i++) {
      const shard = shardIndex(`account-${i}`, 4);
      expect(shard).toBe(shardIndex(`account-${i}`, 4));
      counts[shard]!++;
    }
    for (const count of counts) expect(count).toBeGreaterThan(800);
  });

  it('rejects a shard count that is not a positive integer', () => {
    for (const count of [0, -1, 1.5, Number.NaN]) {
      expect(() => shardIndex('key', count)).toThrow(InvalidConfigurationError);
    }
  });
});
