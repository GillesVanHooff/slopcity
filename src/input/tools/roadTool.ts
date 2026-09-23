/**
 * Road tool, one instance per road type: press, drag, release to build. An axis-aligned
 * drag gives a straight road; anything else an L-shape whose first leg follows the way
 * the drag first left its start (drag east, then down: east, then south). The choice
 * holds until the cursor comes back to the start.
 *
 * Streets are dragged tile to tile. Avenues (2 tiles wide) snap to tile corners and are
 * dragged along the grid lines: the median follows the line under the cursor, with one
 * half on each side. While hovering, the avenue tool outlines the 2×2 tiles around the
 * corner under the cursor.
 *
 * While dragging, a ghost of the road (as it would be built, in red when it's not
 * allowed) follows the cursor and a hint shows the length and cost. The plan comes from
 * the same function the Simulation uses, so the preview always matches what gets built.
 */

import type { TilePick } from '../../render/picking';
import type { RoadGhost } from '../../render/preview/roadGhost';
import { createRoadBuildPlan, planRoadBuild, type RoadType } from '../../sim/roads/build';
import type { Simulation } from '../../sim/simulation';
import type { HintSink, HoverArea, Tool, ToolId } from './tool';

export class RoadTool implements Tool {
  readonly id: ToolId;
  readonly cursor = 'crosshair';

  private readonly type: RoadType;
  private readonly sim: Simulation;
  private readonly ghost: RoadGhost;
  private readonly hint: HintSink;
  private dragging = false;
  /** Start and end of the drag: tiles, or tile corners for 2-wide roads. */
  private startX = 0;
  private startZ = 0;
  private endX = 0;
  private endZ = 0;
  /** First leg of an L-shape; null until the drag has left its start. */
  private xFirst: boolean | null = null;
  private readonly plan = createRoadBuildPlan();
  private readonly request = {
    roadType: 0,
    from: { x: 0, z: 0 },
    to: { x: 0, z: 0 },
    xFirst: true,
  };

  constructor(id: ToolId, type: RoadType, sim: Simulation, ghost: RoadGhost, hint: HintSink) {
    this.id = id;
    this.type = type;
    this.sim = sim;
    this.ghost = ghost;
    this.hint = hint;
    this.request.roadType = type.id;
  }

  activate(): void {}

  deactivate(): void {
    this.cancel();
  }

  pointerDown(pick: TilePick): void {
    this.dragging = true;
    this.startX = this.endX = this.pointX(pick);
    this.startZ = this.endZ = this.pointZ(pick);
    this.xFirst = null;
    this.refresh();
  }

  hover(pick: TilePick): void {
    // Off-map: keep the last valid end so the drag doesn't jump.
    if (!this.dragging || pick.index < 0) return;
    const x = this.pointX(pick);
    const z = this.pointZ(pick);
    if (x === this.endX && z === this.endZ) return;
    this.endX = x;
    this.endZ = z;
    const dx = this.endX - this.startX;
    const dz = this.endZ - this.startZ;
    // The first leg is picked once, as the drag leaves its start, and kept while the
    // cursor sweeps the other leg. Re-picking whenever the drag lined up again would flip
    // the bend as the cursor crossed the start row or column. Back at the start, the
    // player can choose again. A fast drag that skips the straight phase starts along
    // its longer axis.
    if (dx === 0 && dz === 0) this.xFirst = null;
    else this.xFirst ??= dz === 0 || (dx !== 0 && Math.abs(dx) >= Math.abs(dz));
    this.refresh();
  }

  hoverArea(pick: TilePick, out: HoverArea): boolean {
    if (this.type.width !== 2 || pick.index < 0) return false;
    // The 2×2 tiles around the corner the avenue would start from.
    out.x = this.pointX(pick) - 1;
    out.z = this.pointZ(pick) - 1;
    out.w = 2;
    out.h = 2;
    return true;
  }

  pointerUp(): void {
    if (!this.dragging) return;
    this.sim.execute({
      type: 'buildRoad',
      roadType: this.type.id,
      from: { x: this.startX, z: this.startZ },
      to: { x: this.endX, z: this.endZ },
      xFirst: this.xFirst ?? true,
    });
    this.reset();
  }

  cancel(): boolean {
    if (!this.dragging) return false;
    this.reset();
    return true;
  }

  /** Drag coordinate under the cursor: the tile, or the nearest tile corner. */
  private pointX(pick: TilePick): number {
    if (this.type.width !== 2) return pick.x;
    return clampCorner(Math.round(pick.worldX), this.sim.world.grid.width);
  }

  private pointZ(pick: TilePick): number {
    if (this.type.width !== 2) return pick.z;
    return clampCorner(Math.round(pick.worldZ), this.sim.world.grid.height);
  }

  private refresh(): void {
    const { request } = this;
    request.from.x = this.startX;
    request.from.z = this.startZ;
    request.to.x = this.endX;
    request.to.z = this.endZ;
    request.xFirst = this.xFirst ?? true;
    const plan = planRoadBuild(this.sim.world, request, this.plan);
    this.ghost.show(plan);
    const { name } = this.type;
    if (plan.tiles.length === 0) this.hint(`${name} · drag along a grid line`);
    else if (!plan.valid) this.hint(`${name} · ${plan.reason}`);
    else this.hint(`${name} · ${plan.length} tiles · §${plan.cost.toLocaleString()}`);
  }

  private reset(): void {
    this.dragging = false;
    this.ghost.hide();
    this.hint(null);
  }
}

/** Keeps an avenue's corner one tile inside the map so both halves fit. */
function clampCorner(v: number, size: number): number {
  return v < 1 ? 1 : v > size - 1 ? size - 1 : v;
}
