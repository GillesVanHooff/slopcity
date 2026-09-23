/**
 * Avenue topology. An avenue is two tiles wide: each tile is one half (two lanes one
 * way) and `roadMedian` records which of its sides face its median partner, the other
 * half. From those bits and the connection masks this module works out:
 *
 *  - curve blocks: a 90° bend is a 2×2 block with an inner tile (two median bits, one
 *    per leg), two halves partnered with it, and an outer tile with no median bits. It's
 *    drawn as one smooth curve as long as nothing else joins the block from outside;
 *    otherwise the block is treated as a junction;
 *  - where the median opens for a crossing road (a junction), or stays closed;
 *  - which tiles must be bulldozed together so no half-avenue is left behind.
 *
 * Pure module (plan.md rule 1); evaluated on demand when roads change or render.
 */

import { DIR_BIT, DIR_DX, DIR_DZ, oppositeDir, type Dir } from '../../core/grid';
import { ROADS } from '../../config';
import type { RoadLayers } from '../world';

export const AVENUE_ID = ROADS.avenue.id;

/** Number of set bits in a 4-bit side mask. */
export function bitCount(mask: number): number {
  return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
}

/** The single direction in a one-bit side mask. */
export function dirOfBit(bit: number): Dir {
  return (bit === 1 ? 0 : bit === 2 ? 1 : bit === 4 ? 2 : 3) as Dir;
}

/** Tile index of the neighbour of tile i in direction d, or -1 off the map. */
export function neighborOf(layers: RoadLayers, i: number, d: number): number {
  const { grid } = layers;
  return grid.indexSafe(grid.x(i) + DIR_DX[d], grid.z(i) + DIR_DZ[d]);
}

export function isAvenue(layers: RoadLayers, i: number): boolean {
  return i >= 0 && layers.road[i] === AVENUE_ID;
}

/**
 * Median bits are valid when there are at most two and they aren't opposite (a tile
 * can't be the middle of an avenue three tiles wide).
 */
export function isValidMedian(bits: number): boolean {
  if (bitCount(bits) > 2) return false;
  return bits !== (DIR_BIT[0] | DIR_BIT[2]) && bits !== (DIR_BIT[1] | DIR_BIT[3]);
}

/** Perpendicular median bits of a curve inner tile or junction tile, in a fixed order. */
export interface MedianPair {
  d1: Dir;
  d2: Dir;
}

/** Splits two perpendicular median bits into their directions (d1 < d2). */
export function medianPair(bits: number, out: MedianPair): boolean {
  if (bitCount(bits) !== 2 || !isValidMedian(bits)) return false;
  let k = 0;
  for (let d = 0; d < 4; d++) {
    if ((bits & DIR_BIT[d]) === 0) continue;
    if (k++ === 0) out.d1 = d as Dir;
    else out.d2 = d as Dir;
  }
  return true;
}

const pair: MedianPair = { d1: 0, d2: 1 };

/**
 * True when tile i is the inner tile of a smooth avenue curve: two perpendicular median
 * bits (d1, d2), halves partnered with it at i+d1 and i+d2, an outer tile at i+d1+d2
 * with no median bits, and no road joining the block except along the two legs.
 */
export function isCurveInner(layers: RoadLayers, i: number): boolean {
  if (!isAvenue(layers, i)) return false;
  const { roadMedian, roadMask } = layers;
  if (!medianPair(roadMedian[i], pair)) return false;
  const { d1, d2 } = pair;
  const h1 = neighborOf(layers, i, d1);
  const h2 = neighborOf(layers, i, d2);
  if (!isAvenue(layers, h1) || !isAvenue(layers, h2)) return false;
  if (roadMedian[h1] !== DIR_BIT[oppositeDir(d1)]) return false;
  if (roadMedian[h2] !== DIR_BIT[oppositeDir(d2)]) return false;
  const outer = neighborOf(layers, h1, d2);
  if (!isAvenue(layers, outer) || roadMedian[outer] !== 0) return false;
  // Sides of the block that aren't legs must stay free.
  if (roadMask[h1] & DIR_BIT[d1]) return false;
  if (roadMask[h2] & DIR_BIT[d2]) return false;
  if (roadMask[outer] & (DIR_BIT[d1] | DIR_BIT[d2])) return false;
  return true;
}

/**
 * The inner tile of the smooth avenue curve that tile i belongs to, or -1 when i isn't
 * part of one.
 */
export function curveInnerOf(layers: RoadLayers, i: number): number {
  if (!isAvenue(layers, i)) return -1;
  const bits = layers.roadMedian[i];
  const n = bitCount(bits);
  if (n === 2) return isCurveInner(layers, i) ? i : -1;
  if (n === 1) {
    const p = neighborOf(layers, i, dirOfBit(bits));
    return isCurveInner(layers, p) ? p : -1;
  }
  // No median bits: the outer tile; the inner one is diagonal from it.
  const { grid } = layers;
  const x = grid.x(i);
  const z = grid.z(i);
  for (const dz of [-1, 1]) {
    for (const dx of [-1, 1]) {
      const c = grid.indexSafe(x + dx, z + dz);
      if (c < 0 || !isCurveInner(layers, c)) continue;
      // Its median bits must point back toward this tile.
      const want = DIR_BIT[dx > 0 ? 3 : 1] | DIR_BIT[dz > 0 ? 0 : 2];
      if (layers.roadMedian[c] === want) return c;
    }
  }
  return -1;
}

/**
 * Whether the median of avenue tile i is open on side d (a median bit): true at
 * junctions, where a crossing road needs the gap. A plain half opens when a road joins
 * its outer side or its partner's outer side; tiles with two median bits outside a
 * smooth curve are junction tiles and always open.
 */
export function isMedianOpen(layers: RoadLayers, i: number, d: Dir): boolean {
  const { roadMedian, roadMask } = layers;
  const bits = roadMedian[i];
  if ((bits & DIR_BIT[d]) === 0) return false;
  if (bitCount(bits) === 2) return !isCurveInner(layers, i);
  const p = neighborOf(layers, i, d);
  if (p < 0) return false;
  if (roadMask[i] & DIR_BIT[oppositeDir(d)]) return true;
  if (roadMask[p] & DIR_BIT[d]) return true;
  // Partnered with a junction tile (two median bits): part of the junction.
  return bitCount(roadMedian[p]) === 2 && !isCurveInner(layers, p);
}

/**
 * Adds to `set` every avenue tile that has to go together with the tiles already in it,
 * so bulldozing never leaves half an avenue: median partners, and the diagonal tile of
 * every two-bit tile (the outer tile of a curve, or the rest of a junction box).
 */
export function expandAvenueRemoval(layers: RoadLayers, set: Set<number>): void {
  const { grid, roadMedian } = layers;
  const stack = [...set];
  const add = (j: number) => {
    if (j < 0 || set.has(j) || !isAvenue(layers, j)) return;
    set.add(j);
    stack.push(j);
  };
  while (stack.length > 0) {
    const i = stack.pop()!;
    if (!isAvenue(layers, i)) continue;
    const bits = roadMedian[i];
    for (let d = 0; d < 4; d++) {
      if (bits & DIR_BIT[d]) add(neighborOf(layers, i, d));
    }
    const x = grid.x(i);
    const z = grid.z(i);
    if (medianPair(bits, pair)) {
      add(
        grid.indexSafe(
          x + DIR_DX[pair.d1] + DIR_DX[pair.d2],
          z + DIR_DZ[pair.d1] + DIR_DZ[pair.d2],
        ),
      );
    } else if (bits === 0) {
      // Outer tile of a curve: its inner tile is a diagonal neighbour pointing at it.
      for (const dz of [-1, 1]) {
        for (const dx of [-1, 1]) {
          const c = grid.indexSafe(x + dx, z + dz);
          if (c < 0 || !isAvenue(layers, c)) continue;
          if (roadMedian[c] === (DIR_BIT[dx > 0 ? 3 : 1] | DIR_BIT[dz > 0 ? 0 : 2])) add(c);
        }
      }
    }
  }
}
