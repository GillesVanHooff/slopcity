/**
 * Road drag planning: turns a drag from tile A to tile B into the list of tiles a road
 * would occupy. An axis-aligned drag gives a straight road; any other drag gives an
 * L-shape that runs along one axis to the bend, then along the other (plan.md §5.2).
 * The road tool decides which leg comes first from the way the player started dragging.
 */

import type { Grid } from '../../core/grid';

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

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
