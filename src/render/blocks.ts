/**
 * Render blocks: the map split into squares of RENDER.renderBlockSize tiles, each drawn as
 * one merged mesh per layer (terrain, roads). Blocks are larger than sim chunks to keep
 * draw calls low; this maps dirty sim chunks to the blocks that must be rebuilt.
 */

import { Grid } from '../core/grid';

export class RenderBlocks {
  /** Block layout over the same tiles as the world grid (one "chunk" = one block). */
  readonly layout: Grid;
  private readonly world: Grid;
  private readonly bounds = new Int32Array(4);

  constructor(worldGrid: Grid, blockSize: number) {
    this.world = worldGrid;
    this.layout = new Grid(worldGrid.width, worldGrid.height, blockSize);
  }

  get count(): number {
    return this.layout.chunkCount;
  }

  /** Tile bounds [x0, z0, x1, z1) of block `b`. */
  blockBounds(b: number, out: Int32Array | number[]): void {
    this.layout.chunkBounds(b, out);
  }

  /** Adds the blocks overlapping sim chunk `chunk` to `out`. */
  addBlocksForChunk(chunk: number, out: Set<number>): void {
    this.world.chunkBounds(chunk, this.bounds);
    const [x0, z0, x1, z1] = this.bounds;
    const first = this.layout.chunkOf(x0, z0);
    const last = this.layout.chunkOf(x1 - 1, z1 - 1);
    for (let bz = this.layout.chunkZ(first); bz <= this.layout.chunkZ(last); bz++) {
      for (let bx = this.layout.chunkX(first); bx <= this.layout.chunkX(last); bx++) {
        out.add(bz * this.layout.chunksX + bx);
      }
    }
  }
}
