import { describe, expect, it } from 'vitest';
import { fbm2, valueNoise2 } from '../../src/core/noise';
import { hash2Float } from '../../src/core/rng';

describe('valueNoise2', () => {
  it('is deterministic and within [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 0.37 - 40;
      const z = i * 0.91 - 90;
      const v = valueNoise2(x, z, 5);
      expect(v).toBe(valueNoise2(x, z, 5));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('hits the lattice hash exactly at integer coordinates', () => {
    expect(valueNoise2(3, 4, 9)).toBeCloseTo(hash2Float(3, 4, 9), 12);
  });

  it('is continuous (small steps give small changes)', () => {
    let prev = valueNoise2(0, 0.5, 1);
    for (let x = 0.01; x < 10; x += 0.01) {
      const v = valueNoise2(x, 0.5, 1);
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      prev = v;
    }
  });
});

describe('fbm2', () => {
  it('stays normalised to [0, 1)', () => {
    for (let i = 0; i < 300; i++) {
      const v = fbm2(i * 0.13, i * 0.29, 4, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
