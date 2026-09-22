/**
 * Road drag planning: turns a drag from tile A to tile B into the list of tiles a road
 * would occupy. Straight lines only for now: the drag snaps to the axis with the larger
 * extent (ties go to the x axis). L-shaped paths arrive together with corner pieces.
 */

import type { Grid } from '../../core/grid';

/**
 * Writes the tile indices of the straight road from (ax, az) toward (bx, bz) into `out`
 * (cleared first), ordered from the start tile. The start tile is clamped to the map; the
 * line is clipped at the map edge. Returns `out`.
 */
export function planStraightRoad(
  grid: Grid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  out: number[] = [],
): number[] {
  out.length = 0;
  const sx = clamp(ax, 0, grid.width - 1);
  const sz = clamp(az, 0, grid.height - 1);
  const dx = bx - sx;
  const dz = bz - sz;
  const alongX = Math.abs(dx) >= Math.abs(dz);
  const steps = alongX ? Math.abs(dx) : Math.abs(dz);
  const stepX = alongX ? Math.sign(dx) : 0;
  const stepZ = alongX ? 0 : Math.sign(dz);

  for (let s = 0; s <= steps; s++) {
    const x = sx + stepX * s;
    const z = sz + stepZ * s;
    if (!grid.inBounds(x, z)) break;
    out.push(grid.index(x, z));
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
