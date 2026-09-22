/**
 * Cheap, deterministic 2D value noise for low-frequency variation (ground tint for now,
 * terrain generation in phase 4 may replace this with simplex noise).
 */

import { hash2Float } from './rng';

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Smoothly interpolated value noise in [0, 1). `x` and `z` are in lattice units:
 * integer coordinates hit lattice points, values between are interpolated.
 */
export function valueNoise2(x: number, z: number, seed = 0): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep(x - x0);
  const tz = smoothstep(z - z0);
  const a = hash2Float(x0, z0, seed);
  const b = hash2Float(x0 + 1, z0, seed);
  const c = hash2Float(x0, z0 + 1, seed);
  const d = hash2Float(x0 + 1, z0 + 1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
}

/** Fractal (multi-octave) value noise, normalised to [0, 1). */
export function fbm2(x: number, z: number, octaves: number, seed = 0): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2(x * frequency, z * frequency, seed + o * 1013) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}
