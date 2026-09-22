import { describe, expect, it } from 'vitest';
import { DIR_BIT, DIR_DX, DIR_DZ, Dir, Grid, oppositeDir } from '../../src/core/grid';

describe('Grid', () => {
  const grid = new Grid(256, 256, 16);

  it('computes sizes and chunk counts', () => {
    expect(grid.size).toBe(65536);
    expect(grid.chunksX).toBe(16);
    expect(grid.chunksZ).toBe(16);
    expect(grid.chunkCount).toBe(256);
  });

  it('rejects invalid dimensions', () => {
    expect(() => new Grid(0, 10, 16)).toThrow(RangeError);
    expect(() => new Grid(10, 10.5, 16)).toThrow(RangeError);
    expect(() => new Grid(10, 10, 0)).toThrow(RangeError);
  });

  it('round-trips index <-> (x, z)', () => {
    for (const [x, z] of [
      [0, 0],
      [255, 0],
      [0, 255],
      [255, 255],
      [17, 203],
    ]) {
      const i = grid.index(x, z);
      expect(i).toBe(z * 256 + x);
      expect(grid.x(i)).toBe(x);
      expect(grid.z(i)).toBe(z);
    }
  });

  it('checks bounds', () => {
    expect(grid.inBounds(0, 0)).toBe(true);
    expect(grid.inBounds(255, 255)).toBe(true);
    expect(grid.inBounds(-1, 0)).toBe(false);
    expect(grid.inBounds(0, 256)).toBe(false);
    expect(grid.indexSafe(256, 3)).toBe(-1);
  });

  it('finds neighbours and returns -1 at edges', () => {
    const i = grid.index(10, 20);
    expect(grid.neighbor(i, Dir.N)).toBe(grid.index(10, 19));
    expect(grid.neighbor(i, Dir.E)).toBe(grid.index(11, 20));
    expect(grid.neighbor(i, Dir.S)).toBe(grid.index(10, 21));
    expect(grid.neighbor(i, Dir.W)).toBe(grid.index(9, 20));

    const corner = grid.index(0, 0);
    expect(grid.neighbor(corner, Dir.N)).toBe(-1);
    expect(grid.neighbor(corner, Dir.W)).toBe(-1);
    // Row wrap must not happen: west of (0, 5) is off-map, not (255, 4).
    expect(grid.neighbor(grid.index(0, 5), Dir.W)).toBe(-1);
    expect(grid.neighbor(grid.index(255, 5), Dir.E)).toBe(-1);
  });

  it('direction tables are consistent', () => {
    for (let d = 0; d < 4; d++) {
      const o = oppositeDir(d as Dir);
      expect(DIR_DX[d] + DIR_DX[o]).toBe(0);
      expect(DIR_DZ[d] + DIR_DZ[o]).toBe(0);
    }
    expect(DIR_BIT.reduce((a, b) => a | b, 0)).toBe(15);
  });

  it('builds neighbour masks (N=1, E=2, S=4, W=8)', () => {
    const small = new Grid(3, 3, 3);
    const set = new Set([small.index(1, 0), small.index(2, 1)]); // north and east of centre
    const mask = small.neighborMask(small.index(1, 1), (n) => set.has(n));
    expect(mask).toBe(1 | 2);
    // Edge tile never matches off-map neighbours even if the predicate would.
    expect(small.neighborMask(small.index(0, 0), () => true)).toBe(2 | 4);
  });

  it('maps tiles to chunks and back to bounds', () => {
    expect(grid.chunkOf(0, 0)).toBe(0);
    expect(grid.chunkOf(15, 15)).toBe(0);
    expect(grid.chunkOf(16, 0)).toBe(1);
    expect(grid.chunkOf(0, 16)).toBe(16);
    expect(grid.chunkOf(255, 255)).toBe(255);
    expect(grid.chunkOfIndex(grid.index(40, 70))).toBe(4 * 16 + 2);

    const b = new Int32Array(4);
    grid.chunkBounds(grid.chunkOf(40, 70), b);
    expect([...b]).toEqual([32, 64, 48, 80]);
  });

  it('clips chunk bounds for non-multiple sizes', () => {
    const odd = new Grid(20, 10, 16);
    expect(odd.chunksX).toBe(2);
    expect(odd.chunksZ).toBe(1);
    const b = [0, 0, 0, 0];
    odd.chunkBounds(1, b);
    expect(b).toEqual([16, 0, 20, 10]);
  });

  it('iterates rectangles in any corner order, clipped to the map', () => {
    const visited: number[] = [];
    grid.forEachInRect(2, 1, 0, 0, (_i, x, z) => visited.push(x + z * 10));
    expect(visited).toEqual([0, 1, 2, 10, 11, 12]);

    let count = 0;
    grid.forEachInRect(-5, -5, 1, 1, () => count++);
    expect(count).toBe(4);
  });
});
