/**
 * Procedural road tile geometry: SimCity 4–style American street, one tile (≈16 m)
 * wide, one lane each way with a double yellow centre line.
 *
 * Cross-section from the tile edge inward, on every side without a road connection. The
 * sidewalk, grass verge and curb form one raised platform (≈20 cm above the asphalt):
 *
 *   | sidewalk | grass verge | curb | asphalt ... asphalt | curb | grass verge | sidewalk |
 *   0        0.085         0.145  0.16                  0.84   0.855        0.915        1
 *
 * Pieces by connection mask:
 *  - Straight and dead end: the tile is split into a 7×7 grid of cells at those
 *    boundaries, each cell gets a surface from the mask, and equal neighbouring cells are
 *    merged into larger rectangles to keep the triangle count low. The platform wraps
 *    around a dead end.
 *  - Curve (two adjacent connections): the whole road bends as a quarter circle around the
 *    inner tile corner, like SC4. Every band keeps its width, so the bands meet the
 *    straight neighbours exactly at the tile edges. The lot-side corner beyond the outer
 *    sidewalk stays bare ground.
 *  - T-junction and crossing: cell grid as above, except that each corner between two
 *    connected sides is a rounded pad. The pad is the same bands as quarter rings around
 *    the tile corner (grass wraps the corner), with asphalt filling the rest of the
 *    corner. No centre line inside the junction; white stop lines on the T's stem and on
 *    every approach of a crossing (all-way stop).
 *
 * Sidewalk and verge tops are tagged with a surface id so the road material can draw
 * concrete slabs and grass procedurally (see roadMaterial.ts).
 */

import { Color } from 'three';
import { DIR_BIT, Dir } from '../../core/grid';
import type { GeometryBuilder } from '../procedural/geometryBuilder';

/** Distances from the tile edge (tile units) and heights above the ground. */
export const ROAD_STYLE = {
  sidewalkWidth: 0.085,
  vergeWidth: 0.06,
  curbWidth: 0.015,
  /** Sidewalk + verge + curb; the asphalt starts here. */
  edgeWidth: 0.16,
  /** Double yellow centre line: width of each line and the gap between them. */
  centerLineWidth: 0.014,
  centerLineGap: 0.014,
  /** White stop line across the incoming lane, set back from the junction box. */
  stopLineWidth: 0.02,
  stopLineInset: 0.01,
  /** Segments per quarter circle for curves and rounded corners (low-poly look). */
  arcSegments: 10,
  asphaltY: 0.02,
  markingY: 0.028,
  /** Top of the sidewalk platform (curb, verge, sidewalk). */
  platformY: 0.034,
} as const;

export const ROAD_COLORS = {
  asphalt: new Color(0x2a2c2f),
  curb: new Color(0xc9c5bb),
  verge: new Color(0x4f7f2e),
  sidewalk: new Color(0xc2bcb0),
  centerLine: new Color(0xe2b53a),
  stopLine: new Color(0xe6e4dc),
} as const;

/** Tile corners, in the order used by corner-relative surface ids. */
export const Corner = { NW: 0, NE: 1, SE: 2, SW: 3 } as const;
export type Corner = (typeof Corner)[keyof typeof Corner];

/** Offset of each corner from the tile origin (x, z). */
export const CORNER_DX: readonly number[] = [0, 1, 1, 0];
export const CORNER_DZ: readonly number[] = [0, 0, 1, 1];

/**
 * Surface ids written to the `aSurface` vertex attribute, read by the road material.
 * Sidewalk slabs need to know which way the sidewalk runs; curved sidewalks add the
 * corner they curve around (0..3, see Corner) so the slab joints can point at it.
 */
export const ROAD_SURFACE = {
  Plain: 0,
  SidewalkAlongX: 1,
  SidewalkAlongZ: 2,
  Verge: 3,
  /** Outer sidewalk of a curve: SidewalkArc + corner. */
  SidewalkArc: 4,
  /** Quarter-disc sidewalk of a rounded corner pad: SidewalkPad + corner. */
  SidewalkPad: 8,
} as const;

/** Slabs per quarter circle on curved sidewalks (the outer one is ≈1.5 tiles long). */
export const ROAD_ARC_SLABS = { arc: 12, pad: 1 } as const;

/** Surface of one cell of the 7×7 grid. `None` cells are drawn by a rounded pad instead. */
export const Surf = { Asphalt: 0, Curb: 1, Verge: 2, Sidewalk: 3, None: 4 } as const;
export type Surf = (typeof Surf)[keyof typeof Surf];

const {
  sidewalkWidth: SW,
  vergeWidth: VW,
  edgeWidth: EW,
  arcSegments: SEGMENTS,
  platformY: PLATFORM_Y,
} = ROAD_STYLE;
/** Cell boundaries along each axis (7 cells). */
const EDGES = [0, SW, SW + VW, EW, 1 - EW, 1 - SW - VW, 1 - SW, 1] as const;
const CELLS = 7;
const MID = 3;
/** Platform layer by distance from the tile edge: 0 sidewalk, 1 verge, 2 curb. */
const LAYER_SURF: readonly Surf[] = [Surf.Sidewalk, Surf.Verge, Surf.Curb];

// Double yellow line: offsets of the two lines from the road's centre axis.
const HALF_GAP = ROAD_STYLE.centerLineGap / 2;
const LINE_A0 = 0.5 - HALF_GAP - ROAD_STYLE.centerLineWidth;
const LINE_A1 = 0.5 - HALF_GAP;
const LINE_B0 = 0.5 + HALF_GAP;
const LINE_B1 = 0.5 + HALF_GAP + ROAD_STYLE.centerLineWidth;

// Scratch cell grid and visited flags (indexed [z * CELLS + x]).
const cells = new Uint8Array(CELLS * CELLS);
const used = new Uint8Array(CELLS * CELLS);

/**
 * Unit vectors of the quarter circle around each corner, pointing into the tile, from
 * one tile edge to the other: corner q spans angles q·90° .. (q+1)·90° (x east, z south).
 * Snapped so the arc ends lie exactly on the tile edges.
 */
const ARC_COS = new Float64Array(4 * (SEGMENTS + 1));
const ARC_SIN = new Float64Array(4 * (SEGMENTS + 1));
for (let q = 0; q < 4; q++) {
  for (let k = 0; k <= SEGMENTS; k++) {
    const a = ((q + k / SEGMENTS) * Math.PI) / 2;
    ARC_COS[q * (SEGMENTS + 1) + k] = Math.round(Math.cos(a) * 1e12) / 1e12;
    ARC_SIN[q * (SEGMENTS + 1) + k] = Math.round(Math.sin(a) * 1e12) / 1e12;
  }
}

/**
 * Connection mask used for geometry. An isolated tile (mask 0) is drawn as an east-west
 * street so a single placed tile still reads as a road.
 */
export function geometryMask(mask: number): number {
  return mask === 0 ? DIR_BIT[Dir.E] | DIR_BIT[Dir.W] : mask;
}

/**
 * The corner a curve bends around, or -1 when the mask isn't a curve (exactly two
 * adjacent connections).
 */
export function curveCorner(mask: number): number {
  switch (mask) {
    case DIR_BIT[Dir.N] | DIR_BIT[Dir.W]:
      return Corner.NW;
    case DIR_BIT[Dir.N] | DIR_BIT[Dir.E]:
      return Corner.NE;
    case DIR_BIT[Dir.S] | DIR_BIT[Dir.E]:
      return Corner.SE;
    case DIR_BIT[Dir.S] | DIR_BIT[Dir.W]:
      return Corner.SW;
    default:
      return -1;
  }
}

/** One past the last cell of the band (pad side, middle, pad side) holding cell `c`. */
function bandEnd(c: number): number {
  return c < MID ? MID : c === MID ? MID + 1 : CELLS;
}

/** Platform layer of cell index `c` (0..6) counted from the nearer tile edge; 3 = middle. */
function layerOf(c: number): number {
  return c < MID ? c : CELLS - 1 - c;
}

/**
 * Surface of cell (cx, cz) of the 7×7 grid for the given (geometry) mask. Cells of a
 * rounded corner pad, and every cell of a curve, are `None`: they're drawn from arcs.
 */
export function cellSurface(cx: number, cz: number, mask: number): Surf {
  if (curveCorner(mask) !== -1) return Surf.None;
  const n = (mask & DIR_BIT[Dir.N]) !== 0;
  const e = (mask & DIR_BIT[Dir.E]) !== 0;
  const s = (mask & DIR_BIT[Dir.S]) !== 0;
  const w = (mask & DIR_BIT[Dir.W]) !== 0;

  if (cx === MID && cz === MID) return Surf.Asphalt;
  if (cx === MID) {
    // North or south edge band: road continues, or the platform closes this side.
    return (cz < MID ? n : s) ? Surf.Asphalt : LAYER_SURF[layerOf(cz)];
  }
  if (cz === MID) {
    return (cx < MID ? w : e) ? Surf.Asphalt : LAYER_SURF[layerOf(cx)];
  }

  // Corner region between an x-side (W/E) and a z-side (N/S).
  const openX = cx < MID ? w : e;
  const openZ = cz < MID ? n : s;
  const lx = layerOf(cx);
  const lz = layerOf(cz);
  if (!openX && !openZ) return LAYER_SURF[Math.min(lx, lz)]; // platform wraps the corner
  if (!openX) return LAYER_SURF[lx]; // the x-side band runs through
  if (!openZ) return LAYER_SURF[lz]; // the z-side band runs through
  return Surf.None; // both sides connected: rounded corner pad
}

/**
 * Appends the geometry for one road tile at (x, z) with ground height `y` to `builder`.
 * `mask` is the tile's connection mask (N=1, E=2, S=4, W=8).
 */
export function appendRoadTile(
  builder: GeometryBuilder,
  x: number,
  z: number,
  mask: number,
  y: number,
): void {
  const m = geometryMask(mask);
  const curve = curveCorner(m);
  if (curve !== -1) {
    appendCurve(builder, x, z, curve, y);
    return;
  }

  for (let cz = 0; cz < CELLS; cz++) {
    for (let cx = 0; cx < CELLS; cx++) cells[cz * CELLS + cx] = cellSurface(cx, cz, m);
  }
  // Junctions keep rectangles within the pad / middle / pad bands, so every pad corner is
  // a shared vertex: a corner in the middle of a merged edge (a T-vertex) cracks.
  const junction = bitCount(m) > 2;

  // Greedy rectangle merge: extend right, then down, over cells of the same surface.
  used.fill(0);
  for (let cz = 0; cz < CELLS; cz++) {
    for (let cx = 0; cx < CELLS; cx++) {
      const k = cz * CELLS + cx;
      if (used[k]) continue;
      const surf = cells[k] as Surf;
      const xEnd = junction ? bandEnd(cx) : CELLS;
      const zEnd = junction ? bandEnd(cz) : CELLS;
      let w = 1;
      while (cx + w < xEnd && !used[k + w] && cells[k + w] === surf) w++;
      let h = 1;
      grow: while (cz + h < zEnd) {
        for (let i = 0; i < w; i++) {
          const kk = (cz + h) * CELLS + cx + i;
          if (used[kk] || cells[kk] !== surf) break grow;
        }
        h++;
      }
      for (let j = 0; j < h; j++) {
        used.fill(1, (cz + j) * CELLS + cx, (cz + j) * CELLS + cx + w);
      }
      if (surf === Surf.None) continue;
      emitCell(
        builder,
        surf,
        x + EDGES[cx],
        z + EDGES[cz],
        x + EDGES[cx + w],
        z + EDGES[cz + h],
        y,
      );
    }
  }

  // Rounded pads in each corner between two connected sides.
  const n = (m & DIR_BIT[Dir.N]) !== 0;
  const e = (m & DIR_BIT[Dir.E]) !== 0;
  const s = (m & DIR_BIT[Dir.S]) !== 0;
  const w = (m & DIR_BIT[Dir.W]) !== 0;
  if (n && w) appendCornerPad(builder, x, z, Corner.NW, y);
  if (n && e) appendCornerPad(builder, x, z, Corner.NE, y);
  if (s && e) appendCornerPad(builder, x, z, Corner.SE, y);
  if (s && w) appendCornerPad(builder, x, z, Corner.SW, y);

  const my = y + ROAD_STYLE.markingY;
  if (bitCount(m) <= 2) appendCenterLines(builder, x, z, m, my);
  else appendJunctionMarkings(builder, x, z, m, my);
}

function emitCell(
  builder: GeometryBuilder,
  surf: Surf,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
): void {
  const top = y + PLATFORM_Y;
  switch (surf) {
    case Surf.Asphalt:
      builder.quadUp(x0, z0, x1, z1, y + ROAD_STYLE.asphaltY, ROAD_COLORS.asphalt);
      break;
    case Surf.Curb:
      builder.box(x0, z0, x1, z1, y, top, ROAD_COLORS.curb);
      break;
    case Surf.Verge:
      builder.box(x0, z0, x1, z1, y, top, ROAD_COLORS.verge, ROAD_SURFACE.Verge);
      break;
    case Surf.Sidewalk: {
      // Slabs run along the longer side of the rectangle (the sidewalk's direction).
      const alongX = x1 - x0 >= z1 - z0;
      const id = alongX ? ROAD_SURFACE.SidewalkAlongX : ROAD_SURFACE.SidewalkAlongZ;
      builder.box(x0, z0, x1, z1, y, top, ROAD_COLORS.sidewalk, id);
      break;
    }
  }
}

// ------------------------------------------------------------------ arcs

/** Point k of the arc of radius r around corner q of the tile whose corner is (cx, cz). */
function arcX(cx: number, q: number, k: number, r: number): number {
  return cx + r * ARC_COS[q * (SEGMENTS + 1) + k];
}
function arcZ(cz: number, q: number, k: number, r: number): number {
  return cz + r * ARC_SIN[q * (SEGMENTS + 1) + k];
}

/** Flat quarter ring (r0..r1) around the corner point (cx, cz); r0 = 0 gives a disc. */
function ringTop(
  b: GeometryBuilder,
  cx: number,
  cz: number,
  q: number,
  r0: number,
  r1: number,
  y: number,
  color: Color,
  surface = 0,
): void {
  for (let k = 0; k < SEGMENTS; k++) {
    const ox0 = arcX(cx, q, k, r1);
    const oz0 = arcZ(cz, q, k, r1);
    const ox1 = arcX(cx, q, k + 1, r1);
    const oz1 = arcZ(cz, q, k + 1, r1);
    if (r0 === 0) {
      b.triUp(cx, cz, ox0, oz0, ox1, oz1, y, color, surface);
      continue;
    }
    const ix0 = arcX(cx, q, k, r0);
    const iz0 = arcZ(cz, q, k, r0);
    const ix1 = arcX(cx, q, k + 1, r0);
    const iz1 = arcZ(cz, q, k + 1, r0);
    b.triUp(ix0, iz0, ox0, oz0, ox1, oz1, y, color, surface);
    b.triUp(ix0, iz0, ox1, oz1, ix1, iz1, y, color, surface);
  }
}

/** Curved wall at radius r around (cx, cz), facing away from the corner or toward it. */
function arcWall(
  b: GeometryBuilder,
  cx: number,
  cz: number,
  q: number,
  r: number,
  y0: number,
  y1: number,
  color: Color,
  outward: boolean,
): void {
  for (let k = 0; k < SEGMENTS; k++) {
    const ax = arcX(cx, q, k, r);
    const az = arcZ(cz, q, k, r);
    const bx = arcX(cx, q, k + 1, r);
    const bz = arcZ(cz, q, k + 1, r);
    // Walking with increasing angle, the left-hand side is away from the corner.
    if (outward) b.wall(ax, az, bx, bz, y0, y1, color);
    else b.wall(bx, bz, ax, az, y0, y1, color);
  }
}

/**
 * Raised quarter rings around corner q: sidewalk, verge and curb outward from radius
 * `r0` when `inner`, or inward to radius `r0 + EW` when not (the outside of a curve).
 * Either way the bands meet the straight neighbours' bands at the tile edges.
 */
function appendPlatformArc(
  b: GeometryBuilder,
  cx: number,
  cz: number,
  q: number,
  y: number,
  inner: boolean,
): void {
  const top = y + PLATFORM_Y;
  if (inner) {
    ringTop(b, cx, cz, q, 0, SW, top, ROAD_COLORS.sidewalk, ROAD_SURFACE.SidewalkPad + q);
    ringTop(b, cx, cz, q, SW, SW + VW, top, ROAD_COLORS.verge, ROAD_SURFACE.Verge);
    ringTop(b, cx, cz, q, SW + VW, EW, top, ROAD_COLORS.curb);
    arcWall(b, cx, cz, q, EW, y, top, ROAD_COLORS.curb, true);
  } else {
    ringTop(b, cx, cz, q, 1 - EW, 1 - SW - VW, top, ROAD_COLORS.curb);
    ringTop(b, cx, cz, q, 1 - SW - VW, 1 - SW, top, ROAD_COLORS.verge, ROAD_SURFACE.Verge);
    ringTop(b, cx, cz, q, 1 - SW, 1, top, ROAD_COLORS.sidewalk, ROAD_SURFACE.SidewalkArc + q);
    arcWall(b, cx, cz, q, 1 - EW, y, top, ROAD_COLORS.curb, false);
    arcWall(b, cx, cz, q, 1, y, top, ROAD_COLORS.sidewalk, true);
  }
}

/** Rounded corner pad of a T-junction or crossing, plus the asphalt around its curb. */
function appendCornerPad(b: GeometryBuilder, x: number, z: number, q: number, y: number): void {
  const cx = x + CORNER_DX[q];
  const cz = z + CORNER_DZ[q];
  appendPlatformArc(b, cx, cz, q, y, true);
  // Asphalt between the curb and the corner of the pad's square (a fan from that corner).
  const px = cx + (CORNER_DX[q] ? -EW : EW);
  const pz = cz + (CORNER_DZ[q] ? -EW : EW);
  const ay = y + ROAD_STYLE.asphaltY;
  for (let k = 0; k < SEGMENTS; k++) {
    b.triUp(
      px,
      pz,
      arcX(cx, q, k, EW),
      arcZ(cz, q, k, EW),
      arcX(cx, q, k + 1, EW),
      arcZ(cz, q, k + 1, EW),
      ay,
      ROAD_COLORS.asphalt,
    );
  }
}

/** A curve bending around corner q: every band is a quarter ring around that corner. */
function appendCurve(b: GeometryBuilder, x: number, z: number, q: number, y: number): void {
  const cx = x + CORNER_DX[q];
  const cz = z + CORNER_DZ[q];
  appendPlatformArc(b, cx, cz, q, y, true);
  appendPlatformArc(b, cx, cz, q, y, false);
  ringTop(b, cx, cz, q, EW, 1 - EW, y + ROAD_STYLE.asphaltY, ROAD_COLORS.asphalt);
  const my = y + ROAD_STYLE.markingY;
  ringTop(b, cx, cz, q, LINE_A0, LINE_A1, my, ROAD_COLORS.centerLine);
  ringTop(b, cx, cz, q, LINE_B0, LINE_B1, my, ROAD_COLORS.centerLine);
}

// ------------------------------------------------------------------ markings

function bitCount(mask: number): number {
  return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
}

/** Double yellow line from the tile centre to each connected edge (straight, dead end). */
function appendCenterLines(
  builder: GeometryBuilder,
  x: number,
  z: number,
  mask: number,
  y: number,
): void {
  const c = ROAD_COLORS.centerLine;
  const n = (mask & DIR_BIT[Dir.N]) !== 0;
  const s = (mask & DIR_BIT[Dir.S]) !== 0;
  const e = (mask & DIR_BIT[Dir.E]) !== 0;
  const w = (mask & DIR_BIT[Dir.W]) !== 0;

  // Runs along z (north/south connections); merged into one run for straight roads.
  if (n || s) {
    const z0 = z + (n ? 0 : 0.5);
    const z1 = z + (s ? 1 : 0.5);
    builder.quadUp(x + LINE_A0, z0, x + LINE_A1, z1, y, c);
    builder.quadUp(x + LINE_B0, z0, x + LINE_B1, z1, y, c);
  }
  // Runs along x (east/west connections).
  if (e || w) {
    const x0 = x + (w ? 0 : 0.5);
    const x1 = x + (e ? 1 : 0.5);
    builder.quadUp(x0, z + LINE_A0, x1, z + LINE_A1, y, c);
    builder.quadUp(x0, z + LINE_B0, x1, z + LINE_B1, y, c);
  }
}

/**
 * Markings on the approaches of a T-junction or crossing: the double yellow line stops at
 * the junction box, and approaches that must stop get a stop line across the incoming
 * lane (the right-hand one, seen from a driver entering the tile).
 */
function appendJunctionMarkings(
  builder: GeometryBuilder,
  x: number,
  z: number,
  mask: number,
  y: number,
): void {
  const { stopLineWidth, stopLineInset } = ROAD_STYLE;
  const stopFar = EW - stopLineInset;
  const stopNear = stopFar - stopLineWidth;
  for (let d = 0; d < 4; d++) {
    if ((mask & DIR_BIT[d]) === 0) continue;
    // On a T only the stem (the side opposite the closed one) stops.
    const stops = mask === 15 || (mask & DIR_BIT[(d + 2) & 3]) === 0;
    const lineEnd = stops ? stopNear : EW;
    appendArmRect(builder, x, z, d, 0, lineEnd, LINE_A0, LINE_A1, y, ROAD_COLORS.centerLine);
    appendArmRect(builder, x, z, d, 0, lineEnd, LINE_B0, LINE_B1, y, ROAD_COLORS.centerLine);
    if (!stops) continue;
    // Entering from the north or east, the right-hand lane is on the low-coordinate side.
    const lowSide = d === Dir.N || d === Dir.E;
    const a0 = lowSide ? EW : LINE_B1;
    const a1 = lowSide ? LINE_A0 : 1 - EW;
    appendArmRect(builder, x, z, d, stopNear, stopFar, a0, a1, y, ROAD_COLORS.stopLine);
  }
}

/**
 * Flat rectangle in the arm of the tile on side `d`: `along` is the distance from that
 * tile edge toward the centre, `across` the tile coordinate across the arm (x for north
 * and south arms, z for east and west ones).
 */
function appendArmRect(
  builder: GeometryBuilder,
  x: number,
  z: number,
  d: number,
  along0: number,
  along1: number,
  across0: number,
  across1: number,
  y: number,
  color: Color,
): void {
  switch (d) {
    case Dir.N:
      builder.quadUp(x + across0, z + along0, x + across1, z + along1, y, color);
      break;
    case Dir.S:
      builder.quadUp(x + across0, z + 1 - along1, x + across1, z + 1 - along0, y, color);
      break;
    case Dir.W:
      builder.quadUp(x + along0, z + across0, x + along1, z + across1, y, color);
      break;
    case Dir.E:
      builder.quadUp(x + 1 - along1, z + across0, x + 1 - along0, z + across1, y, color);
      break;
  }
}
