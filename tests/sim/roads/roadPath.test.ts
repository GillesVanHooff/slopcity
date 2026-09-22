import { describe, expect, it } from 'vitest';
import { Grid } from '../../../src/core/grid';
import { planStraightRoad } from '../../../src/sim/roads/roadPath';

const grid = new Grid(32, 32, 16);
const coords = (path: number[]) => path.map((i) => [grid.x(i), grid.z(i)]);

describe('planStraightRoad', () => {
  it('returns just the start tile for a click without drag', () => {
    expect(coords(planStraightRoad(grid, 5, 6, 5, 6))).toEqual([[5, 6]]);
  });

  it('runs along x or z in either direction, ordered from the start', () => {
    expect(coords(planStraightRoad(grid, 2, 3, 5, 3))).toEqual([
      [2, 3],
      [3, 3],
      [4, 3],
      [5, 3],
    ]);
    expect(coords(planStraightRoad(grid, 4, 9, 4, 7))).toEqual([
      [4, 9],
      [4, 8],
      [4, 7],
    ]);
  });

  it('snaps diagonal drags to the dominant axis (ties go to x)', () => {
    expect(coords(planStraightRoad(grid, 0, 0, 5, 2)).at(-1)).toEqual([5, 0]);
    expect(coords(planStraightRoad(grid, 0, 0, 2, 5)).at(-1)).toEqual([0, 5]);
    expect(coords(planStraightRoad(grid, 0, 0, 3, 3)).at(-1)).toEqual([3, 0]);
  });

  it('clips the line at the map edge', () => {
    const path = planStraightRoad(grid, 30, 4, 40, 4);
    expect(coords(path)).toEqual([
      [30, 4],
      [31, 4],
    ]);
  });

  it('reuses the output array', () => {
    const out = [99, 98];
    const res = planStraightRoad(grid, 1, 1, 2, 1, out);
    expect(res).toBe(out);
    expect(res).toHaveLength(2);
  });
});
