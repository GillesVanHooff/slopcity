/**
 * Shared dimensions, colours and surface ids of the procedural roads (streets and
 * avenues), used by the geometry modules and the road material.
 */

import { Color } from 'three';

/** Distances from the tile edge (tile units) and heights above the ground. */
export const ROAD_STYLE = {
  sidewalkWidth: 0.085,
  vergeWidth: 0.06,
  curbWidth: 0.015,
  /** Sidewalk + verge + curb; the asphalt starts here. */
  edgeWidth: 0.16,
  /** Double yellow centre line: width of each line and the gap between them. */
  centerLineWidth: 0.014,
  centerLineGap: 0.014,
  /** White stop line across the incoming lane, set back from the junction box. */
  stopLineWidth: 0.02,
  stopLineInset: 0.01,
  /** Avenue: dashed white line between the two lanes of a half (dash + gap = 0.5). */
  laneLineWidth: 0.012,
  laneDashLength: 0.25,
  /** Avenue: gap between the median curb and its solid yellow edge line. */
  medianLineOffset: 0.03,
  /** Segments per quarter circle for curves and rounded corners (low-poly look). */
  arcSegments: 10,
  /** Segments per quarter circle for avenue curves (radius 2, so twice as many). */
  avenueArcSegments: 20,
  asphaltY: 0.02,
  markingY: 0.028,
  /** Top of the sidewalk platform (curb, verge, sidewalk). */
  platformY: 0.034,
} as const;

export const ROAD_COLORS = {
  asphalt: new Color(0x2a2c2f),
  curb: new Color(0xc9c5bb),
  verge: new Color(0x4f7f2e),
  sidewalk: new Color(0xc2bcb0),
  centerLine: new Color(0xe2b53a),
  stopLine: new Color(0xe6e4dc),
  laneLine: new Color(0xdad8d0),
} as const;

/** Tile corners, in the order used by corner-relative surface ids. */
export const Corner = { NW: 0, NE: 1, SE: 2, SW: 3 } as const;
export type Corner = (typeof Corner)[keyof typeof Corner];

/** Offset of each corner from the tile origin (x, z). */
export const CORNER_DX: readonly number[] = [0, 1, 1, 0];
export const CORNER_DZ: readonly number[] = [0, 0, 1, 1];

/**
 * Surface ids written to the `aSurface` vertex attribute, read by the road material.
 * Sidewalk slabs need to know which way the sidewalk runs; curved sidewalks add the
 * point they curve around so the slab joints can point at it.
 */
export const ROAD_SURFACE = {
  Plain: 0,
  SidewalkAlongX: 1,
  SidewalkAlongZ: 2,
  Verge: 3,
  /** Outer sidewalk of a street curve: SidewalkArc + corner of the tile (0..3). */
  SidewalkArc: 4,
  /** Quarter-disc sidewalk of a rounded corner pad: SidewalkPad + corner (0..3). */
  SidewalkPad: 8,
  /**
   * Outer sidewalk of an avenue curve, whose centre can be up to two tiles away:
   * SidewalkAvenueArc + (ox + 1) + 4 · (oz + 1), where (ox, oz) ∈ −1..2 is the centre's
   * offset from the tile origin.
   */
  SidewalkAvenueArc: 16,
} as const;

/** Slabs per quarter circle on curved sidewalks. */
export const ROAD_ARC_SLABS = {
  /** Outer sidewalk of a street curve, ≈1.5 tiles long. */
  arc: 12,
  pad: 1,
  /** Outer sidewalk of an avenue curve, ≈3 tiles long. */
  avenue: 24,
} as const;
