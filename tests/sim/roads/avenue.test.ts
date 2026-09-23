import { describe, expect, it } from 'vitest';
import { ROADS } from '../../../src/config';
import {
  curveInnerOf,
  expandAvenueRemoval,
  isCurveInner,
  isMedianOpen,
  isValidMedian,
} from '../../../src/sim/roads/avenue';
import { Simulation } from '../../../src/sim/simulation';
import { World } from '../../../src/sim/world';

const N = 1;
const E = 2;
const S = 4;
const W = 8;

function makeSim() {
  const world = new World({ size: 64, chunkSize: 16, seed: 1 });
  const sim = new Simulation(world);
  const idx = (x: number, z: number) => world.grid.index(x, z);
  const avenue = (ax: number, az: number, bx: number, bz: number, xFirst = true) =>
    sim.execute({
      type: 'buildRoad',
      roadType: ROADS.avenue.id,
      from: { x: ax, z: az },
      to: { x: bx, z: bz },
      xFirst,
    });
  const street = (ax: number, az: number, bx: number, bz: number) =>
    sim.execute({
      type: 'buildRoad',
      roadType: ROADS.street.id,
      from: { x: ax, z: az },
      to: { x: bx, z: bz },
    });
  return { world, sim, idx, avenue, street };
}

describe('avenue topology', () => {
  it('accepts up to two perpendicular median bits', () => {
    for (const bits of [0, N, E, N | E, S | W]) expect(isValidMedian(bits)).toBe(true);
    for (const bits of [N | S, E | W, N | E | S, 15]) expect(isValidMedian(bits)).toBe(false);
  });

  it('recognises a smooth curve from any of its four tiles', () => {
    const { world, idx, avenue } = makeSim();
    avenue(10, 20, 20, 30, true); // east along z = 20, then south along x = 20
    const inner = idx(19, 20);
    expect(isCurveInner(world, inner)).toBe(true);
    for (const [x, z] of [
      [19, 20],
      [20, 20],
      [19, 19],
      [20, 19],
    ]) {
      expect(curveInnerOf(world, idx(x, z))).toBe(inner);
    }
    expect(curveInnerOf(world, idx(15, 19))).toBe(-1); // a plain half of the x leg
  });

  it('turns a curve into a junction when a road joins it from outside', () => {
    const { world, idx, avenue, street } = makeSim();
    avenue(10, 20, 20, 30, true);
    street(21, 19, 24, 19); // joins the outer tile (20, 19) on its east side
    expect(curveInnerOf(world, idx(19, 20))).toBe(-1);
    expect(isMedianOpen(world, idx(19, 20), 0)).toBe(true);
  });

  it('keeps the median closed along a plain avenue and opens it where a street crosses', () => {
    const { world, idx, avenue, street } = makeSim();
    avenue(4, 10, 30, 10); // halves on rows 9 (north) and 10 (south)
    expect(isMedianOpen(world, idx(12, 9), 2)).toBe(false);
    street(12, 2, 12, 5); // not touching yet
    street(12, 6, 12, 8); // now joins the north half at (12, 9) from the north
    expect(isMedianOpen(world, idx(12, 9), 2)).toBe(true); // its own outer side
    expect(isMedianOpen(world, idx(12, 10), 0)).toBe(true); // its partner's outer side
    expect(isMedianOpen(world, idx(13, 9), 2)).toBe(false);
  });

  it('removes avenues in whole slices, curve blocks and junction boxes', () => {
    const { world, idx, avenue } = makeSim();
    avenue(4, 10, 30, 10);
    avenue(20, 2, 20, 20); // crosses: junction box on (19..20, 9..10)
    const one = new Set([idx(8, 9)]);
    expandAvenueRemoval(world, one);
    expect([...one].sort()).toEqual([idx(8, 9), idx(8, 10)].sort());

    const box = new Set([idx(19, 9)]);
    expandAvenueRemoval(world, box);
    expect([...box].sort()).toEqual([idx(19, 9), idx(20, 9), idx(19, 10), idx(20, 10)].sort());

    avenue(40, 40, 50, 50, true);
    const curve = new Set([idx(50, 39)]); // the outer tile
    expandAvenueRemoval(world, curve);
    expect([...curve].sort()).toEqual([idx(49, 39), idx(50, 39), idx(49, 40), idx(50, 40)].sort());
  });
});

describe('Simulation: avenues', () => {
  it('builds both halves with facing median bits and charges avenue cost', () => {
    const { world, idx, avenue } = makeSim();
    const res = avenue(4, 10, 8, 10);
    expect(res.ok).toBe(true);
    expect(res.tilesChanged).toBe(8);
    expect(res.cost).toBe(8 * ROADS.avenue.costPerTile);
    expect(world.roadMedian[idx(5, 9)]).toBe(S);
    expect(world.roadMedian[idx(5, 10)]).toBe(N);
    // Halves connect to each other and along the avenue.
    expect(world.roadMask[idx(5, 9)]).toBe(E | W | S);
    expect(world.roadMask[idx(4, 10)]).toBe(E | N);
  });

  it('adds median bits where avenues cross and rejects overlapping ones', () => {
    const { world, idx, avenue } = makeSim();
    avenue(4, 10, 30, 10);
    expect(avenue(20, 2, 20, 20).ok).toBe(true);
    expect(world.roadMedian[idx(19, 9)]).toBe(S | E);
    expect(world.roadMedian[idx(20, 10)]).toBe(N | W);

    const before = world.road.slice();
    const res = avenue(4, 11, 12, 11); // one row further south: overlaps the south half
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/overlap/);
    expect(world.road).toEqual(before);
  });

  it('upgrades streets under an avenue, and never downgrades an avenue to a street', () => {
    const { world, idx, avenue, street } = makeSim();
    street(10, 4, 10, 16);
    avenue(6, 10, 14, 10);
    expect(world.road[idx(10, 9)]).toBe(ROADS.avenue.id);
    expect(world.road[idx(10, 10)]).toBe(ROADS.avenue.id);
    expect(world.road[idx(10, 8)]).toBe(ROADS.street.id);

    const res = street(8, 6, 8, 14); // crosses the avenue
    expect(world.road[idx(8, 9)]).toBe(ROADS.avenue.id);
    expect(world.roadMedian[idx(8, 9)]).toBe(S);
    expect(res.tilesChanged).toBe(9 - 2);
  });

  it('bulldozes whole slices and marks chunks around them dirty', () => {
    const { world, sim, idx, avenue } = makeSim();
    avenue(4, 10, 30, 10);
    const res = sim.execute({ type: 'bulldoze', from: { x: 15, z: 9 }, to: { x: 15, z: 9 } });
    expect(res.tilesChanged).toBe(2);
    expect(world.road[idx(15, 10)]).toBe(0);
    // Its neighbours are now dead ends; their median bits still pair them up.
    expect(world.roadMedian[idx(14, 9)]).toBe(S);
    expect(world.roadMask[idx(14, 9)]).toBe(W | S);
    // (15, 9) sits 1 tile from chunk 0's edge: pieces up to 3 tiles away can change.
    expect(res.changes.dirtyChunks).toContain(world.grid.chunkOf(17, 9));
  });

  it('builds a smooth curve with an L-shaped drag', () => {
    const { world, idx, avenue } = makeSim();
    const res = avenue(10, 20, 20, 30, true);
    expect(res.tilesChanged).toBe(2 * 10 + 2 * 10);
    expect(world.roadMedian[idx(20, 19)]).toBe(0);
    expect(isCurveInner(world, idx(19, 20))).toBe(true);
  });
});
