import { describe, expect, it } from 'vitest';
import { findHandler } from '../../src/kernel/conventions.js';

class Base {
  seen: unknown[] = [];
  onInherited(event: unknown) {
    this.seen.push(['inherited', event]);
  }
}

class Target extends Base {
  onSomething = 'not a function';
  startsWhenOrderPlaced(event: unknown) {
    this.seen.push(['started', event]);
    return ['command'];
  }
}

describe('§12.2 Convention lookup', () => {
  it('finds a method by prefix and name, bound to its owner', () => {
    const target = new Target();
    const handler = findHandler(target, 'startsWhen', 'OrderPlaced');
    expect(handler).toBeTypeOf('function');
    expect(handler!('event-1')).toEqual(['command']);
    expect(target.seen).toEqual([['started', 'event-1']]);
  });

  it('searches the prototype chain', () => {
    const target = new Target();
    findHandler(target, 'on', 'Inherited')!('event-2');
    expect(target.seen).toEqual([['inherited', 'event-2']]);
  });

  it('returns undefined when there is no method of that name', () => {
    const target = new Target();
    expect(findHandler(target, 'on', 'Missing')).toBeUndefined();
    expect(findHandler(target, 'on', 'Something')).toBeUndefined();
    expect(findHandler(target, 'continueWhen', 'OrderPlaced')).toBeUndefined();
  });
});
