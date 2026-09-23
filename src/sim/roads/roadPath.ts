/**
 * Road drag planning: turns a drag from A to B into the list of tiles a road would
 * occupy. An axis-aligned drag gives a straight road; any other drag gives an L-shape
 * that runs along one axis to the bend, then along the other (plan.md §5.2). The road
 * tool decides which leg comes first from the way the player started dragging.
 *
 * Streets are dragged tile to tile. Avenues (2 tiles wide) are dragged along grid lines,
 * from tile corner to tile corner: the median runs on the line, one half on each side.
 */

import { DIR_BIT, Dir, type Grid } from '../../core/grid';

/**
 * Writes the tile indices of the road from (ax, az) to (bx, bz) into `out` (cleared
 * first), ordered from the start tile. `xFirst` picks the L-shape's first leg: along x
 * (then z) or along z (then x); it doesn't matter for straight drags. Both ends are
 * clamped to the map. Returns `out`.
 */
export function planRoad(
  grid: Grid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  xFirst: boolean,
  out: number[] = [],
): number[] {
  out.length = 0;
  const sx = clamp(ax, 0, grid.width - 1);
  const sz = clamp(az, 0, grid.height - 1);
  const ex = clamp(bx, 0, grid.width - 1);
  const ez = clamp(bz, 0, grid.height - 1);
  // The bend tile; equal to one of the ends for a straight road.
  const kx = xFirst ? ex : sx;
  const kz = xFirst ? sz : ez;

  out.push(grid.index(sx, sz));
  appendLeg(grid, sx, sz, kx, kz, out);
  appendLeg(grid, kx, kz, ex, ez, out);
  return out;
}

/** Appends the tiles after (x0, z0) up to and including (x1, z1) on an axis-aligned leg. */
function appendLeg(
  grid: Grid,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  out: number[],
): void {
  const stepX = Math.sign(x1 - x0);
  const stepZ = Math.sign(z1 - z0);
  const steps = Math.abs(x1 - x0) + Math.abs(z1 - z0);
  for (let s = 1; s <= steps; s++) out.push(grid.index(x0 + stepX * s, z0 + stepZ * s));
}

/**
 * Avenue path from corner (ax, az) to corner (bx, bz) (corners run 0..width, 0..height).
 * Writes the tiles into `tiles` (cleared first) in path order and, in `medians`, the
 * sides of each tile facing its median partner (roadMedian bits). An L-shape bends as a
 * 2×2 block: the inner tile belongs to both legs (two median bits), and the outer tile,
 * which neither leg covers, is added with no median bits (it holds the outside of the
 * curve). A drag that doesn't move plans nothing. Both ends are clamped so the halves on
 * both sides of each leg lie on the map.
 */
export function planAvenue(
  grid: Grid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  xFirst: boolean,
  tiles: number[],
  medians: number[],
): void {
  tiles.length = 0;
  medians.length = 0;
  const { width: w, height: h } = grid;
  const sx = clamp(ax, 0, w);
  const sz = clamp(az, 0, h);
  const ex = clamp(bx, 0, w);
  const ez = clamp(bz, 0, h);
  if (sx === ex && sz === ez) return;
  if (sz === ez) xFirst = true;
  else if (sx === ex) xFirst = false;

  planned.clear();
  // First leg along its axis to the bend, then the second leg along the other axis. Each
  // leg's grid line is kept one tile inside the map so both halves fit.
  let bendX = -1;
  let bendZ = -1;
  if (xFirst) {
    const hasZ = sz !== ez;
    const lz = clamp(sz, 1, h - 1);
    const lx = hasZ ? clamp(ex, 1, w - 1) : ex;
    const hasX = sx !== lx;
    if (hasX) appendLegX(grid, lz, sx, lx);
    if (hasZ) appendLegZ(grid, lx, hasX ? lz : sz, ez);
    if (hasX && hasZ) [bendX, bendZ] = [lx, lz];
  } else {
    const hasX = sx !== ex;
    const lx = clamp(sx, 1, w - 1);
    const lz = hasX ? clamp(ez, 1, h - 1) : ez;
    const hasZ = sz !== lz;
    if (hasZ) appendLegZ(grid, lx, sz, lz);
    if (hasX) appendLegX(grid, lz, hasZ ? lx : sx, ex);
    if (hasX && hasZ) [bendX, bendZ] = [lx, lz];
  }
  if (bendX >= 0) {
    // The outer tile of the bend: the one tile of the 2×2 block around the bend corner
    // that neither leg covers.
    for (let dz = -1; dz <= 0; dz++) {
      for (let dx = -1; dx <= 0; dx++) {
        const i = grid.index(bendX + dx, bendZ + dz);
        if (!planned.has(i)) planned.set(i, 0);
      }
    }
  }
  for (const [i, bits] of planned) {
    tiles.push(i);
    medians.push(bits);
  }
}

/** Scratch: planned avenue tile → median bits, in path order. */
const planned = new Map<number, number>();

function addPlanned(i: number, bits: number): void {
  planned.set(i, (planned.get(i) ?? 0) | bits);
}

/** Avenue leg along x on the grid line z = line, from corner x0 to corner x1. */
function appendLegX(grid: Grid, line: number, x0: number, x1: number): void {
  const step = Math.sign(x1 - x0);
  for (let x = x0; x !== x1; x += step) {
    const col = step > 0 ? x : x - 1;
    addPlanned(grid.index(col, line - 1), DIR_BIT[Dir.S]);
    addPlanned(grid.index(col, line), DIR_BIT[Dir.N]);
  }
}

/** Avenue leg along z on the grid line x = line, from corner z0 to corner z1. */
function appendLegZ(grid: Grid, line: number, z0: number, z1: number): void {
  const step = Math.sign(z1 - z0);
  for (let z = z0; z !== z1; z += step) {
    const row = step > 0 ? z : z - 1;
    addPlanned(grid.index(line - 1, row), DIR_BIT[Dir.E]);
    addPlanned(grid.index(line, row), DIR_BIT[Dir.W]);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
