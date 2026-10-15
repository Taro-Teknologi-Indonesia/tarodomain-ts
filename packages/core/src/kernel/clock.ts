/** The source of time for timeouts, retention cleanup and backoff waits. */
export interface Clock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

/** The real clock: `Date` and `setTimeout`. */
export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** A clock that only moves when told to. `sleep()` advances it and resolves at once. */
export class ManualClock implements Clock {
  #ms: number;

  constructor(start: Date | number = 0) {
    this.#ms = toMs(start);
  }

  now(): Date {
    return new Date(this.#ms);
  }

  sleep(ms: number): Promise<void> {
    this.advance(ms);
    return Promise.resolve();
  }

  advance(ms: number): void {
    if (ms < 0) throw new RangeError(`Cannot advance a clock by a negative duration (${ms}ms)`);
    this.#ms += ms;
  }

  set(time: Date | number): void {
    this.#ms = toMs(time);
  }
}

function toMs(time: Date | number): number {
  return typeof time === 'number' ? time : time.getTime();
}
