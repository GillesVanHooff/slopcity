/**
 * Authoritative world state as flat typed-array layers (plan.md §4).
 *
 * Phase 1 only needs terrain (corner heights + surface type). Road, zone, building and
 * simulation layers are added by later phases. Pure module: no three / DOM imports.
 */

import { Grid } from '../core/grid';

export const Surface = {
  Grass: 0,
  Sand: 1,
  Water: 2,
  Rock: 3,
} as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

export interface WorldOptions {
  size: number;
  chunkSize: number;
  seed: number;
}

export class World {
  readonly grid: Grid;
  readonly seed: number;

  /** Terrain height at tile corners, (width + 1) * (height + 1) entries. */
  readonly height: Float32Array;
  /** Surface type per tile. */
  readonly surface: Uint8Array;

  constructor(opts: WorldOptions) {
    this.grid = new Grid(opts.size, opts.size, opts.chunkSize);
    this.seed = opts.seed >>> 0;
    this.height = new Float32Array((this.grid.width + 1) * (this.grid.height + 1));
    this.surface = new Uint8Array(this.grid.size).fill(Surface.Grass);
  }

  /** Number of corner columns in the height layer. */
  get cornerStride(): number {
    return this.grid.width + 1;
  }

  /** Height at corner (cx, cz), where 0 <= cx <= width and 0 <= cz <= height. */
  cornerHeight(cx: number, cz: number): number {
    return this.height[cz * this.cornerStride + cx];
  }

  /** Average height of a tile's four corners. */
  tileHeight(x: number, z: number): number {
    const s = this.cornerStride;
    const i = z * s + x;
    return (this.height[i] + this.height[i + 1] + this.height[i + s] + this.height[i + s + 1]) / 4;
  }
}
