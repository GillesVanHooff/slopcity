/**
 * Avenue-specific road geometry: the lane markings of a straight avenue half, and the
 * smooth 90° avenue curve.
 *
 * Markings on a half (two lanes one way): a dashed white line between the lanes and a
 * solid yellow line along the median, the US convention for divided roads.
 *
 * The curve spans a 2×2 block: every band (inner platform, inner lanes, median, outer
 * lanes, outer platform) is a quarter ring of radius up to 2 around the inner corner of
 * the block's inner tile. Each tile draws its own part, clipped to the tile, so the
 * block can straddle render blocks. A leg the avenue doesn't continue from gets a
 * straight end cap (the platform bands of a dead end).
 */

import type { Color } from 'three';
import { DIR_BIT, Dir, oppositeDir } from '../../core/grid';
import { dirOfBit, medianPair, type MedianPair } from '../../sim/roads/avenue';
import type { RoadLayers } from '../../sim/world';
import type { GeometryBuilder } from '../procedural/geometryBuilder';
import { appendCellGrid } from './roadGeometry';
import { CORNER_DX, CORNER_DZ, ROAD_COLORS, ROAD_STYLE, ROAD_SURFACE } from './roadStyle';
import { Pad, Side, cornerOf, isCurveLeg } from './roadTopology';

const {
  sidewalkWidth: SW,
  vergeWidth: VW,
  curbWidth: CW,
  edgeWidth: EW,
  centerLineWidth: LW,
  laneLineWidth: DW,
  laneDashLength: DASH,
  medianLineOffset: MO,
  avenueArcSegments: SEG,
  platformY: PLATFORM_Y,
} = ROAD_STYLE;
/** Dash plus gap of the lane lines; a tile holds a whole number of periods. */
const DASH_PERIOD = 0.5;

// ------------------------------------------------------------------ straight halves

/**
 * Lane markings along a plain avenue half (one median bit, nothing crossing). Lines run
 * edge to edge where the avenue continues, and stop short of an end cap.
 */
export function appendAvenueLanes(
  builder: GeometryBuilder,
  layers: RoadLayers,
  i: number,
  x: number,
  z: number,
  sides: readonly Side[],
  y: number,
): void {
  const p = dirOfBit(layers.roadMedian[i]);
  const alongZ = p === Dir.E || p === Dir.W;
  const medianHigh = p === Dir.E || p === Dir.S;
  const cap = EW + MO;
  const a0 = sides[alongZ ? Dir.N : Dir.W] === Side.Open ? 0 : cap;
  const a1 = sides[alongZ ? Dir.S : Dir.E] === Side.Open ? 1 : 1 - cap;
  const m0 = medianHigh ? 1 - EW - MO - LW : EW + MO;
  alongRect(builder, x, z, alongZ, a0, a1, m0, m0 + LW, y, ROAD_COLORS.centerLine);
  // Dashes at a fixed spacing in tile coordinates, so they line up from tile to tile.
  for (let k = 0; k < 1 / DASH_PERIOD; k++) {
    const d0 = Math.max(a0, (k + 0.5) * DASH_PERIOD - DASH / 2);
    const d1 = Math.min(a1, (k + 0.5) * DASH_PERIOD + DASH / 2);
    if (d1 - d0 < 0.02) continue;
    alongRect(builder, x, z, alongZ, d0, d1, 0.5 - DW / 2, 0.5 + DW / 2, y, ROAD_COLORS.laneLine);
  }
}

/** Flat rectangle in tile (x, z): `a` along the half's direction, `u` across it. */
function alongRect(
  builder: GeometryBuilder,
  x: number,
  z: number,
  alongZ: boolean,
  a0: number,
  a1: number,
  u0: number,
  u1: number,
  y: number,
  color: Color,
): void {
  if (alongZ) builder.quadUp(x + u0, z + a0, x + u1, z + a1, y, color);
  else builder.quadUp(x + a0, z + u0, x + a1, z + u1, y, color);
}

// ------------------------------------------------------------------ curves

/** Unit vectors of the avenue arc around each corner, as ARC_COS in roadGeometry.ts. */
const AV_COS = new Float64Array(4 * (SEG + 1));
const AV_SIN = new Float64Array(4 * (SEG + 1));
for (let q = 0; q < 4; q++) {
  for (let k = 0; k <= SEG; k++) {
    const a = ((q + k / SEG) * Math.PI) / 2;
    AV_COS[q * (SEG + 1) + k] = Math.round(Math.cos(a) * 1e12) / 1e12;
    AV_SIN[q * (SEG + 1) + k] = Math.round(Math.sin(a) * 1e12) / 1e12;
  }
}

/** The clip rectangle of the tile being drawn (world units). */
const rect = { x0: 0, z0: 0, x1: 0, z1: 0 };
const pair: MedianPair = { d1: 0, d2: 1 };
const capSides: Side[] = [0, 0, 0, 0];
const NO_PADS: readonly Pad[] = [Pad.None, Pad.None, Pad.None, Pad.None];

/**
 * Draws tile i's part of the avenue curve whose inner tile is `inner`.
 */
export function appendAvenueCurvePart(
  builder: GeometryBuilder,
  layers: RoadLayers,
  i: number,
  inner: number,
  y: number,
): void {
  const { grid, roadMask } = layers;
  if (!medianPair(layers.roadMedian[inner], pair)) return;
  // The curve bends around the inner tile's corner between its two legs, which are the
  // sides opposite its median bits.
  const l1 = oppositeDir(pair.d1);
  const l2 = oppositeDir(pair.d2);
  const xLeg = l1 === Dir.E || l1 === Dir.W ? l1 : l2;
  const zLeg = xLeg === l1 ? l2 : l1;
  const q = cornerOf(xLeg, zLeg);
  const cx = grid.x(inner) + CORNER_DX[q];
  const cz = grid.z(inner) + CORNER_DZ[q];

  const x = grid.x(i);
  const z = grid.z(i);
  // Legs the avenue doesn't continue from get an end cap; the curve stops before it.
  let capped = false;
  for (let d = 0; d < 4; d++) {
    const cap = isCurveLeg(layers, inner, i, d) && (roadMask[i] & DIR_BIT[d]) === 0;
    capSides[d] = cap ? Side.Sidewalk : Side.Open;
    capped ||= cap;
  }
  rect.x0 = x + (capSides[Dir.W] === Side.Sidewalk ? EW : 0);
  rect.x1 = x + 1 - (capSides[Dir.E] === Side.Sidewalk ? EW : 0);
  rect.z0 = z + (capSides[Dir.N] === Side.Sidewalk ? EW : 0);
  rect.z1 = z + 1 - (capSides[Dir.S] === Side.Sidewalk ? EW : 0);

  const top = y + PLATFORM_Y;
  const road = y + ROAD_STYLE.asphaltY;
  const mark = y + ROAD_STYLE.markingY;
  const { sidewalk, verge, curb, asphalt, centerLine, laneLine } = ROAD_COLORS;
  const outerId = ROAD_SURFACE.SidewalkAvenueArc + (cx - x + 1) + 4 * (cz - z + 1);

  // Inner platform, inner lanes, median, outer lanes, outer platform.
  ring(builder, cx, cz, q, 0, SW, top, sidewalk, ROAD_SURFACE.SidewalkPad + q);
  ring(builder, cx, cz, q, SW, SW + VW, top, verge, ROAD_SURFACE.Verge);
  ring(builder, cx, cz, q, SW + VW, EW, top, curb);
  ring(builder, cx, cz, q, EW, 1 - EW, road, asphalt);
  ring(builder, cx, cz, q, 1 - EW, 1 - EW + CW, top, curb);
  ring(builder, cx, cz, q, 1 - EW + CW, 1 + EW - CW, top, verge, ROAD_SURFACE.Verge);
  ring(builder, cx, cz, q, 1 + EW - CW, 1 + EW, top, curb);
  ring(builder, cx, cz, q, 1 + EW, 2 - EW, road, asphalt);
  ring(builder, cx, cz, q, 2 - EW, 2 - EW + CW, top, curb);
  ring(builder, cx, cz, q, 2 - EW + CW, 2 - SW, top, verge, ROAD_SURFACE.Verge);
  ring(builder, cx, cz, q, 2 - SW, 2, top, sidewalk, outerId);
  // Curb faces toward the asphalt, and the outer edge of the sidewalk.
  wall(builder, cx, cz, q, EW, y, top, curb, true);
  wall(builder, cx, cz, q, 1 - EW, y, top, curb, false);
  wall(builder, cx, cz, q, 1 + EW, y, top, curb, true);
  wall(builder, cx, cz, q, 2 - EW, y, top, curb, false);
  wall(builder, cx, cz, q, 2, y, top, sidewalk, true);

  // Yellow lines along the median, dashed lines between the lanes.
  ring(builder, cx, cz, q, 1 - EW - MO - LW, 1 - EW - MO, mark, centerLine);
  ring(builder, cx, cz, q, 1 + EW + MO, 1 + EW + MO + LW, mark, centerLine);
  dashes(builder, cx, cz, q, 0.5, mark, laneLine);
  dashes(builder, cx, cz, q, 1.5, mark, laneLine);

  if (capped) appendCellGrid(builder, x, z, y, capSides, NO_PADS, true);
}

// Scratch polygons for clipping (up to 4 + 4 clip planes vertices, x/z interleaved).
const polyA = new Float64Array(32);
const polyB = new Float64Array(32);

/** Flat quarter ring r0..r1 around (cx, cz), clipped to `rect`; r0 = 0 gives a disc. */
function ring(
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
  const base = q * (SEG + 1);
  for (let k = 0; k < SEG; k++) {
    const c0 = AV_COS[base + k];
    const s0 = AV_SIN[base + k];
    const c1 = AV_COS[base + k + 1];
    const s1 = AV_SIN[base + k + 1];
    let n = 0;
    if (r0 === 0) {
      n = pushPoint(polyA, n, cx, cz);
    } else {
      n = pushPoint(polyA, n, cx + r0 * c0, cz + r0 * s0);
    }
    n = pushPoint(polyA, n, cx + r1 * c0, cz + r1 * s0);
    n = pushPoint(polyA, n, cx + r1 * c1, cz + r1 * s1);
    if (r0 !== 0) n = pushPoint(polyA, n, cx + r0 * c1, cz + r0 * s1);
    fillClipped(b, n, y, color, surface);
  }
}

/** Dashed line of width DW along radius r, clipped to `rect`. */
function dashes(
  b: GeometryBuilder,
  cx: number,
  cz: number,
  q: number,
  r: number,
  y: number,
  color: Color,
): void {
  // Same period and dash share as on straight halves, fitted to a whole number of
  // periods along the quarter circle.
  const count = Math.max(1, Math.round(((Math.PI / 2) * r) / DASH_PERIOD));
  const share = DASH / DASH_PERIOD;
  const steps = 4;
  const r0 = r - DW / 2;
  const r1 = r + DW / 2;
  for (let j = 0; j < count; j++) {
    const t0 = (j + (1 - share) / 2) / count;
    const t1 = (j + (1 + share) / 2) / count;
    for (let s = 0; s < steps; s++) {
      const a0 = ((q + t0 + ((t1 - t0) * s) / steps) * Math.PI) / 2;
      const a1 = ((q + t0 + ((t1 - t0) * (s + 1)) / steps) * Math.PI) / 2;
      let n = 0;
      n = pushPoint(polyA, n, cx + r0 * Math.cos(a0), cz + r0 * Math.sin(a0));
      n = pushPoint(polyA, n, cx + r1 * Math.cos(a0), cz + r1 * Math.sin(a0));
      n = pushPoint(polyA, n, cx + r1 * Math.cos(a1), cz + r1 * Math.sin(a1));
      n = pushPoint(polyA, n, cx + r0 * Math.cos(a1), cz + r0 * Math.sin(a1));
      fillClipped(b, n, y, color, 0);
    }
  }
}

/** Curved wall at radius r around (cx, cz), clipped to `rect`. */
function wall(
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
  const base = q * (SEG + 1);
  for (let k = 0; k < SEG; k++) {
    const ax = cx + r * AV_COS[base + k];
    const az = cz + r * AV_SIN[base + k];
    const bx = cx + r * AV_COS[base + k + 1];
    const bz = cz + r * AV_SIN[base + k + 1];
    // Clip the segment to the rectangle (Liang–Barsky).
    const dx = bx - ax;
    const dz = bz - az;
    clipT0 = 0;
    clipT1 = 1;
    if (
      !clipEdge(-dx, ax - rect.x0) ||
      !clipEdge(dx, rect.x1 - ax) ||
      !clipEdge(-dz, az - rect.z0) ||
      !clipEdge(dz, rect.z1 - az) ||
      clipT1 - clipT0 < 1e-9
    ) {
      continue;
    }
    const px = ax + dx * clipT0;
    const pz = az + dz * clipT0;
    const qx = ax + dx * clipT1;
    const qz = az + dz * clipT1;
    // Walking with increasing angle, the left-hand side is away from the centre.
    if (outward) b.wall(px, pz, qx, qz, y0, y1, color);
    else b.wall(qx, qz, px, pz, y0, y1, color);
  }
}

let clipT0 = 0;
let clipT1 = 1;

/** One Liang–Barsky edge test; false when the segment lies entirely outside it. */
function clipEdge(p: number, q: number): boolean {
  if (p === 0) return q >= 0;
  const t = q / p;
  if (p < 0) clipT0 = Math.max(clipT0, t);
  else clipT1 = Math.min(clipT1, t);
  return true;
}

function pushPoint(poly: Float64Array, n: number, x: number, z: number): number {
  poly[n * 2] = x;
  poly[n * 2 + 1] = z;
  return n + 1;
}

/** Clips the convex polygon in polyA (n points) to `rect` and fills it as a fan. */
function fillClipped(
  b: GeometryBuilder,
  n: number,
  y: number,
  color: Color,
  surface: number,
): void {
  let src = polyA;
  let dst = polyB;
  for (let edge = 0; edge < 4 && n >= 3; edge++) {
    let m = 0;
    for (let k = 0; k < n; k++) {
      const px = src[k * 2];
      const pz = src[k * 2 + 1];
      const nx = src[((k + 1) % n) * 2];
      const nz = src[((k + 1) % n) * 2 + 1];
      const dp = clipDistance(edge, px, pz);
      const dn = clipDistance(edge, nx, nz);
      if (dp >= 0) m = pushPoint(dst, m, px, pz);
      if (dp >= 0 !== dn >= 0) {
        const t = dp / (dp - dn);
        m = pushPoint(dst, m, px + (nx - px) * t, pz + (nz - pz) * t);
      }
    }
    n = m;
    [src, dst] = [dst, src];
  }
  for (let k = 1; k + 1 < n; k++) {
    const ax = src[0];
    const az = src[1];
    const bx = src[k * 2];
    const bz = src[k * 2 + 1];
    const cx = src[k * 2 + 2];
    const cz = src[k * 2 + 3];
    // Pieces that only touch the tile (at a corner or along an edge) clip to nothing.
    if (Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) < 1e-10) continue;
    b.triUp(ax, az, bx, bz, cx, cz, y, color, surface);
  }
}

/** Signed distance inside clip edge 0..3 (x ≥ x0, x ≤ x1, z ≥ z0, z ≤ z1). */
function clipDistance(edge: number, x: number, z: number): number {
  switch (edge) {
    case 0:
      return x - rect.x0;
    case 1:
      return rect.x1 - x;
    case 2:
      return z - rect.z0;
    default:
      return rect.z1 - z;
  }
}
