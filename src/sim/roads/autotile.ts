/**
 * Road connection masks. Every road tile connects to each cardinal neighbour that is also
 * a road, like SimCity 4. The mask (N=1, E=2, S=4, W=8) is cached in `world.roadMask` and
 * drives which piece the renderer draws (straight, dead end, corner, T, crossing).
 */

import { DIR_BIT, DIR_DX, DIR_DZ } from '../../core/grid';
import type { World } from '../world';

/** Computes the connection mask of tile `i` from the road layer (0 for non-road tiles). */
export function computeRoadMask(world: World, i: number): number {
  const { grid, road } = world;
  if (road[i] === 0) return 0;
  const x = grid.x(i);
  const z = grid.z(i);
  let mask = 0;
  for (let d = 0; d < 4; d++) {
    const n = grid.indexSafe(x + DIR_DX[d], z + DIR_DZ[d]);
    if (n !== -1 && road[n] !== 0) mask |= DIR_BIT[d];
  }
  return mask;
}

/**
 * Recomputes the masks of the given tiles and their four neighbours. Calls `touched` for
 * every tile whose mask was recomputed (so callers can mark render chunks dirty).
 */
export function updateRoadMasks(
  world: World,
  tiles: readonly number[],
  touched: (i: number) => void,
): void {
  const { grid, roadMask } = world;
  for (const i of tiles) {
    const x = grid.x(i);
    const z = grid.z(i);
    roadMask[i] = computeRoadMask(world, i);
    touched(i);
    for (let d = 0; d < 4; d++) {
      const n = grid.indexSafe(x + DIR_DX[d], z + DIR_DZ[d]);
      if (n === -1) continue;
      roadMask[n] = computeRoadMask(world, n);
      touched(n);
    }
  }
}
