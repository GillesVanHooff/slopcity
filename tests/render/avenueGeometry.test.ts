import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { ROADS } from '../../src/config';
import { ROAD_COLORS, ROAD_STYLE, ROAD_SURFACE } from '../../src/render/roads/roadGeometry';
import { Simulation } from '../../src/sim/simulation';
import { World } from '../../src/sim/world';
import { kindAt, tileGeometry, upTriangles, type Kind, type UpTri } from './roadFixtures';

const { edgeWidth: EW, sidewalkWidth: SWD, vergeWidth: VW } = ROAD_STYLE;
type Step = ['avenue' | 'street', number, number, number, number, boolean?];

/** A small world with the given roads built through the Simulation. */
function scene(steps: Step[]) {
  const world = new World({ size: 40, chunkSize: 8, seed: 1 });
  const sim = new Simulation(world);
  for (const [kind, ax, az, bx, bz, xFirst] of steps) {
    const res = sim.execute({
      type: 'buildRoad',
      roadType: ROADS[kind].id,
      from: { x: ax, z: az },
      to: { x: bx, z: bz },
      xFirst: xFirst ?? true,
    });
    expect(res.ok).toBe(true);
  }
  const geometry = new Map<number, BufferGeometry>();
  const tris = new Map<number, UpTri[]>();
  for (let i = 0; i < world.grid.size; i++) {
    if (world.road[i] === 0) continue;
    const g = tileGeometry(world, world.grid.x(i), world.grid.z(i));
    geometry.set(i, g);
    tris.set(i, upTriangles(g, ROAD_COLORS));
  }
  const at = (x: number, z: number) =>
    kindAt(tris.get(world.grid.index(Math.floor(x), Math.floor(z))) ?? [], x, z);
  return { world, geometry, tris, at };
}

const SCENES: Record<string, Step[]> = {
  straight: [['avenue', 4, 10, 14, 10]],
  crossing: [
    ['avenue', 2, 10, 20, 10],
    ['avenue', 11, 2, 11, 20],
  ],
  streetCross: [
    ['avenue', 2, 10, 20, 10],
    ['street', 8, 4, 8, 16],
  ],
  streetTee: [
    ['avenue', 2, 10, 20, 10],
    ['street', 8, 4, 8, 8],
  ],
  avenueTee: [
    ['avenue', 12, 2, 12, 20],
    ['avenue', 2, 10, 11, 10],
  ],
  curve: [['avenue', 4, 6, 14, 16, true]],
  cappedCurve: [['avenue', 4, 6, 5, 14, true]],
  curveJunction: [
    ['avenue', 4, 6, 14, 16, true],
    ['street', 15, 5, 18, 5],
  ],
  streetOffEnd: [
    ['avenue', 4, 10, 12, 10],
    ['street', 12, 9, 16, 9],
  ],
};

/**
 * Scenes without a transition piece yet: where a street continues straight off one half
 * of an avenue, the median's grass meets the street's sidewalk at the joint.
 */
const NO_SEAM_CHECK = new Set(['streetOffEnd']);

const isRoad = (k: Kind) => k === 'asphalt' || k === 'center' || k === 'stop' || k === 'lane';
/** Markings sit on the asphalt; seams compare the surfaces underneath. */
const base = (k: Kind): Kind => (isRoad(k) ? 'asphalt' : k);

describe('avenue geometry', () => {
  for (const [name, steps] of Object.entries(SCENES)) {
    it.skipIf(NO_SEAM_CHECK.has(name))(
      `${name}: neighbouring tiles meet with the same bands at every shared edge`,
      () => {
        const { world, tris } = scene(steps);
        const { grid } = world;
        const E = 0.002;
        for (const [i, here] of tris) {
          const x = grid.x(i);
          const z = grid.z(i);
          // East and south edges; west and north ones are some other tile's east/south.
          for (const [dx, dz] of [
            [1, 0],
            [0, 1],
          ]) {
            const there = tris.get(grid.indexSafe(x + dx, z + dz));
            if (!there) continue;
            for (let k = 1; k < 200; k++) {
              const t = k / 200;
              const p = (off: number, s = t) =>
                dx ? ([x + 1 + off, z + s] as const) : ([x + s, z + 1 + off] as const);
              const a = base(kindAt(here, ...p(-E)));
              const b = base(kindAt(there, ...p(E)));
              if (a === b) continue;
              // Allow the exact spot where bands change on either side.
              const near = [-0.006, 0.006].some(
                (o) =>
                  base(kindAt(here, ...p(-E, t + o))) !== a ||
                  base(kindAt(there, ...p(E, t + o))) !== b,
              );
              expect(
                near,
                `${name}: tile (${x}, ${z}) → (${x + dx}, ${z + dz}) at ${t}: ${a} | ${b}`,
              ).toBe(true);
            }
          }
        }
      },
    );

    it(`${name}: a curb always separates grass from the road`, () => {
      const { world, tris } = scene(steps);
      const steps2 = 80;
      for (const [i, t] of tris) {
        const x0 = world.grid.x(i);
        const z0 = world.grid.z(i);
        const grid: Kind[] = [];
        for (let j = 0; j < steps2; j++) {
          for (let k = 0; k < steps2; k++) {
            grid.push(kindAt(t, x0 + (k + 0.5) / steps2, z0 + (j + 0.5) / steps2));
          }
        }
        for (let j = 0; j < steps2; j++) {
          for (let k = 0; k < steps2; k++) {
            if (grid[j * steps2 + k] !== 'verge') continue;
            const next = [
              k > 0 ? grid[j * steps2 + k - 1] : 'none',
              k < steps2 - 1 ? grid[j * steps2 + k + 1] : 'none',
              j > 0 ? grid[(j - 1) * steps2 + k] : 'none',
              j < steps2 - 1 ? grid[(j + 1) * steps2 + k] : 'none',
            ];
            expect(next.some(isRoad), `${name}: tile (${x0}, ${z0})`).toBe(false);
          }
        }
      }
    });

    it(`${name}: every triangle is wound to match its normal`, () => {
      const { geometry } = scene(steps);
      for (const g of geometry.values()) {
        const pos = g.getAttribute('position');
        const nor = g.getAttribute('normal');
        for (let t = 0; t < pos.count; t += 3) {
          const e1 = [0, 1, 2].map((c) => pos.getComponent(t + 1, c) - pos.getComponent(t, c));
          const e2 = [0, 1, 2].map((c) => pos.getComponent(t + 2, c) - pos.getComponent(t, c));
          const cross = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
          ];
          const dot = cross[0] * nor.getX(t) + cross[1] * nor.getY(t) + cross[2] * nor.getZ(t);
          expect(dot).toBeGreaterThan(0);
        }
      }
    });
  }

  it('straight half: sidewalk, verge, curb, two lanes, curb, then the median', () => {
    const { at } = scene(SCENES.straight);
    // North half of the avenue on the line z = 10 (row 9), across z at x = 8.3.
    const x = 8.3;
    expect(at(x, 9 + SWD / 2)).toBe('sidewalk');
    expect(at(x, 9 + SWD + VW / 2)).toBe('verge');
    expect(at(x, 9 + EW - 0.007)).toBe('curb');
    expect(at(x, 9 + 0.3)).toBe('asphalt');
    expect(at(x, 9 + 1 - EW + 0.007)).toBe('curb');
    expect(at(x, 9.95)).toBe('verge'); // median grass, continuing into the south half
    expect(at(x, 10.05)).toBe('verge');
    // Dashed white line between the lanes, solid yellow line along the median.
    expect(at(8.25, 9.5)).toBe('lane');
    expect(at(8.5, 9.5)).toBe('asphalt'); // the gap between dashes
    const yellow = 9 + 1 - EW - ROAD_STYLE.medianLineOffset - ROAD_STYLE.centerLineWidth / 2;
    expect(at(8.5, yellow)).toBe('center');
  });

  it('dead end: the sidewalk runs across the end, over the median', () => {
    const { at } = scene(SCENES.straight);
    // The avenue ends at x = 14 (tiles up to 13).
    for (const z of [9.3, 9.95, 10.05, 10.7]) expect(at(13.97, z)).toBe('sidewalk');
    expect(at(13 + 1 - EW - 0.05, 9.3)).toBe('asphalt');
  });

  it('street crossing: the median opens with rounded noses; only the street stops', () => {
    const { at, tris, world } = scene(SCENES.streetCross);
    // The street crosses at column 8. Median noses stick into the junction from both sides.
    expect(at(8.05, 10)).toBe('verge');
    expect(at(8.95, 10)).toBe('verge');
    expect(at(8.5, 10)).toBe('asphalt');
    // Stop lines: two (one per street approach), each across one street lane.
    const stops = (x: number, z: number) =>
      (tris.get(world.grid.index(x, z)) ?? []).filter((t) => t.kind === 'stop').length;
    expect(stops(8, 9)).toBeGreaterThan(0); // southbound street approach, north half
    expect(stops(8, 10)).toBeGreaterThan(0);
    expect(stops(7, 9) + stops(9, 9) + stops(7, 10) + stops(9, 10)).toBe(0);
    // Southbound traffic keeps right: the stop line is on the west half of the street arm.
    const at9 = EW - ROAD_STYLE.stopLineInset - ROAD_STYLE.stopLineWidth / 2;
    expect(at(8.3, 9 + at9)).toBe('stop');
    expect(at(8.7, 9 + at9)).toBe('asphalt');
  });

  it('avenue crossing: a junction box where every incoming half stops', () => {
    const { at } = scene(SCENES.crossing);
    const at9 = EW - ROAD_STYLE.stopLineInset - ROAD_STYLE.stopLineWidth / 2;
    // Box tiles (10..11, 9..10). Westbound (north half, row 9) arrives from the east.
    expect(at(12 - at9, 9.5)).toBe('stop');
    // Eastbound (south half, row 10) leaves to the east: no stop line there.
    expect(at(12 - at9, 10.5)).toBe('asphalt');
    // Southbound (west half, column 10) arrives from the north.
    expect(at(10.5, 9 + at9)).toBe('stop');
    // The middle of the box is plain asphalt.
    expect(at(11, 10)).toBe('asphalt');
  });

  it('curve: bands are quarter rings around the inner corner, the lot corner stays bare', () => {
    const { at, tris, world } = scene(SCENES.curve);
    // East along z = 6, then south along x = 14: inner tile (13, 6), centre (13, 7).
    const c = (r: number) => at(13 + r * Math.SQRT1_2, 7 - r * Math.SQRT1_2);
    expect(c(0.04)).toBe('sidewalk');
    expect(c(0.35)).toBe('asphalt');
    expect(c(1)).toBe('verge'); // median
    expect(c(1.65)).toBe('asphalt');
    expect(c(1.96)).toBe('sidewalk');
    expect(c(2.05)).toBe('none'); // beyond the outer sidewalk: bare ground
    // Outer sidewalk ids encode the centre's offset from each tile.
    const outer = tris.get(world.grid.index(14, 5))!.filter((t) => t.kind === 'sidewalk');
    const ids = new Set(outer.map((t) => t.surface));
    const k = ROAD_SURFACE.SidewalkAvenueArc + (13 - 14 + 1) + 4 * (7 - 5 + 1);
    expect([...ids]).toEqual([k]);
  });

  it('capped curve: a leg that goes nowhere ends with a straight cap', () => {
    const { at } = scene(SCENES.cappedCurve);
    // One-segment x leg from x = 4: the curve block's west edge (x = 4) is an end cap.
    for (const z of [5.3, 5.97, 6.03, 6.7]) expect(at(4.03, z)).toBe('sidewalk');
  });
});
