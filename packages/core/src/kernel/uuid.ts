const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

// The counter fills rand_a (12 bits) and the top 30 bits of rand_b (RFC 9562 §6.2, method 1).
// Each new millisecond seeds it with 41 random bits, leaving 2^41 increments of headroom.
const COUNTER_BITS = 42;
const MAX_COUNTER = 2 ** COUNTER_BITS - 1;

/** Whether `value` is a UUID string of any version, in canonical 8-4-4-4-12 form. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Whether `value` is a version 7 UUID string. */
export function isUuidv7(value: unknown): value is string {
  return typeof value === 'string' && UUIDV7_PATTERN.test(value);
}

/** The Unix timestamp, in milliseconds, encoded in a UUIDv7. */
export function uuidv7Timestamp(uuid: string): number {
  return Number.parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16);
}

/**
 * Generates UUIDv7 strings (RFC 9562) that sort in generation order, even when many are
 * generated within one millisecond or the clock steps backwards.
 */
export class Uuidv7Generator {
  readonly #now: () => number;
  readonly #fillRandom: (bytes: Uint8Array<ArrayBuffer>) => void;
  #lastMs = -1;
  #counter = 0;

  constructor(
    now: () => number = Date.now,
    fillRandom: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) => crypto.getRandomValues(bytes),
  ) {
    this.#now = now;
    this.#fillRandom = fillRandom;
  }

  next(): string {
    const random = new Uint8Array(10);
    this.#fillRandom(random);

    const now = this.#now();
    if (now > this.#lastMs) {
      this.#lastMs = now;
      this.#counter = seedCounter(random);
    } else if (this.#counter < MAX_COUNTER) {
      this.#counter++;
    } else {
      this.#lastMs++;
      this.#counter = seedCounter(random);
    }

    const bytes = new Uint8Array(16);
    let ms = this.#lastMs;
    for (let i = 5; i >= 0; i--) {
      bytes[i] = ms % 256;
      ms = Math.floor(ms / 256);
    }
    const high = Math.floor(this.#counter / 2 ** 30);
    const low = this.#counter % 2 ** 30;
    bytes[6] = 0x70 | (high >>> 8);
    bytes[7] = high & 0xff;
    bytes[8] = 0x80 | (low >>> 24);
    bytes[9] = (low >>> 16) & 0xff;
    bytes[10] = (low >>> 8) & 0xff;
    bytes[11] = low & 0xff;
    bytes.set(random.subarray(6, 10), 12);

    let out = '';
    for (let i = 0; i < 16; i++) {
      if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
      out += HEX[bytes[i]!];
    }
    return out;
  }
}

function seedCounter(random: Uint8Array): number {
  return (
    (random[0]! & 0x01) * 2 ** 40 +
    random[1]! * 2 ** 32 +
    random[2]! * 2 ** 24 +
    random[3]! * 2 ** 16 +
    random[4]! * 2 ** 8 +
    random[5]!
  );
}

const generator = new Uuidv7Generator();

/** A new UUIDv7: globally unique and time-ordered, so IDs sort chronologically (§2.1). */
export function uuidv7(): string {
  return generator.next();
}
