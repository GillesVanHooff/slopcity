/**
 * Road construction and demolition, shared by the Simulation (which applies it to the World) and the
 * road tool's preview (which applies it to a scratch copy of the road layers). Planning
 * works out the tiles, what each would become, what it costs and whether it's allowed;
 * applying writes the layers and refreshes the connection masks.
 *
 * Rules: a road never downgrades a wider one (a street drawn across an avenue leaves
 * the avenue tiles alone and just connects to them), while an avenue drawn over a street
 * upgrades those tiles. Avenue median bits add up where avenues cross; a build that would
 * leave a tile with invalid median bits (avenues overlapping side by side) is rejected.
 */

import { ROADS } from '../../config';
import type { RoadLayers } from '../world';
import { DIR_BIT } from '../../core/grid';
import { expandAvenueRemoval, isAvenue, isValidMedian, neighborOf } from './avenue';
import { updateRoadMasks } from './autotile';
import { planAvenue, planRoad } from './roadPath';

export type RoadType = (typeof ROADS)[keyof typeof ROADS];

const ROAD_BY_ID = new Map<number, RoadType>(Object.values(ROADS).map((r) => [r.id, r]));

export function roadTypeById(id: number): RoadType | undefined {
  return ROAD_BY_ID.get(id);
}

/** A drag to build: tiles for 1-wide roads, tile corners for 2-wide ones. */
export interface RoadBuildRequest {
  roadType: number;
  from: { x: number; z: number };
  to: { x: number; z: number };
  xFirst?: boolean;
}

export interface RoadBuildPlan {
  roadType: number;
  /** Planned tiles in path order. */
  tiles: number[];
  /** Median bits each planned tile gains (avenues), parallel to `tiles`. */
  medians: number[];
  /** Length of the drag in tiles, for the tool's hint. */
  length: number;
  /** Number of tiles that would actually change. */
  changed: number;
  cost: number;
  valid: boolean;
  /** Why the build isn't allowed, when `valid` is false. */
  reason: string | null;
}

export function createRoadBuildPlan(): RoadBuildPlan {
  return {
    roadType: 0,
    tiles: [],
    medians: [],
    length: 0,
    changed: 0,
    cost: 0,
    valid: true,
    reason: null,
  };
}

/** Plans the build described by `req` on `layers` into `plan` (reused). Returns `plan`. */
export function planRoadBuild(
  layers: RoadLayers,
  req: RoadBuildRequest,
  plan: RoadBuildPlan,
): RoadBuildPlan {
  const type = ROAD_BY_ID.get(req.roadType);
  plan.roadType = req.roadType;
  plan.changed = 0;
  plan.cost = 0;
  plan.valid = true;
  plan.reason = null;
  if (!type) {
    plan.tiles.length = 0;
    plan.medians.length = 0;
    plan.length = 0;
    plan.valid = false;
    plan.reason = `Unknown road type ${req.roadType}`;
    return plan;
  }

  const { grid } = layers;
  const xFirst = req.xFirst ?? true;
  if (type.width === 2) {
    planAvenue(grid, req.from.x, req.from.z, req.to.x, req.to.z, xFirst, plan.tiles, plan.medians);
    plan.length =
      Math.abs(clampTo(req.to.x, grid.width) - clampTo(req.from.x, grid.width)) +
      Math.abs(clampTo(req.to.z, grid.height) - clampTo(req.from.z, grid.height));
  } else {
    planRoad(grid, req.from.x, req.from.z, req.to.x, req.to.z, xFirst, plan.tiles);
    plan.medians.length = plan.tiles.length;
    plan.medians.fill(0);
    plan.length = plan.tiles.length;
  }

  for (let k = 0; k < plan.tiles.length; k++) {
    const i = plan.tiles[k];
    const result = resultOf(layers, i, type, plan.medians[k]);
    if (result < 0) {
      plan.valid = false;
      plan.reason = 'Avenues can only cross each other, not overlap';
      continue;
    }
    if (result > 0) plan.changed++;
  }
  plan.cost = plan.changed * type.costPerTile;
  return plan;
}

/**
 * Applies a valid plan to `layers`: sets road types and median bits, then recomputes the
 * masks of changed tiles and their neighbours, calling `touched` for each of those.
 * Returns the changed tiles (a reused array). With `partial`, an invalid plan is applied
 * too, skipping the tiles that make it invalid (for previews).
 */
export function applyRoadBuild(
  layers: RoadLayers,
  plan: RoadBuildPlan,
  touched: (i: number) => void,
  partial = false,
): number[] {
  changedScratch.length = 0;
  const type = ROAD_BY_ID.get(plan.roadType);
  if ((!plan.valid && !partial) || !type) return changedScratch;
  const { road, roadMedian } = layers;
  for (let k = 0; k < plan.tiles.length; k++) {
    const i = plan.tiles[k];
    if (resultOf(layers, i, type, plan.medians[k]) <= 0) continue;
    if (type.width === 2) {
      roadMedian[i] = (road[i] === type.id ? roadMedian[i] : 0) | plan.medians[k];
    }
    road[i] = type.id;
    changedScratch.push(i);
  }
  updateRoadMasks(layers, changedScratch, touched);
  return changedScratch;
}

const changedScratch: number[] = [];

/**
 * What building `type` on tile i (gaining median bits `bits`) would do: 1 if the tile
 * changes, 0 if it stays as it is, -1 if the result would be invalid.
 */
function resultOf(layers: RoadLayers, i: number, type: RoadType, bits: number): number {
  const current = layers.road[i];
  if (current === 0) return 1;
  const existing = ROAD_BY_ID.get(current);
  if (existing && existing.width > type.width) return 0; // never downgrade
  if (type.width !== 2) return current === type.id ? 0 : 1;
  if (current !== type.id) return 1; // upgrade a street
  const merged = layers.roadMedian[i] | bits;
  if (!isValidMedian(merged)) return -1;
  return merged === layers.roadMedian[i] ? 0 : 1;
}

function clampTo(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

/**
 * Collects the road tiles to clear for a bulldoze of the tile rectangle (ax, az)–(bx, bz)
 * into `out` (cleared first): every road tile in it, plus whatever avenue tiles must go
 * with them (see expandAvenueRemoval).
 */
export function collectBulldoze(
  layers: RoadLayers,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  out: Set<number>,
): Set<number> {
  out.clear();
  layers.grid.forEachInRect(ax, az, bx, bz, (i) => {
    if (layers.road[i] !== 0) out.add(i);
  });
  expandAvenueRemoval(layers, out);
  return out;
}

/**
 * Clears the given road tiles, drops median bits that pointed at them from what
 * remains, and recomputes masks, calling `touched` for every tile whose mask was
 * recomputed.
 */
export function clearRoads(
  layers: RoadLayers,
  tiles: Iterable<number>,
  touched: (i: number) => void,
): number[] {
  const { road, roadMedian } = layers;
  changedScratch.length = 0;
  for (const i of tiles) {
    if (road[i] === 0) continue;
    road[i] = 0;
    roadMedian[i] = 0;
    changedScratch.push(i);
  }
  for (const i of changedScratch) {
    for (let d = 0; d < 4; d++) {
      const n = neighborOf(layers, i, d);
      if (isAvenue(layers, n)) roadMedian[n] &= ~DIR_BIT[(d + 2) & 3];
    }
  }
  updateRoadMasks(layers, changedScratch, touched);
  return changedScratch;
}
