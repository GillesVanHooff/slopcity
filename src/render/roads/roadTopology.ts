/**
 * How a road tile meets its surroundings, derived from the road layers for the geometry
 * builder: what each side of the tile is (open to a connected road, closed by the
 * sidewalk platform, or closed by an avenue median), what goes in each corner between
 * two open sides (a sidewalk pad, a median nose or plain asphalt), and the lane layout
 * of each approach of a junction. Pure logic, evaluated when a render block rebuilds.
 *
 * Corner pads take their style from the neighbours: the band that runs along the
 * neighbouring tile's side into that corner (sidewalk platform, or median) continues
 * as a rounded pad, so a street corner gets a sidewalk pad and the end of a median gets
 * a rounded grass nose, split across the two avenue halves.
 */

import { DIR_BIT, DIR_DX, DIR_DZ, Dir, oppositeDir } from '../../core/grid';
import {
  bitCount,
  curveInnerOf,
  dirOfBit,
  isAvenue,
  isMedianOpen,
  medianPair,
  neighborOf,
  type MedianPair,
} from '../../sim/roads/avenue';
import type { RoadLayers } from '../../sim/world';
import { Corner } from './roadStyle';

export const Side = { Open: 0, Sidewalk: 1, Median: 2 } as const;
export type Side = (typeof Side)[keyof typeof Side];

/** What fills a corner between two open sides. */
export const Pad = { None: 0, Sidewalk: 1, Median: 2 } as const;
export type Pad = (typeof Pad)[keyof typeof Pad];

/**
 * Connection mask used for street geometry. An isolated street tile (mask 0) is drawn as
 * an east-west street so a single placed tile still reads as a road.
 */
export function geometryMask(mask: number): number {
  return mask === 0 ? DIR_BIT[Dir.E] | DIR_BIT[Dir.W] : mask;
}

/**
 * The corner a street curve bends around, or -1 when the mask isn't a curve (exactly two
 * adjacent connections).
 */
export function curveCorner(mask: number): number {
  switch (mask) {
    case DIR_BIT[Dir.N] | DIR_BIT[Dir.W]:
      return Corner.NW;
    case DIR_BIT[Dir.N] | DIR_BIT[Dir.E]:
      return Corner.NE;
    case DIR_BIT[Dir.S] | DIR_BIT[Dir.E]:
      return Corner.SE;
    case DIR_BIT[Dir.S] | DIR_BIT[Dir.W]:
      return Corner.SW;
    default:
      return -1;
  }
}

/** The corner between an x-side (W or E) and a z-side (N or S). */
export function cornerOf(xSide: Dir, zSide: Dir): Corner {
  if (zSide === Dir.N) return xSide === Dir.W ? Corner.NW : Corner.NE;
  return xSide === Dir.W ? Corner.SW : Corner.SE;
}

/** The sides of an avenue curve inner tile, given as its perpendicular median bits. */
const pair: MedianPair = { d1: 0, d2: 1 };

/**
 * True when side d of tile i (part of the avenue curve with inner tile `inner`) is one
 * of the curve's legs: an edge where the avenue continues straight.
 */
export function isCurveLeg(layers: RoadLayers, inner: number, i: number, d: number): boolean {
  if (!medianPair(layers.roadMedian[inner], pair)) return false;
  const { d1, d2 } = pair;
  if (i === inner) return d === oppositeDir(d1) || d === oppositeDir(d2);
  if (i === neighborOf(layers, inner, d1)) return d === oppositeDir(d2);
  if (i === neighborOf(layers, inner, d2)) return d === oppositeDir(d1);
  return false;
}

/** What side d of road tile i is. */
export function sideKind(layers: RoadLayers, i: number, d: number): Side {
  const { roadMask, roadMedian } = layers;
  if (!isAvenue(layers, i)) {
    return geometryMask(roadMask[i]) & DIR_BIT[d] ? Side.Open : Side.Sidewalk;
  }
  const bit = DIR_BIT[d];
  const inner = curveInnerOf(layers, i);
  if (inner >= 0) {
    // A smooth curve: its median runs along the median sides; legs open where the
    // avenue continues; everything else is the curve's sidewalk.
    if (roadMedian[i] & bit) return Side.Median;
    if (isCurveLeg(layers, inner, i, d)) return roadMask[i] & bit ? Side.Open : Side.Sidewalk;
    return Side.Sidewalk;
  }
  if (roadMedian[i] & bit) return isMedianOpen(layers, i, d as Dir) ? Side.Open : Side.Median;
  return roadMask[i] & bit ? Side.Open : Side.Sidewalk;
}

/**
 * True when the corner between open sides s and t of tile u is the centre of a curve,
 * where the curve's inner sidewalk sits.
 */
function isCurveCentre(layers: RoadLayers, u: number, s: number, t: number): boolean {
  if (!isAvenue(layers, u)) return curveCorner(geometryMask(layers.roadMask[u])) !== -1;
  const inner = curveInnerOf(layers, u);
  return inner === u && isCurveLeg(layers, u, u, s) && isCurveLeg(layers, u, u, t);
}

/**
 * The band tile u has in its corner between side s (facing the asking tile) and side t:
 * the closed band along side t, or, when t is open too, the pad in that corner.
 */
function cornerBand(layers: RoadLayers, u: number, s: number, t: number, depth: number): Pad {
  const kind = sideKind(layers, u, t);
  if (kind === Side.Sidewalk) return Pad.Sidewalk;
  if (kind === Side.Median) return Pad.Median;
  if (isCurveCentre(layers, u, s, t)) return Pad.Sidewalk;
  // Another junction corner: follow it one step, no further (junction boxes would loop).
  return depth > 0 ? Pad.None : padStyle(layers, u, s, t, depth + 1);
}

/**
 * What fills the corner of tile i between its open sides a and b: the band the
 * neighbours carry into that corner, or plain asphalt inside a junction box.
 */
export function padStyle(layers: RoadLayers, i: number, a: number, b: number, depth = 0): Pad {
  for (let k = 0; k < 2; k++) {
    const s = k === 0 ? a : b;
    const t = k === 0 ? b : a;
    const u = neighborOf(layers, i, s);
    if (u < 0 || layers.road[u] === 0) continue;
    const band = cornerBand(layers, u, oppositeDir(s as Dir), t, depth);
    if (band !== Pad.None) return band;
  }
  return Pad.None;
}

/** Sides and corner pads of a tile drawn with the cell grid. */
export interface TileSides {
  /** Per direction (N, E, S, W). */
  sides: Side[];
  /** Per corner (NW, NE, SE, SW); only meaningful where both sides are open. */
  pads: Pad[];
}

export function createTileSides(): TileSides {
  return { sides: [0, 0, 0, 0], pads: [0, 0, 0, 0] };
}

const CORNER_SIDES: readonly (readonly [Dir, Dir])[] = [
  [Dir.W, Dir.N],
  [Dir.E, Dir.N],
  [Dir.E, Dir.S],
  [Dir.W, Dir.S],
];

export function describeTileSides(layers: RoadLayers, i: number, out: TileSides): TileSides {
  for (let d = 0; d < 4; d++) out.sides[d] = sideKind(layers, i, d);
  for (let q = 0; q < 4; q++) {
    const [xs, zs] = CORNER_SIDES[q];
    const open = out.sides[xs] === Side.Open && out.sides[zs] === Side.Open;
    out.pads[q] = open ? padStyle(layers, i, xs, zs) : Pad.None;
  }
  return out;
}

/**
 * True when tile i needs junction markings: a street with three or four connections, or
 * an avenue tile where something crosses (median open, or a road on the outer side).
 */
export function isJunction(layers: RoadLayers, i: number, sides: readonly Side[]): boolean {
  if (!isAvenue(layers, i)) return bitCount(geometryMask(layers.roadMask[i])) > 2;
  const bits = layers.roadMedian[i];
  if (bitCount(bits) !== 1) return true;
  const p = dirOfBit(bits);
  return sides[p] === Side.Open || sides[oppositeDir(p)] === Side.Open;
}

/** Lane layout of the approach on one side of a junction tile. */
export const ArmKind = { None: 0, TwoWay: 1, OneWay: 2 } as const;
export type ArmKind = (typeof ArmKind)[keyof typeof ArmKind];

export interface Arm {
  kind: ArmKind;
  /** One-way arms: the median (and its yellow line) is on the high-coordinate side. */
  medianHigh: boolean;
  /** Draw a stop line across the incoming lane(s). */
  stops: boolean;
}

const neighborSides: Side[] = [0, 0, 0, 0];

export function createArm(): Arm {
  return { kind: ArmKind.None, medianHigh: false, stops: false };
}

/**
 * Whether an avenue crosses at avenue tile i (so avenue traffic stops too): a junction
 * tile with two median bits, or a half whose outer side, or whose partner's outer side,
 * joins another avenue.
 */
function avenueCrossesAt(layers: RoadLayers, i: number): boolean {
  const bits = layers.roadMedian[i];
  if (bitCount(bits) !== 1) return true;
  const p = dirOfBit(bits);
  if (isAvenue(layers, neighborOf(layers, i, oppositeDir(p)))) return true;
  const partner = neighborOf(layers, i, p);
  return partner >= 0 && isAvenue(layers, neighborOf(layers, partner, p));
}

/**
 * The approach on side d of junction tile i. Streets approach two-way; an avenue half
 * approaches one-way (driving on the right, its median on the drivers' left). Streets
 * stop where they meet an avenue; avenues stop only where another avenue crosses; street
 * junctions keep their rule (T stem, or all four ways at a crossing).
 */
export function describeArm(layers: RoadLayers, i: number, d: number, out: Arm): Arm {
  out.kind = ArmKind.None;
  out.stops = false;
  out.medianHigh = false;
  const u = neighborOf(layers, i, d);
  if (u < 0 || layers.road[u] === 0) return out;
  const hereAvenue = isAvenue(layers, i);
  if (hereAvenue && layers.roadMedian[i] & DIR_BIT[d]) return out; // the median gap
  // Between two tiles of the same junction (or two junctions back to back) there's no
  // approach to mark.
  for (let k = 0; k < 4; k++) neighborSides[k] = sideKind(layers, u, k);
  if (isJunction(layers, u, neighborSides)) return out;

  if (!isAvenue(layers, u)) {
    out.kind = ArmKind.TwoWay;
    if (hereAvenue) out.stops = true;
    else {
      const m = geometryMask(layers.roadMask[i]);
      out.stops = m === 15 || (m & DIR_BIT[oppositeDir(d as Dir)]) === 0;
    }
    return out;
  }

  // An avenue half coming in: its median bit across the arm tells its lanes.
  const across =
    d === Dir.N || d === Dir.S ? DIR_BIT[Dir.E] | DIR_BIT[Dir.W] : DIR_BIT[Dir.N] | DIR_BIT[Dir.S];
  const bits = layers.roadMedian[u] & across;
  if (bitCount(bits) !== 1) return out;
  const p = dirOfBit(bits);
  out.kind = ArmKind.OneWay;
  out.medianHigh = p === Dir.E || p === Dir.S;
  // Heading with the median on the left: left of (hx, hz) is (hz, -hx).
  const hx = -DIR_DZ[p];
  const hz = DIR_DX[p];
  const incoming = hx === -DIR_DX[d] && hz === -DIR_DZ[d];
  out.stops = incoming && hereAvenue && avenueCrossesAt(layers, i);
  return out;
}
