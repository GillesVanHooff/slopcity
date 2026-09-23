/**
 * Procedural road tile geometry in the SimCity 4 American style: the street (one tile,
 * one lane each way, double yellow centre line) and the avenue (two tiles, each half
 * two lanes one way, with a grass median between the halves; see avenueGeometry.ts).
 *
 * Cross-section from the tile edge inward, on every side without a road connection. The
 * sidewalk, grass verge and curb form one raised platform (≈20 cm above the asphalt):
 *
 *   | sidewalk | grass verge | curb | asphalt ... asphalt | curb | grass verge | sidewalk |
 *   0        0.085         0.145  0.16                  0.84   0.855        0.915        1
 *
 * An avenue half has the same asphalt band; on its median side the platform is grass
 * and curb instead (0.16 per half, so the median is 0.32 tiles wide).
 *
 * Pieces:
 *  - Cell grid (straights, dead ends, junctions, avenue halves): the tile is split into
 *    a 7×7 grid of cells at those boundaries. Each side of the tile is open, a sidewalk
 *    platform or a median platform (roadTopology.ts); each cell gets a surface from
 *    them, and equal neighbouring cells merge into larger rectangles. Platforms wrap
 *    around dead ends.
 *  - Street curve (two adjacent connections): every band bends as a quarter ring around
 *    the inner tile corner, like SC4. The lot-side corner stays bare ground.
 *  - Junction corners: a corner between two open sides gets a rounded pad in the style
 *    of the band the neighbours bring into it: a sidewalk pad (grass wraps the corner)
 *    or a rounded median nose, with asphalt around it; inside a junction box, plain
 *    asphalt. No centre lines inside junctions; stop lines on approaches that must stop.
 *
 * Every piece meets its neighbours with the same cross-section at the shared edge.
 * Sidewalk and verge tops are tagged with a surface id so the road material can draw
 * concrete slabs and grass procedurally (see roadMaterial.ts).
 */

import type { Color } from 'three';
import { DIR_BIT, Dir } from '../../core/grid';
import { curveInnerOf, isAvenue } from '../../sim/roads/avenue';
import type { RoadLayers } from '../../sim/world';
import type { GeometryBuilder } from '../procedural/geometryBuilder';
import { appendAvenueCurvePart, appendAvenueLanes } from './avenueGeometry';
import { CORNER_DX, CORNER_DZ, ROAD_COLORS, ROAD_STYLE, ROAD_SURFACE } from './roadStyle';
import {
  ArmKind,
  Pad,
  Side,
  cornerOf,
  createArm,
  createTileSides,
  curveCorner,
  describeArm,
  describeTileSides,
  geometryMask,
  isJunction,
} from './roadTopology';

export {
  CORNER_DX,
  CORNER_DZ,
  Corner,
  ROAD_ARC_SLABS,
  ROAD_COLORS,
  ROAD_STYLE,
  ROAD_SURFACE,
} from './roadStyle';
export { curveCorner, geometryMask } from './roadTopology';

/** Surface of one cell of the 7×7 grid. `None` cells are drawn by something else. */
export const Surf = { Asphalt: 0, Curb: 1, Verge: 2, Sidewalk: 3, None: 4 } as const;
export type Surf = (typeof Surf)[keyof typeof Surf];

const {
  sidewalkWidth: SW,
  vergeWidth: VW,
  curbWidth: CW,
  edgeWidth: EW,
  arcSegments: SEGMENTS,
  platformY: PLATFORM_Y,
} = ROAD_STYLE;
/** Cell boundaries along each axis (7 cells). */
const EDGES = [0, SW, SW + VW, EW, 1 - EW, 1 - SW - VW, 1 - SW, 1] as const;
const CELLS = 7;
const MID = 3;
/** Platform surface by layer (distance from the tile edge: 0, 1, 2) for each side kind. */
const SIDEWALK_LAYERS: readonly Surf[] = [Surf.Sidewalk, Surf.Verge, Surf.Curb];
const MEDIAN_LAYERS: readonly Surf[] = [Surf.Verge, Surf.Verge, Surf.Curb];

// Double yellow line: offsets of the two lines from the road's centre axis.
const HALF_GAP = ROAD_STYLE.centerLineGap / 2;
const LINE_A0 = 0.5 - HALF_GAP - ROAD_STYLE.centerLineWidth;
const LINE_A1 = 0.5 - HALF_GAP;
const LINE_B0 = 0.5 + HALF_GAP;
const LINE_B1 = 0.5 + HALF_GAP + ROAD_STYLE.centerLineWidth;

// Scratch cell grid and visited flags (indexed [z * CELLS + x]), and tile descriptions.
const cells = new Uint8Array(CELLS * CELLS);
const used = new Uint8Array(CELLS * CELLS);
const tileSides = createTileSides();
const arm = createArm();
const streetSides: Side[] = [0, 0, 0, 0];
const streetPads: Pad[] = [0, 0, 0, 0];

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

/** One past the last cell of the band (pad side, middle, pad side) holding cell `c`. */
function bandEnd(c: number): number {
  return c < MID ? MID : c === MID ? MID + 1 : CELLS;
}

/** Platform layer of cell index `c` (0..6) counted from the nearer tile edge; 3 = middle. */
function layerOf(c: number): number {
  return c < MID ? c : CELLS - 1 - c;
}

function bandSurf(kind: Side, layer: number): Surf {
  return (kind === Side.Median ? MEDIAN_LAYERS : SIDEWALK_LAYERS)[layer];
}

/**
 * Surface of cell (cx, cz) given the tile's side kinds and corner pads. With
 * `bandsOnly`, only the closed sides' platform bands are produced (for avenue curve
 * caps); everything else is `None`.
 */
function cellSurfaceFor(
  cx: number,
  cz: number,
  sides: readonly Side[],
  pads: readonly Pad[],
  bandsOnly: boolean,
): Surf {
  const open = bandsOnly ? Surf.None : Surf.Asphalt;
  const kx = sides[cx < MID ? Dir.W : Dir.E];
  const kz = sides[cz < MID ? Dir.N : Dir.S];
  if (cx === MID && cz === MID) return open;
  // Edge bands in the middle row/column: road continues, or the platform closes it.
  if (cx === MID) return kz === Side.Open ? open : bandSurf(kz, layerOf(cz));
  if (cz === MID) return kx === Side.Open ? open : bandSurf(kx, layerOf(cx));

  // Corner region between an x-side (W/E) and a z-side (N/S).
  const lx = layerOf(cx);
  const lz = layerOf(cz);
  if (kx !== Side.Open && kz !== Side.Open) {
    // The platform wraps the corner: the band nearer the tile edge wins, and where a
    // median meets an end cap the sidewalk runs across.
    if (lx < lz) return bandSurf(kx, lx);
    if (lz < lx) return bandSurf(kz, lz);
    return bandSurf(kx === Side.Sidewalk || kz === Side.Sidewalk ? Side.Sidewalk : kx, lx);
  }
  if (kx !== Side.Open) return bandSurf(kx, lx); // the x-side band runs through
  if (kz !== Side.Open) return bandSurf(kz, lz); // the z-side band runs through
  if (bandsOnly) return Surf.None;
  // Both sides open: a rounded pad, or plain asphalt inside a junction box.
  const q = cornerOf(cx < MID ? Dir.W : Dir.E, cz < MID ? Dir.N : Dir.S);
  return pads[q] === Pad.None ? Surf.Asphalt : Surf.None;
}

/**
 * Surface of cell (cx, cz) of a street tile with the given connection mask, standing
 * alone (every corner between two connections is a sidewalk pad). Curves are drawn
 * from arcs, so all their cells are `None`.
 */
export function cellSurface(cx: number, cz: number, mask: number): Surf {
  if (curveCorner(mask) !== -1) return Surf.None;
  for (let d = 0; d < 4; d++) streetSides[d] = mask & DIR_BIT[d] ? Side.Open : Side.Sidewalk;
  streetPads.fill(Pad.Sidewalk);
  return cellSurfaceFor(cx, cz, streetSides, streetPads, false);
}

/**
 * Appends the geometry for road tile (x, z), standing on ground height `y`, to
 * `builder`. Reads the tile and its surroundings from `layers`.
 */
export function appendRoadTile(
  builder: GeometryBuilder,
  layers: RoadLayers,
  x: number,
  z: number,
  y: number,
): void {
  const i = layers.grid.index(x, z);
  if (layers.road[i] === 0) return;
  const avenue = isAvenue(layers, i);
  if (avenue) {
    const inner = curveInnerOf(layers, i);
    if (inner >= 0) {
      appendAvenueCurvePart(builder, layers, i, inner, y);
      return;
    }
  } else {
    const q = curveCorner(geometryMask(layers.roadMask[i]));
    if (q !== -1) {
      appendCurve(builder, x, z, q, y);
      return;
    }
  }

  const { sides, pads } = describeTileSides(layers, i, tileSides);
  appendCellGrid(builder, x, z, y, sides, pads, false);
  for (let q = 0; q < 4; q++) {
    if (pads[q] === Pad.None) continue;
    const xs = CORNER_DX[q] ? Dir.E : Dir.W;
    const zs = CORNER_DZ[q] ? Dir.S : Dir.N;
    if (sides[xs] === Side.Open && sides[zs] === Side.Open) {
      appendCornerPad(builder, x, z, q, y, pads[q]);
    }
  }

  const my = y + ROAD_STYLE.markingY;
  if (isJunction(layers, i, sides)) appendJunctionMarkings(builder, layers, i, x, z, sides, my);
  else if (avenue) appendAvenueLanes(builder, layers, i, x, z, sides, my);
  else appendCenterLines(builder, x, z, geometryMask(layers.roadMask[i]), my);
}

/**
 * Emits the 7×7 cell grid of tile (x, z) for the given side kinds and pads, merging
 * equal cells into rectangles. With `bandsOnly`, only the closed sides' platforms.
 */
export function appendCellGrid(
  builder: GeometryBuilder,
  x: number,
  z: number,
  y: number,
  sides: readonly Side[],
  pads: readonly Pad[],
  bandsOnly: boolean,
): void {
  let openCorner = false;
  for (let cz = 0; cz < CELLS; cz++) {
    for (let cx = 0; cx < CELLS; cx++) {
      cells[cz * CELLS + cx] = cellSurfaceFor(cx, cz, sides, pads, bandsOnly);
    }
  }
  for (let q = 0; q < 4; q++) {
    const xs = CORNER_DX[q] ? Dir.E : Dir.W;
    const zs = CORNER_DZ[q] ? Dir.S : Dir.N;
    if (sides[xs] === Side.Open && sides[zs] === Side.Open) openCorner = true;
  }
  // Tiles with open corners keep rectangles within the pad / middle / pad bands, so every
  // pad corner is a shared vertex: a corner in the middle of a merged edge (a T-vertex)
  // shows as pixel cracks.
  const split = openCorner;

  // Greedy rectangle merge: extend right, then down, over cells of the same surface.
  used.fill(0);
  for (let cz = 0; cz < CELLS; cz++) {
    for (let cx = 0; cx < CELLS; cx++) {
      const k = cz * CELLS + cx;
      if (used[k]) continue;
      const surf = cells[k] as Surf;
      const xEnd = split ? bandEnd(cx) : CELLS;
      const zEnd = split ? bandEnd(cz) : CELLS;
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
 * Raised quarter rings around corner q: sidewalk, verge and curb outward from the
 * corner when `inner`, or inward from radius 1 when not (the outside of a curve).
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

/**
 * Rounded pad in corner q of a junction tile, plus the asphalt around its curb: a
 * sidewalk pad (sidewalk, verge and curb rings) or a median nose (grass and curb), one
 * quarter of the rounded end of a median split over the two avenue halves.
 */
function appendCornerPad(
  b: GeometryBuilder,
  x: number,
  z: number,
  q: number,
  y: number,
  style: Pad,
): void {
  const cx = x + CORNER_DX[q];
  const cz = z + CORNER_DZ[q];
  if (style === Pad.Median) {
    const top = y + PLATFORM_Y;
    ringTop(b, cx, cz, q, 0, EW - CW, top, ROAD_COLORS.verge, ROAD_SURFACE.Verge);
    ringTop(b, cx, cz, q, EW - CW, EW, top, ROAD_COLORS.curb);
    arcWall(b, cx, cz, q, EW, y, top, ROAD_COLORS.curb, true);
  } else {
    appendPlatformArc(b, cx, cz, q, y, true);
  }
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

/** A street curve bending around corner q: every band is a quarter ring around it. */
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
 * Markings on the approaches of a junction: lines stop at the junction box, and
 * approaches that must stop get a stop line across the incoming lane(s). A street
 * approach keeps its double yellow line; its incoming lane is the right-hand one seen
 * from a driver entering the tile. An avenue approach keeps the yellow line along its
 * median, and stops across both lanes.
 */
function appendJunctionMarkings(
  builder: GeometryBuilder,
  layers: RoadLayers,
  i: number,
  x: number,
  z: number,
  sides: readonly Side[],
  y: number,
): void {
  const { stopLineWidth, stopLineInset, centerLineWidth, medianLineOffset } = ROAD_STYLE;
  const stopFar = EW - stopLineInset;
  const stopNear = stopFar - stopLineWidth;
  for (let d = 0; d < 4; d++) {
    if (sides[d] !== Side.Open) continue;
    describeArm(layers, i, d, arm);
    if (arm.kind === ArmKind.None) continue;
    const lineEnd = arm.stops ? stopNear : EW;
    if (arm.kind === ArmKind.TwoWay) {
      appendArmRect(builder, x, z, d, 0, lineEnd, LINE_A0, LINE_A1, y, ROAD_COLORS.centerLine);
      appendArmRect(builder, x, z, d, 0, lineEnd, LINE_B0, LINE_B1, y, ROAD_COLORS.centerLine);
      if (!arm.stops) continue;
      // Entering from the north or east, the right-hand lane is on the low-coordinate side.
      const lowSide = d === Dir.N || d === Dir.E;
      const a0 = lowSide ? EW : LINE_B1;
      const a1 = lowSide ? LINE_A0 : 1 - EW;
      appendArmRect(builder, x, z, d, stopNear, stopFar, a0, a1, y, ROAD_COLORS.stopLine);
    } else {
      const m0 = arm.medianHigh
        ? 1 - EW - medianLineOffset - centerLineWidth
        : EW + medianLineOffset;
      appendArmRect(
        builder,
        x,
        z,
        d,
        0,
        lineEnd,
        m0,
        m0 + centerLineWidth,
        y,
        ROAD_COLORS.centerLine,
      );
      if (arm.stops) {
        appendArmRect(builder, x, z, d, stopNear, stopFar, EW, 1 - EW, y, ROAD_COLORS.stopLine);
      }
    }
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
