import { describe, expect, it, vi } from 'vitest';
import { ROADS } from '../../src/config';
import { Simulation } from '../../src/sim/simulation';
import { World } from '../../src/sim/world';

const STREET = ROADS.street.id;
const N = 1;
const E = 2;
const S = 4;
const W = 8;

function makeSim() {
  const world = new World({ size: 64, chunkSize: 16, seed: 1 });
  return { world, sim: new Simulation(world) };
}

function build(sim: Simulation, ax: number, az: number, bx: number, bz: number) {
  return sim.execute({
    type: 'buildRoad',
    roadType: STREET,
    from: { x: ax, z: az },
    to: { x: bx, z: bz },
  });
}

describe('Simulation: buildRoad', () => {
  it('places a straight street and reports tiles and cost', () => {
    const { world, sim } = makeSim();
    const res = build(sim, 2, 5, 6, 5);
    expect(res.ok).toBe(true);
    expect(res.tilesChanged).toBe(5);
    expect(res.cost).toBe(5 * ROADS.street.costPerTile);
    for (let x = 2; x <= 6; x++) expect(world.road[world.grid.index(x, 5)]).toBe(STREET);
    expect(world.road[world.grid.index(7, 5)]).toBe(0);
  });

  it('computes connection masks: ends are dead ends, the middle is straight', () => {
    const { world, sim } = makeSim();
    build(sim, 2, 5, 4, 5);
    const m = (x: number, z: number) => world.roadMask[world.grid.index(x, z)];
    expect(m(2, 5)).toBe(E);
    expect(m(3, 5)).toBe(E | W);
    expect(m(4, 5)).toBe(W);
  });

  it('connects crossing roads and updates the existing tile it meets', () => {
    const { world, sim } = makeSim();
    build(sim, 0, 10, 20, 10); // east-west
    build(sim, 10, 5, 10, 15); // north-south through it
    const m = (x: number, z: number) => world.roadMask[world.grid.index(x, z)];
    expect(m(10, 10)).toBe(N | E | S | W);
    expect(m(10, 9)).toBe(N | S);
    expect(m(9, 10)).toBe(E | W);
  });

  it('builds an L-shaped road whose bend is a corner piece', () => {
    const { world, sim } = makeSim();
    const m = (x: number, z: number) => world.roadMask[world.grid.index(x, z)];
    const res = sim.execute({
      type: 'buildRoad',
      roadType: STREET,
      from: { x: 2, z: 2 },
      to: { x: 5, z: 6 },
      xFirst: true,
    });
    expect(res.tilesChanged).toBe(4 + 4);
    expect(m(2, 2)).toBe(E);
    expect(m(5, 2)).toBe(W | S);
    expect(m(5, 4)).toBe(N | S);
    expect(m(5, 6)).toBe(N);
    expect(world.road[world.grid.index(2, 6)]).toBe(0);

    const zFirst = sim.execute({
      type: 'buildRoad',
      roadType: STREET,
      from: { x: 10, z: 2 },
      to: { x: 13, z: 6 },
      xFirst: false,
    });
    expect(zFirst.tilesChanged).toBe(8);
    expect(m(10, 6)).toBe(N | E);
  });

  it('turns existing roads into T-junctions where an L-drag branches off', () => {
    const { world, sim } = makeSim();
    const m = (x: number, z: number) => world.roadMask[world.grid.index(x, z)];
    build(sim, 0, 5, 10, 5);
    // Starts on the existing road, runs along it, then turns south.
    const res = sim.execute({
      type: 'buildRoad',
      roadType: STREET,
      from: { x: 2, z: 5 },
      to: { x: 12, z: 8 },
      xFirst: true,
    });
    expect(res.tilesChanged).toBe(2 + 3);
    expect(m(10, 5)).toBe(E | W);
    expect(m(12, 5)).toBe(W | S);
    build(sim, 4, 5, 4, 8);
    expect(m(4, 5)).toBe(E | S | W);
  });

  it('only charges for new tiles and reports no change when nothing is new', () => {
    const { sim } = makeSim();
    build(sim, 0, 0, 9, 0);
    const again = build(sim, 5, 0, 12, 0);
    expect(again.tilesChanged).toBe(3);
    expect(again.cost).toBe(3 * ROADS.street.costPerTile);
    const onChanges = vi.fn();
    sim.events.on('changes', onChanges);
    const none = build(sim, 0, 0, 5, 0);
    expect(none.tilesChanged).toBe(0);
    expect(onChanges).not.toHaveBeenCalled();
  });

  it('marks neighbouring chunks dirty when a road ends at a chunk border', () => {
    const { world, sim } = makeSim();
    // Road in chunk 0 ending at x = 15; its neighbour x = 16 lies in chunk 1.
    const res = build(sim, 10, 3, 15, 3);
    expect(res.changes.dirtyChunks).toContain(world.grid.chunkOf(10, 3));
    expect(res.changes.dirtyChunks).toContain(world.grid.chunkOf(16, 3));
  });

  it('emits a change set with the affected road tiles', () => {
    const { world, sim } = makeSim();
    const onChanges = vi.fn();
    sim.events.on('changes', onChanges);
    build(sim, 1, 1, 1, 3);
    expect(onChanges).toHaveBeenCalledTimes(1);
    const cs = onChanges.mock.calls[0][0];
    expect(cs.roadTiles).toEqual(expect.arrayContaining([world.grid.index(1, 1)]));
  });

  it('rejects unknown road types', () => {
    const { sim } = makeSim();
    const res = sim.execute({
      type: 'buildRoad',
      roadType: 99,
      from: { x: 0, z: 0 },
      to: { x: 3, z: 0 },
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/Unknown road type/);
  });
});

describe('Simulation: bulldoze', () => {
  it('clears roads in the rectangle and fixes neighbouring masks', () => {
    const { world, sim } = makeSim();
    build(sim, 0, 4, 10, 4);
    const res = sim.execute({ type: 'bulldoze', from: { x: 4, z: 2 }, to: { x: 6, z: 6 } });
    expect(res.tilesChanged).toBe(3);
    for (let x = 4; x <= 6; x++) expect(world.road[world.grid.index(x, 4)]).toBe(0);
    expect(world.roadMask[world.grid.index(3, 4)]).toBe(W); // now a dead end
    expect(world.roadMask[world.grid.index(7, 4)]).toBe(E);
    expect(world.roadMask[world.grid.index(5, 4)]).toBe(0);
  });

  it('does nothing on empty land', () => {
    const { sim } = makeSim();
    const onChanges = vi.fn();
    sim.events.on('changes', onChanges);
    const res = sim.execute({ type: 'bulldoze', from: { x: 0, z: 0 }, to: { x: 5, z: 5 } });
    expect(res.tilesChanged).toBe(0);
    expect(onChanges).not.toHaveBeenCalled();
  });
});
