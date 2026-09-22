/**
 * Deterministic pseudo-random numbers. All randomness in the simulation must come from
 * here (never Math.random) so a seed plus a command log reproduces the same city.
 */

/** Seeded mulberry32 generator. Fast, 32-bit state, good enough for gameplay. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Current internal state, for saving. */
  get state(): number {
    return this.s;
  }

  set state(value: number) {
    this.s = value >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() on empty array');
    return items[Math.floor(this.next() * items.length)];
  }
}

/**
 * Stateless 32-bit hash of an integer coordinate pair and seed. Used for stable
 * per-tile variation (colour jitter, tree placement) that must not depend on
 * evaluation order.
 */
export function hash2(x: number, z: number, seed = 0): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** hash2 mapped to a float in [0, 1). */
export function hash2Float(x: number, z: number, seed = 0): number {
  return hash2(x, z, seed) / 4294967296;
}
