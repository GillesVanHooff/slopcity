import { describe, expect, it } from 'vitest';
import { Grid } from '../../../src/core/grid';
import { planRoad } from '../../../src/sim/roads/roadPath';

const grid = new Grid(32, 32, 16);
const coords = (path: number[]) => path.map((i) => [grid.x(i), grid.z(i)]);

describe('planRoad', () => {
  it('returns just the start tile for a click without drag', () => {
    expect(coords(planRoad(grid, 5, 6, 5, 6, true))).toEqual([[5, 6]]);
    expect(coords(planRoad(grid, 5, 6, 5, 6, false))).toEqual([[5, 6]]);
  });

  it('runs straight along x or z in either direction, ordered from the start', () => {
    for (const xFirst of [true, false]) {
      expect(coords(planRoad(grid, 2, 3, 5, 3, xFirst))).toEqual([
        [2, 3],
        [3, 3],
        [4, 3],
        [5, 3],
      ]);
      expect(coords(planRoad(grid, 4, 9, 4, 7, xFirst))).toEqual([
        [4, 9],
        [4, 8],
        [4, 7],
      ]);
    }
  });

  it('bends into an L: x first, then z', () => {
    expect(coords(planRoad(grid, 1, 1, 3, 3, true))).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [3, 2],
      [3, 3],
    ]);
  });

  it('bends into an L: z first, then x, in the negative directions too', () => {
    expect(coords(planRoad(grid, 5, 5, 3, 2, false))).toEqual([
      [5, 5],
      [5, 4],
      [5, 3],
      [5, 2],
      [4, 2],
      [3, 2],
    ]);
  });

  it('visits the bend tile once and every tile is a neighbour of the previous one', () => {
    const path = planRoad(grid, 7, 20, 2, 11, true);
    expect(new Set(path).size).toBe(path.length);
    expect(path).toHaveLength(5 + 9 + 1);
    for (let k = 1; k < path.length; k++) {
      const dist =
        Math.abs(grid.x(path[k]) - grid.x(path[k - 1])) +
        Math.abs(grid.z(path[k]) - grid.z(path[k - 1]));
      expect(dist).toBe(1);
    }
  });

  it('clamps both ends to the map', () => {
    expect(coords(planRoad(grid, 30, 4, 40, 4, true))).toEqual([
      [30, 4],
      [31, 4],
    ]);
    const path = coords(planRoad(grid, -3, 30, 1, 35, false));
    expect(path[0]).toEqual([0, 30]);
    expect(path.at(-1)).toEqual([1, 31]);
  });

  it('reuses the output array', () => {
    const out = [99, 98];
    const res = planRoad(grid, 1, 1, 2, 1, true, out);
    expect(res).toBe(out);
    expect(res).toHaveLength(2);
  });
});
