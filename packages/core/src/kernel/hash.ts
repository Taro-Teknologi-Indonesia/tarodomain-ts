import { InvalidConfigurationError } from './errors.js';

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const encoder = new TextEncoder();

/**
 * 32-bit FNV-1a over the UTF-8 bytes of `input`, as an unsigned integer.
 * The result is the same on every runtime, so shard routing never changes between deploys.
 */
export function stableHash(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of encoder.encode(input)) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** The shard that owns `key`: `hash(key) % shardCount` (§12.1). */
export function shardIndex(key: string, shardCount: number): number {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new InvalidConfigurationError(`shardCount must be a positive integer, got ${shardCount}`, {
      context: { shardCount },
    });
  }
  return stableHash(key) % shardCount;
}
