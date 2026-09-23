import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import {
  Corner,
  ROAD_COLORS,
  ROAD_STYLE,
  ROAD_SURFACE,
  Surf,
  cellSurface,
  curveCorner,
  geometryMask,
} from '../../src/render/roads/roadGeometry';
import { streetTileGeometry } from './roadFixtures';

const N = 1;
const E = 2;
const S = 4;
const W = 8;
const ALL_MASKS = Array.from({ length: 16 }, (_, m) => m);
const { Asphalt: A, Curb: C, Verge: V, Sidewalk: SW, None: X } = Surf;
const { edgeWidth: EDGE, sidewalkWidth: SIDEWALK, vergeWidth: VERGE } = ROAD_STYLE;
const row = (cz: number, mask: number) =>
  [0, 1, 2, 3, 4, 5, 6].map((cx) => cellSurface(cx, cz, mask));

function build(mask: number, x = 0, z = 0): BufferGeometry {
  return streetTileGeometry(mask, x, z);
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
const isMarking = (c: [number, number, number]) =>
  isColor(c, ROAD_COLORS.centerLine) || isColor(c, ROAD_COLORS.stopLine);

type Kind = 'asphalt' | 'curb' | 'verge' | 'sidewalk' | 'center' | 'stop' | 'none';
const KIND_COLORS: [Kind, { r: number; g: number; b: number }][] = [
  ['asphalt', ROAD_COLORS.asphalt],
  ['curb', ROAD_COLORS.curb],
  ['verge', ROAD_COLORS.verge],
  ['sidewalk', ROAD_COLORS.sidewalk],
  ['center', ROAD_COLORS.centerLine],
  ['stop', ROAD_COLORS.stopLine],
];

interface UpTri {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  cx: number;
  cz: number;
  y: number;
  kind: Kind;
  surface: number;
}

function upTriangles(g: BufferGeometry): UpTri[] {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('color');
  const surf = g.getAttribute('aSurface');
  const out: UpTri[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    if (nor.getY(t) < 0.99) continue;
    const c: [number, number, number] = [col.getX(t), col.getY(t), col.getZ(t)];
    const kind = KIND_COLORS.find(([, ref]) => isColor(c, ref))?.[0] ?? 'none';
    out.push({
      ax: pos.getX(t),
      az: pos.getZ(t),
      bx: pos.getX(t + 1),
      bz: pos.getZ(t + 1),
      cx: pos.getX(t + 2),
      cz: pos.getZ(t + 2),
      y: pos.getY(t),
      kind,
      surface: surf.getX(t),
    });
  }
  return out;
}

/** The topmost upward surface at (x, z), or null where the tile shows bare ground. */
function topAt(tris: UpTri[], x: number, z: number): UpTri | null {
  let best: UpTri | null = null;
  for (const t of tris) {
    const d1 = (t.bx - t.ax) * (z - t.az) - (t.bz - t.az) * (x - t.ax);
    const d2 = (t.cx - t.bx) * (z - t.bz) - (t.cz - t.bz) * (x - t.bx);
    const d3 = (t.ax - t.cx) * (z - t.cz) - (t.az - t.cz) * (x - t.cx);
    const inside =
      (d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9) || (d1 <= 1e-9 && d2 <= 1e-9 && d3 <= 1e-9);
    if (inside && (!best || t.y > best.y)) best = t;
  }
  return best;
}
const kindAt = (tris: UpTri[], x: number, z: number): Kind => topAt(tris, x, z)?.kind ?? 'none';

/** Cross-section of a straight street at `t` (0..1 across it), ignoring markings. */
function straightSection(t: number): Kind {
  const e = Math.min(t, 1 - t);
  if (e < SIDEWALK) return 'sidewalk';
  if (e < SIDEWALK + VERGE) return 'verge';
  if (e < EDGE) return 'curb';
  return 'asphalt';
}

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

  it('crossing: asphalt cross, with corners left to the rounded pads', () => {
    const m = N | E | S | W;
    for (let i = 0; i < 7; i++) {
      expect(cellSurface(3, i, m)).toBe(A);
      expect(cellSurface(i, 3, m)).toBe(A);
    }
    expect(row(0, m)).toEqual([X, X, X, A, X, X, X]);
  });

  it('T-junction: the closed side keeps its platform band', () => {
    const m = N | E | S; // closed to the west
    expect(row(0, m)).toEqual([SW, V, C, A, X, X, X]);
    expect(row(3, m)).toEqual([SW, V, C, A, A, A, A]);
    expect(row(6, m)).toEqual([SW, V, C, A, X, X, X]);
  });

  it('curves are drawn entirely from arcs', () => {
    expect(curveCorner(N | E)).toBe(Corner.NE);
    expect(curveCorner(S | E)).toBe(Corner.SE);
    expect(curveCorner(S | W)).toBe(Corner.SW);
    expect(curveCorner(N | W)).toBe(Corner.NW);
    for (const m of [N | S, E | W, N, N | E | S, 15, 0]) expect(curveCorner(m)).toBe(-1);
    expect(row(2, N | E).every((s) => s === X)).toBe(true);
  });
});

describe('appendRoadTile', () => {
  it('covers the whole tile exactly once with top surfaces (all but curves)', () => {
    for (const mask of ALL_MASKS) {
      if (curveCorner(geometryMask(mask)) !== -1) continue;
      const g = build(mask);
      const ground = topArea(g, (y, c) => !isMarking(c) && y < 0.1);
      expect(ground, `mask ${mask}`).toBeCloseTo(1, 6);
    }
  });

  it('curves cover a quarter disc around their inner corner and leave the lot corner bare', () => {
    const seg = ROAD_STYLE.arcSegments;
    const quarterDisc = 0.5 * seg * Math.sin(Math.PI / 2 / seg); // chord polygon, radius 1
    for (const mask of [N | E, E | S, S | W, W | N]) {
      const g = build(mask);
      expect(topArea(g, (y, c) => !isMarking(c) && y < 0.1)).toBeCloseTo(quarterDisc, 6);
    }
    // N|E bends around the north-east corner; the south-west corner is bare ground.
    const tris = upTriangles(build(N | E));
    expect(kindAt(tris, 0.03, 0.97)).toBe('none');
    expect(kindAt(tris, 0.97, 0.03)).toBe('sidewalk');
    expect(kindAt(tris, 0.5, 0.5)).toBe('asphalt');
  });

  it('meets a straight neighbour with the same cross-section on every connected edge', () => {
    for (const mask of ALL_MASKS) {
      const m = geometryMask(mask);
      const tris = upTriangles(build(mask));
      for (let d = 0; d < 4; d++) {
        if ((m & (1 << d)) === 0) continue;
        for (let k = 0; k <= 200; k++) {
          const t = k / 200;
          const expected = straightSection(t);
          // Skip samples right at a band boundary or a tile corner (where a curve's outer
          // arc is a chord short of the corner by a hair).
          const e = Math.min(t, 1 - t);
          if ([0, SIDEWALK, SIDEWALK + VERGE, EDGE].some((b) => Math.abs(e - b) < 0.004)) continue;
          const [x, z] = [
            [t, 0.002],
            [0.998, t],
            [t, 0.998],
            [0.002, t],
          ][d];
          const got = kindAt(tris, x, z);
          const ok = got === expected || (expected === 'asphalt' && got === 'center');
          expect(ok, `mask ${mask} side ${d} t=${t}: ${got} vs ${expected}`).toBe(true);
        }
      }
    }
  });

  it('never puts grass directly next to asphalt (a curb is always in between)', () => {
    const steps = 80;
    for (const mask of ALL_MASKS) {
      const tris = upTriangles(build(mask));
      const grid: Kind[] = [];
      for (let j = 0; j < steps; j++) {
        for (let i = 0; i < steps; i++) {
          grid.push(kindAt(tris, (i + 0.5) / steps, (j + 0.5) / steps));
        }
      }
      const road = (k: Kind) => k === 'asphalt' || k === 'center' || k === 'stop';
      for (let j = 0; j < steps; j++) {
        for (let i = 0; i < steps; i++) {
          if (grid[j * steps + i] !== 'verge') continue;
          if (i > 0) expect(road(grid[j * steps + i - 1]), `mask ${mask}`).toBe(false);
          if (i < steps - 1) expect(road(grid[j * steps + i + 1]), `mask ${mask}`).toBe(false);
          if (j > 0) expect(road(grid[(j - 1) * steps + i]), `mask ${mask}`).toBe(false);
          if (j < steps - 1) expect(road(grid[(j + 1) * steps + i]), `mask ${mask}`).toBe(false);
        }
      }
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

  it('bends the double yellow line with a curve', () => {
    const tris = upTriangles(build(S | W)); // bends around the south-west corner
    const r = 0.5 + ROAD_STYLE.centerLineGap / 2 + ROAD_STYLE.centerLineWidth / 2;
    const a = Math.PI / 5;
    expect(kindAt(tris, r * Math.cos(a), 1 - r * Math.sin(a))).toBe('center');
    expect(kindAt(tris, 0.5 * Math.cos(a), 1 - 0.5 * Math.sin(a))).toBe('asphalt'); // the gap
    const len = (Math.PI / 2) * 0.5;
    const area = topArea(build(S | W), (_y, c) => isColor(c, ROAD_COLORS.centerLine));
    expect(area).toBeCloseTo(2 * ROAD_STYLE.centerLineWidth * len, 2);
  });

  it('keeps junction boxes free of centre lines', () => {
    for (const mask of [N | E | S, E | S | W, N | E | S | W]) {
      const tris = upTriangles(build(mask));
      for (let j = 0; j < 60; j++) {
        for (let i = 0; i < 60; i++) {
          const x = (i + 0.5) / 60;
          const z = (j + 0.5) / 60;
          const inBox = x > EDGE && x < 1 - EDGE && z > EDGE && z < 1 - EDGE;
          if (inBox) expect(kindAt(tris, x, z), `mask ${mask}`).toBe('asphalt');
        }
      }
    }
  });

  it('puts stop lines across the incoming lane of a T stem and of every crossing approach', () => {
    const { stopLineWidth, stopLineInset, centerLineGap, centerLineWidth } = ROAD_STYLE;
    const at = EDGE - stopLineInset - stopLineWidth / 2; // distance of the stop line from the edge
    const laneWidth = 0.5 - centerLineGap / 2 - centerLineWidth - EDGE;
    const stopArea = (mask: number) =>
      topArea(build(mask), (_y, c) => isColor(c, ROAD_COLORS.stopLine));

    for (const mask of [N | S, E | W, N, N | E, 0]) expect(stopArea(mask)).toBe(0);
    expect(stopArea(N | E | S)).toBeCloseTo(stopLineWidth * laneWidth, 6);
    expect(stopArea(15)).toBeCloseTo(4 * stopLineWidth * laneWidth, 6);

    // T closed to the west: the stem is east; westbound drivers keep to the north half.
    const tee = upTriangles(build(N | E | S));
    expect(kindAt(tee, 1 - at, 0.3)).toBe('stop');
    expect(kindAt(tee, 1 - at, 0.7)).toBe('asphalt');
    expect(kindAt(tee, 0.3, at)).toBe('asphalt'); // through road: no stop

    const cross = upTriangles(build(15));
    expect(kindAt(cross, 0.3, at)).toBe('stop'); // southbound from the north: west half
    expect(kindAt(cross, 0.7, at)).toBe('asphalt');
    expect(kindAt(cross, 0.7, 1 - at)).toBe('stop'); // northbound from the south: east half
    expect(kindAt(cross, at, 0.7)).toBe('stop'); // eastbound from the west: south half
    expect(kindAt(cross, 1 - at, 0.3)).toBe('stop'); // westbound from the east: north half
  });

  it('rounds junction corners: grass and sidewalk wrap around the tile corner', () => {
    const tris = upTriangles(build(15));
    // Along the diagonal from the north-west corner: sidewalk, verge, curb, then asphalt.
    const diag = (r: number) => kindAt(tris, r / Math.SQRT2, r / Math.SQRT2);
    expect(diag(0.04)).toBe('sidewalk');
    expect(diag(0.115)).toBe('verge');
    expect(diag(0.1525)).toBe('curb');
    expect(diag(0.2)).toBe('asphalt');
  });

  it('merges cells: a straight road is 7 surfaces + 2 lines', () => {
    // 6 platform boxes (sidewalk, verge, curb per side), 1 asphalt quad and 2 centre
    // lines. Boxes keep only the walls that can show: the sidewalk's outer wall and the
    // curb's face toward the asphalt (2 tris each); the rest is inside the platform or
    // continues into the neighbouring tiles.
    expect(build(E | W).getAttribute('position').count / 3).toBe(6 * 2 + 2 * 2 * 2 + 2 + 2 * 2);
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

    // Curved sidewalks carry the corner they bend around.
    expect([...surfaces(S | E)].sort()).toEqual(
      [
        ROAD_SURFACE.Plain,
        ROAD_SURFACE.Verge,
        ROAD_SURFACE.SidewalkArc + Corner.SE,
        ROAD_SURFACE.SidewalkPad + Corner.SE,
      ].sort(),
    );
    const cross = surfaces(15);
    for (const q of [Corner.NW, Corner.NE, Corner.SE, Corner.SW]) {
      expect(cross.has(ROAD_SURFACE.SidewalkPad + q)).toBe(true);
    }
    const tee = surfaces(N | E | S);
    expect(tee.has(ROAD_SURFACE.SidewalkPad + Corner.NE)).toBe(true);
    expect(tee.has(ROAD_SURFACE.SidewalkPad + Corner.SE)).toBe(true);
    expect(tee.has(ROAD_SURFACE.SidewalkPad + Corner.NW)).toBe(false);
  });

  it('positions the tile in world space and raises sidewalks above the asphalt', () => {
    for (const mask of [E | W, N | E, 15]) {
      const g = build(mask, 10, 20);
      g.computeBoundingBox();
      const box = g.boundingBox!;
      expect(box.min.x).toBeCloseTo(10);
      expect(box.max.x).toBeCloseTo(11);
      expect(box.min.z).toBeCloseTo(20);
      expect(box.max.z).toBeCloseTo(21);
      expect(box.max.y).toBeCloseTo(ROAD_STYLE.platformY);
    }
    // The platform stays low: well under 30 cm (0.02 tile units) above the asphalt.
    expect(ROAD_STYLE.platformY - ROAD_STYLE.asphaltY).toBeLessThan(0.02);
  });

  it('winds every triangle to match its normal', () => {
    for (const mask of ALL_MASKS) {
      const g = build(mask);
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
        expect(dot, `mask ${mask}`).toBeGreaterThan(0);
      }
    }
  });

  it('faces the curved curbs toward the asphalt', () => {
    // Every vertical triangle of an N|E curve at the inner curb (radius 0.16 around the
    // north-east corner) faces away from that corner; at the outer curb it faces it.
    const g = build(N | E);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    let inner = 0;
    let outer = 0;
    for (let t = 0; t < pos.count; t += 3) {
      if (Math.abs(nor.getY(t)) > 0.01) continue;
      const mx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3 - 1;
      const mz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
      const r = Math.hypot(mx, mz);
      const radial = (nor.getX(t) * mx + nor.getZ(t) * mz) / r;
      if (Math.abs(r - EDGE) < 0.01) {
        expect(radial).toBeGreaterThan(0.9);
        inner++;
      } else if (Math.abs(r - (1 - EDGE)) < 0.01) {
        expect(radial).toBeLessThan(-0.9);
        outer++;
      }
    }
    expect(inner).toBeGreaterThan(0);
    expect(outer).toBeGreaterThan(0);
  });
});
