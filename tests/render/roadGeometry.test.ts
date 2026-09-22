import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { GeometryBuilder } from '../../src/render/procedural/geometryBuilder';
import {
  ROAD_COLORS,
  ROAD_STYLE,
  ROAD_SURFACE,
  Surf,
  appendRoadTile,
  cellSurface,
} from '../../src/render/roads/roadGeometry';

const N = 1;
const E = 2;
const S = 4;
const W = 8;
const { Asphalt: A, Curb: C, Verge: V, Sidewalk: SW } = Surf;
const row = (cz: number, mask: number) =>
  [0, 1, 2, 3, 4, 5, 6].map((cx) => cellSurface(cx, cz, mask));

function build(mask: number, x = 0, z = 0): BufferGeometry {
  const b = new GeometryBuilder();
  appendRoadTile(b, x, z, mask, 0);
  return b.toGeometry();
}

/** Area of upward-facing surface covering the tile at the topmost height per point. */
function topArea(g: BufferGeometry, pred: (y: number, color: [number, number, number]) => boolean) {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('color');
  let area = 0;
  for (let t = 0; t < pos.count; t += 3) {
    if (nor.getY(t) < 0.99) continue;
    const y = pos.getY(t);
    if (!pred(y, [col.getX(t), col.getY(t), col.getZ(t)])) continue;
    const ax = pos.getX(t),
      az = pos.getZ(t);
    const bx = pos.getX(t + 1),
      bz = pos.getZ(t + 1);
    const cx = pos.getX(t + 2),
      cz = pos.getZ(t + 2);
    area += Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2;
  }
  return area;
}

const isColor = (c: [number, number, number], ref: { r: number; g: number; b: number }) =>
  Math.abs(c[0] - ref.r) < 1e-6 && Math.abs(c[1] - ref.g) < 1e-6 && Math.abs(c[2] - ref.b) < 1e-6;

describe('road cell surfaces', () => {
  it('straight north-south road: sidewalk | verge | curb | asphalt | curb | verge | sidewalk', () => {
    for (let cz = 0; cz < 7; cz++) expect(row(cz, N | S)).toEqual([SW, V, C, A, C, V, SW]);
  });

  it('dead end: the platform wraps around the closed end', () => {
    const m = N; // open to the north, closed to the south
    expect(row(6, m)).toEqual([SW, SW, SW, SW, SW, SW, SW]);
    expect(row(5, m)).toEqual([SW, V, V, V, V, V, SW]);
    expect(row(4, m)).toEqual([SW, V, C, C, C, V, SW]);
    expect(row(0, m)).toEqual([SW, V, C, A, C, V, SW]);
  });

  it('crossing: asphalt cross with curbed sidewalk corner pads', () => {
    const m = N | E | S | W;
    for (let i = 0; i < 7; i++) {
      expect(cellSurface(3, i, m)).toBe(A);
      expect(cellSurface(i, 3, m)).toBe(A);
    }
    expect(row(0, m)).toEqual([SW, SW, C, A, C, SW, SW]);
    expect(row(2, m)).toEqual([C, C, C, A, C, C, C]);
  });

  it('never puts grass directly next to asphalt (a curb is always in between)', () => {
    for (let mask = 0; mask < 16; mask++) {
      for (let cz = 0; cz < 7; cz++) {
        for (let cx = 0; cx < 7; cx++) {
          if (cellSurface(cx, cz, mask === 0 ? E | W : mask) !== V) continue;
          for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx > 6 || nz > 6) continue;
            expect(cellSurface(nx, nz, mask === 0 ? E | W : mask)).not.toBe(A);
          }
        }
      }
    }
  });
});

describe('appendRoadTile', () => {
  it('covers the whole tile exactly once with top surfaces (straight and dead end)', () => {
    for (const mask of [N | S, E | W, N, 0, N | E | S | W, N | E]) {
      const g = build(mask);
      const ground = topArea(g, (y, c) => !isColor(c, ROAD_COLORS.centerLine) && y < 0.1);
      expect(ground).toBeCloseTo(1, 6);
    }
  });

  it('draws the double yellow line along the road for its full length', () => {
    const g = build(N | S);
    const lines = topArea(g, (_y, c) => isColor(c, ROAD_COLORS.centerLine));
    expect(lines).toBeCloseTo(2 * ROAD_STYLE.centerLineWidth * 1, 6);
    const dead = build(N);
    expect(topArea(dead, (_y, c) => isColor(c, ROAD_COLORS.centerLine))).toBeCloseTo(
      2 * ROAD_STYLE.centerLineWidth * 0.5,
      6,
    );
  });

  it('merges cells: a straight road is 7 surfaces + 2 lines', () => {
    const b = new GeometryBuilder();
    appendRoadTile(b, 0, 0, E | W, 0);
    // 6 platform boxes (sidewalk, verge, curb per side; top + 4 sides = 10 tris each),
    // 1 asphalt quad and 2 centre lines.
    expect(b.vertexCount / 3).toBe(6 * 10 + 2 + 2 * 2);
  });

  it('tags sidewalk tops with their running direction and verge tops as grass', () => {
    const surfaces = (mask: number) => {
      const g = build(mask);
      const a = g.getAttribute('aSurface');
      const out = new Set<number>();
      for (let i = 0; i < a.count; i++) out.add(a.getX(i));
      return out;
    };
    const ew = surfaces(E | W);
    expect(ew.has(ROAD_SURFACE.SidewalkAlongX)).toBe(true);
    expect(ew.has(ROAD_SURFACE.SidewalkAlongZ)).toBe(false);
    expect(ew.has(ROAD_SURFACE.Verge)).toBe(true);
    const ns = surfaces(N | S);
    expect(ns.has(ROAD_SURFACE.SidewalkAlongZ)).toBe(true);
    expect(ns.has(ROAD_SURFACE.SidewalkAlongX)).toBe(false);
  });

  it('positions the tile in world space and raises sidewalks above the asphalt', () => {
    const g = build(E | W, 10, 20);
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.min.x).toBeCloseTo(10);
    expect(box.max.x).toBeCloseTo(11);
    expect(box.min.z).toBeCloseTo(20);
    expect(box.max.z).toBeCloseTo(21);
    expect(box.max.y).toBeCloseTo(ROAD_STYLE.platformY);
    // The platform stays low: well under 30 cm (0.02 tile units) above the asphalt.
    expect(ROAD_STYLE.platformY - ROAD_STYLE.asphaltY).toBeLessThan(0.02);
  });

  it('winds every triangle to match its normal', () => {
    const g = build(N | E | S | W);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let t = 0; t < pos.count; t += 3) {
      const e1 = [
        pos.getX(t + 1) - pos.getX(t),
        pos.getY(t + 1) - pos.getY(t),
        pos.getZ(t + 1) - pos.getZ(t),
      ];
      const e2 = [
        pos.getX(t + 2) - pos.getX(t),
        pos.getY(t + 2) - pos.getY(t),
        pos.getZ(t + 2) - pos.getZ(t),
      ];
      const cross = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const dot = cross[0] * nor.getX(t) + cross[1] * nor.getY(t) + cross[2] * nor.getZ(t);
      expect(dot).toBeGreaterThan(0);
    }
  });
});
