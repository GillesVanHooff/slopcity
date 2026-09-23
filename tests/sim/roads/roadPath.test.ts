import { describe, expect, it } from 'vitest';
import { Grid } from '../../../src/core/grid';
import { planAvenue, planRoad } from '../../../src/sim/roads/roadPath';

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

describe('planAvenue', () => {
  const N = 1;
  const E = 2;
  const S = 4;
  const W = 8;
  const plan = (ax: number, az: number, bx: number, bz: number, xFirst = true) => {
    const tiles: number[] = [];
    const medians: number[] = [];
    planAvenue(grid, ax, az, bx, bz, xFirst, tiles, medians);
    return new Map(tiles.map((i, k) => [`${grid.x(i)},${grid.z(i)}`, medians[k]]));
  };

  it('plans nothing for a drag that does not move', () => {
    expect(plan(5, 5, 5, 5).size).toBe(0);
  });

  it('puts one half on each side of the grid line, facing each other', () => {
    const m = plan(2, 6, 5, 6); // along x on the line z = 6
    expect(m.size).toBe(6);
    for (let x = 2; x < 5; x++) {
      expect(m.get(`${x},5`)).toBe(S);
      expect(m.get(`${x},6`)).toBe(N);
    }
    const v = plan(4, 9, 4, 7); // along z on the line x = 4, going north
    expect([...v.keys()].sort()).toEqual(['3,7', '3,8', '4,7', '4,8']);
    expect(v.get('3,8')).toBe(E);
    expect(v.get('4,8')).toBe(W);
  });

  it('bends as a 2×2 block: inner tile in both legs, outer tile with no median', () => {
    // East along z = 4 from x = 1 to 6, then south along x = 6 to z = 9 (a right turn).
    const m = plan(1, 4, 6, 9, true);
    expect(m.get('5,4')).toBe(N | E); // inner: south half of the x leg, west half of the z leg
    expect(m.get('6,3')).toBe(0); // outer: in neither leg
    expect(m.get('5,3')).toBe(S);
    expect(m.get('6,4')).toBe(W);
    expect(m.get('5,5')).toBe(E);
    expect(m.size).toBe(2 * 5 + 2 * 5 - 1 + 1);
  });

  it('runs the z leg first when asked', () => {
    const m = plan(1, 4, 6, 9, false); // south along x = 1, then east along z = 9
    expect(m.get('1,8')).toBe(W | S); // inner
    expect(m.get('0,9')).toBe(0); // outer
    expect(m.has('5,3')).toBe(false);
  });

  it('keeps both halves on the map', () => {
    const m = plan(3, 0, 8, 0); // the line z = 0 would put a half off the map
    expect(m.get('3,0')).toBe(S);
    expect(m.get('3,1')).toBe(N);
    expect(m.size).toBe(10);
  });
});
