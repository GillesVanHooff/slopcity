/**
 * Road tool: press on a tile, drag, release to build a straight street. While dragging, a
 * ghost of the road (with its future connections) follows the cursor and a hint shows
 * the length and cost. The path is planned with the same function the Simulation uses,
 * so the preview always matches what gets built.
 */

import { ROADS } from '../../config';
import type { TilePick } from '../../render/picking';
import type { RoadGhost } from '../../render/preview/roadGhost';
import { planStraightRoad } from '../../sim/roads/roadPath';
import type { Simulation } from '../../sim/simulation';
import type { HintSink, Tool } from './tool';

const ROAD = ROADS.street;

export class RoadTool implements Tool {
  readonly id = 'road' as const;
  readonly cursor = 'crosshair';

  private readonly sim: Simulation;
  private readonly ghost: RoadGhost;
  private readonly hint: HintSink;
  private dragging = false;
  private startX = 0;
  private startZ = 0;
  private endX = 0;
  private endZ = 0;
  private readonly path: number[] = [];

  constructor(sim: Simulation, ghost: RoadGhost, hint: HintSink) {
    this.sim = sim;
    this.ghost = ghost;
    this.hint = hint;
  }

  activate(): void {}

  deactivate(): void {
    this.cancel();
  }

  pointerDown(pick: TilePick): void {
    this.dragging = true;
    this.startX = this.endX = pick.x;
    this.startZ = this.endZ = pick.z;
    this.refresh();
  }

  hover(pick: TilePick): void {
    // Off-map: keep the last valid end tile so the drag doesn't jump.
    if (!this.dragging || pick.index < 0) return;
    if (pick.x === this.endX && pick.z === this.endZ) return;
    this.endX = pick.x;
    this.endZ = pick.z;
    this.refresh();
  }

  pointerUp(): void {
    if (!this.dragging) return;
    this.sim.execute({
      type: 'buildRoad',
      roadType: ROAD.id,
      from: { x: this.startX, z: this.startZ },
      to: { x: this.endX, z: this.endZ },
    });
    this.reset();
  }

  cancel(): boolean {
    if (!this.dragging) return false;
    this.reset();
    return true;
  }

  private refresh(): void {
    const { world } = this.sim;
    planStraightRoad(world.grid, this.startX, this.startZ, this.endX, this.endZ, this.path);
    this.ghost.show(this.path);
    let newTiles = 0;
    for (const i of this.path) if (world.road[i] !== ROAD.id) newTiles++;
    const cost = newTiles * ROAD.costPerTile;
    this.hint(`${ROAD.name} · ${this.path.length} tiles · §${cost.toLocaleString()}`);
  }

  private reset(): void {
    this.dragging = false;
    this.ghost.hide();
    this.hint(null);
  }
}
