/**
 * Tile-grid index math shared by every system.
 *
 * Tiles are addressed by linear index `i = z * width + x` (x runs east, z runs south).
 * All helpers are allocation-free so they can be used in hot loops.
 */

/** Cardinal directions. Values double as indices into DIR_DX / DIR_DZ. */
export const Dir = { N: 0, E: 1, S: 2, W: 3 } as const;
export type Dir = (typeof Dir)[keyof typeof Dir];

/** X offset per direction (N, E, S, W). */
export const DIR_DX: readonly number[] = [0, 1, 0, -1];
/** Z offset per direction (N, E, S, W). North is -z. */
export const DIR_DZ: readonly number[] = [-1, 0, 1, 0];
/** Bit for each direction in a 4-bit neighbour mask (N=1, E=2, S=4, W=8). */
export const DIR_BIT: readonly number[] = [1, 2, 4, 8];

/** Direction pointing the other way. */
export function oppositeDir(d: Dir): Dir {
  return ((d + 2) & 3) as Dir;
}

export class Grid {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly chunkSize: number;
  readonly chunksX: number;
  readonly chunksZ: number;
  readonly chunkCount: number;

  constructor(width: number, height: number, chunkSize: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError(`Invalid grid size ${width}x${height}`);
    }
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
      throw new RangeError(`Invalid chunk size ${chunkSize}`);
    }
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.chunkSize = chunkSize;
    this.chunksX = Math.ceil(width / chunkSize);
    this.chunksZ = Math.ceil(height / chunkSize);
    this.chunkCount = this.chunksX * this.chunksZ;
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.height;
  }

  /** Linear index of tile (x, z). Caller guarantees bounds. */
  index(x: number, z: number): number {
    return z * this.width + x;
  }

  /** Linear index, or -1 when out of bounds. */
  indexSafe(x: number, z: number): number {
    return this.inBounds(x, z) ? z * this.width + x : -1;
  }

  x(i: number): number {
    return i % this.width;
  }

  z(i: number): number {
    return (i / this.width) | 0;
  }

  /** Index of the neighbouring tile in direction `d`, or -1 at the map edge. */
  neighbor(i: number, d: Dir): number {
    return this.indexSafe(this.x(i) + DIR_DX[d], this.z(i) + DIR_DZ[d]);
  }

  /**
   * Builds a 4-bit mask of which cardinal neighbours satisfy `pred`
   * (N=1, E=2, S=4, W=8). Out-of-bounds neighbours never match.
   */
  neighborMask(i: number, pred: (neighborIndex: number) => boolean): number {
    const x = this.x(i);
    const z = this.z(i);
    let mask = 0;
    for (let d = 0; d < 4; d++) {
      const n = this.indexSafe(x + DIR_DX[d], z + DIR_DZ[d]);
      if (n !== -1 && pred(n)) mask |= DIR_BIT[d];
    }
    return mask;
  }

  /** Chunk index containing tile (x, z). */
  chunkOf(x: number, z: number): number {
    return ((z / this.chunkSize) | 0) * this.chunksX + ((x / this.chunkSize) | 0);
  }

  chunkOfIndex(i: number): number {
    return this.chunkOf(this.x(i), this.z(i));
  }

  chunkX(c: number): number {
    return c % this.chunksX;
  }

  chunkZ(c: number): number {
    return (c / this.chunksX) | 0;
  }

  /** Inclusive-exclusive tile bounds of a chunk, written into `out` as [x0, z0, x1, z1]. */
  chunkBounds(c: number, out: Int32Array | number[]): void {
    const x0 = this.chunkX(c) * this.chunkSize;
    const z0 = this.chunkZ(c) * this.chunkSize;
    out[0] = x0;
    out[1] = z0;
    out[2] = Math.min(x0 + this.chunkSize, this.width);
    out[3] = Math.min(z0 + this.chunkSize, this.height);
  }

  /**
   * Visits every tile in the rectangle spanned by two corners (inclusive, any order),
   * clipped to the map.
   */
  forEachInRect(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    fn: (i: number, x: number, z: number) => void,
  ): void {
    const x0 = Math.max(0, Math.min(ax, bx));
    const x1 = Math.min(this.width - 1, Math.max(ax, bx));
    const z0 = Math.max(0, Math.min(az, bz));
    const z1 = Math.min(this.height - 1, Math.max(az, bz));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) fn(z * this.width + x, x, z);
    }
  }
}
