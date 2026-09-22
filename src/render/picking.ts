/**
 * Screen → tile picking. The map is flat in phase 1, so an analytic ray/plane test is
 * exact. Phase 4 (terrain) replaces this with a per-chunk heightfield test.
 */

import { Vector3 } from 'three';
import type { Grid } from '../core/grid';
import type { CameraRig } from './camera/cameraRig';

export interface TilePick {
  /** Linear tile index, or -1 when nothing on the map is under the cursor. */
  index: number;
  x: number;
  z: number;
  /** Exact ground hit point in world units (valid when a ray hit the ground plane). */
  worldX: number;
  worldZ: number;
}

const hit = new Vector3();

export function createTilePick(): TilePick {
  return { index: -1, x: -1, z: -1, worldX: 0, worldZ: 0 };
}

/** Picks the tile under normalised device coordinates. Writes into `out` and returns it. */
export function pickTile(
  rig: CameraRig,
  grid: Grid,
  ndcX: number,
  ndcY: number,
  out: TilePick,
): TilePick {
  out.index = -1;
  out.x = -1;
  out.z = -1;
  if (!rig.groundPointAtNdc(ndcX, ndcY, hit)) return out;
  out.worldX = hit.x;
  out.worldZ = hit.z;
  const x = Math.floor(hit.x);
  const z = Math.floor(hit.z);
  if (!grid.inBounds(x, z)) return out;
  out.x = x;
  out.z = z;
  out.index = grid.index(x, z);
  return out;
}
