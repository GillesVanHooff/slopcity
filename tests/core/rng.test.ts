import { describe, expect, it } from 'vitest';
import { Rng, hash2, hash2Float } from '../../src/core/rng';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('differs between seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const same = Array.from({ length: 20 }, () => a.next() === b.next()).filter(Boolean);
    expect(same.length).toBeLessThan(2);
  });

  it('produces floats in [0, 1) with a sane mean', () => {
    const r = new Rng(7);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / n).toBeCloseTo(0.5, 1);
  });

  it('int() is inclusive and covers the whole range', () => {
    const r = new Rng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(3, 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it('can save and restore its state', () => {
    const r = new Rng(123);
    r.next();
    r.next();
    const saved = r.state;
    const expected = [r.next(), r.next(), r.next()];
    r.state = saved;
    expect([r.next(), r.next(), r.next()]).toEqual(expected);
  });

  it('pick() returns members and rejects empty arrays', () => {
    const r = new Rng(5);
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) expect(items).toContain(r.pick(items));
    expect(() => r.pick([])).toThrow(RangeError);
  });
});

describe('hash2', () => {
  it('is stable and seed-dependent', () => {
    expect(hash2(10, 20, 1)).toBe(hash2(10, 20, 1));
    expect(hash2(10, 20, 1)).not.toBe(hash2(10, 20, 2));
    expect(hash2(10, 20)).not.toBe(hash2(20, 10));
  });

  it('maps to [0, 1) as a float', () => {
    for (let x = -50; x < 50; x += 7) {
      for (let z = -50; z < 50; z += 11) {
        const v = hash2Float(x, z, 3);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});
