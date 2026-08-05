import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCache } from '../src/cache.js';

describe('createCache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined for a missing key', () => {
    const cache = createCache();
    expect(cache.get('nope', 1000)).toBeUndefined();
  });

  it('returns a fresh value set with the same key', () => {
    const cache = createCache();
    cache.set('k', { a: 1 });
    expect(cache.get<{ a: number }>('k', 5000)).toEqual({ a: 1 });
  });

  it('expires entries once past the TTL', () => {
    const cache = createCache();
    cache.set('k', 'v');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    expect(cache.get('k', 1000)).toBeUndefined();
  });

  it('overwrites the previous value on re-set', () => {
    const cache = createCache();
    cache.set('k', 1);
    cache.set('k', 2);
    expect(cache.get<number>('k', 1000)).toBe(2);
  });

  it('deletes a key', () => {
    const cache = createCache();
    cache.set('k', 1);
    cache.delete('k');
    expect(cache.get('k', 1000)).toBeUndefined();
  });

  it('lets different keys coexist', () => {
    const cache = createCache();
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get<number>('a', 1000)).toBe(1);
    expect(cache.get<number>('b', 1000)).toBe(2);
  });
});