import { describe, expect, it } from 'vitest';
import { Surface, World } from '../../src/sim/world';

describe('World', () => {
  it('allocates layers sized to the map', () => {
    const w = new World({ size: 64, chunkSize: 16, seed: 1 });
    expect(w.grid.width).toBe(64);
    expect(w.height.length).toBe(65 * 65);
    expect(w.surface.length).toBe(64 * 64);
    expect(w.surface.every((s) => s === Surface.Grass)).toBe(true);
  });

  it('starts flat and averages corner heights per tile', () => {
    const w = new World({ size: 8, chunkSize: 8, seed: 1 });
    expect(w.tileHeight(3, 3)).toBe(0);
    const s = w.cornerStride;
    w.height[3 * s + 3] = 4; // top-left corner of tile (3, 3)
    expect(w.cornerHeight(3, 3)).toBe(4);
    expect(w.tileHeight(3, 3)).toBe(1);
    // The same corner is the bottom-right corner of tile (2, 2).
    expect(w.tileHeight(2, 2)).toBe(1);
  });

  it('normalises the seed to uint32', () => {
    expect(new World({ size: 8, chunkSize: 8, seed: -1 }).seed).toBe(0xffffffff);
  });
});
