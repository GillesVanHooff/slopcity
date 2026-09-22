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
 * A tile is split into a 7×7 grid of cells at those boundaries. Each cell gets a surface
 * from the tile's connection mask, then equal neighbouring cells are merged into larger
 * rectangles to keep the triangle count low. The rules give a straight road, a dead end
 * (the platform wraps around the end) and a placeholder for corners / T-junctions /
 * crossings (asphalt continues, curbed sidewalk corner pads). Proper intersection pieces
 * come in a later step.
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
} as const;

/**
 * Surface ids written to the `aSurface` vertex attribute, read by the road material.
 * Sidewalk slabs need to know which way the sidewalk runs.
 */
export const ROAD_SURFACE = {
  Plain: 0,
  SidewalkAlongX: 1,
  SidewalkAlongZ: 2,
  Verge: 3,
} as const;

export const Surf = { Asphalt: 0, Curb: 1, Verge: 2, Sidewalk: 3 } as const;
export type Surf = (typeof Surf)[keyof typeof Surf];

const { sidewalkWidth: SW, vergeWidth: VW, edgeWidth: EW } = ROAD_STYLE;
/** Cell boundaries along each axis (7 cells). */
const EDGES = [0, SW, SW + VW, EW, 1 - EW, 1 - SW - VW, 1 - SW, 1] as const;
const CELLS = 7;
const MID = 3;
/** Platform layer by distance from the tile edge: 0 sidewalk, 1 verge, 2 curb. */
const LAYER_SURF: readonly Surf[] = [Surf.Sidewalk, Surf.Verge, Surf.Curb];

// Scratch cell grid and visited flags (indexed [z * CELLS + x]).
const cells = new Uint8Array(CELLS * CELLS);
const used = new Uint8Array(CELLS * CELLS);

/**
 * Connection mask used for geometry. An isolated tile (mask 0) is drawn as an east-west
 * street so a single placed tile still reads as a road.
 */
export function geometryMask(mask: number): number {
  return mask === 0 ? DIR_BIT[Dir.E] | DIR_BIT[Dir.W] : mask;
}

/** Platform layer of cell index `c` (0..6) counted from the nearer tile edge; 3 = middle. */
function layerOf(c: number): number {
  return c < MID ? c : CELLS - 1 - c;
}

/** Surface of cell (cx, cz) of the 7×7 grid for the given (geometry) mask. */
export function cellSurface(cx: number, cz: number, mask: number): Surf {
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
  // Both sides connected: a sidewalk corner pad, curbed along its asphalt edges.
  return lx === 2 || lz === 2 ? Surf.Curb : Surf.Sidewalk;
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
  for (let cz = 0; cz < CELLS; cz++) {
    for (let cx = 0; cx < CELLS; cx++) cells[cz * CELLS + cx] = cellSurface(cx, cz, m);
  }

  // Greedy rectangle merge: extend right, then down, over cells of the same surface.
  used.fill(0);
  for (let cz = 0; cz < CELLS; cz++) {
    for (let cx = 0; cx < CELLS; cx++) {
      const k = cz * CELLS + cx;
      if (used[k]) continue;
      const surf = cells[k] as Surf;
      let w = 1;
      while (cx + w < CELLS && !used[k + w] && cells[k + w] === surf) w++;
      let h = 1;
      grow: while (cz + h < CELLS) {
        for (let i = 0; i < w; i++) {
          const kk = (cz + h) * CELLS + cx + i;
          if (used[kk] || cells[kk] !== surf) break grow;
        }
        h++;
      }
      for (let j = 0; j < h; j++) {
        used.fill(1, (cz + j) * CELLS + cx, (cz + j) * CELLS + cx + w);
      }
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

  appendCenterLines(builder, x, z, m, y + ROAD_STYLE.markingY);
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
  const top = y + ROAD_STYLE.platformY;
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

/** Double yellow line from the tile centre to each connected edge. */
function appendCenterLines(
  builder: GeometryBuilder,
  x: number,
  z: number,
  mask: number,
  y: number,
): void {
  const half = ROAD_STYLE.centerLineGap / 2;
  const lw = ROAD_STYLE.centerLineWidth;
  const c = ROAD_COLORS.centerLine;
  // Offsets of the two lines from the road's centre axis.
  const a0 = 0.5 - half - lw;
  const a1 = 0.5 - half;
  const b0 = 0.5 + half;
  const b1 = 0.5 + half + lw;
  const n = (mask & DIR_BIT[Dir.N]) !== 0;
  const s = (mask & DIR_BIT[Dir.S]) !== 0;
  const e = (mask & DIR_BIT[Dir.E]) !== 0;
  const w = (mask & DIR_BIT[Dir.W]) !== 0;

  // Runs along z (north/south connections); merged into one run for straight roads.
  if (n || s) {
    const z0 = z + (n ? 0 : 0.5);
    const z1 = z + (s ? 1 : 0.5);
    builder.quadUp(x + a0, z0, x + a1, z1, y, c);
    builder.quadUp(x + b0, z0, x + b1, z1, y, c);
  }
  // Runs along x (east/west connections).
  if (e || w) {
    const x0 = x + (w ? 0 : 0.5);
    const x1 = x + (e ? 1 : 0.5);
    builder.quadUp(x0, z + a0, x1, z + a1, y, c);
    builder.quadUp(x0, z + b0, x1, z + b1, y, c);
  }
}
