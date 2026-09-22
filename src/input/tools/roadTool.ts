/**
 * Road tool: press on a tile, drag, release to build a street. An axis-aligned drag gives
 * a straight street; anything else an L-shape whose first leg follows the way the drag
 * first left the start tile (drag east, then down: east, then south). The choice holds
 * until the cursor comes back to the start tile.
 * While dragging, a ghost of the road (with its future connections) follows the cursor
 * and a hint shows the length and cost. The path is planned with the same function the
 * Simulation uses, so the preview always matches what gets built.
 */

import { ROADS } from '../../config';
import type { TilePick } from '../../render/picking';
import type { RoadGhost } from '../../render/preview/roadGhost';
import { planRoad } from '../../sim/roads/roadPath';
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
  /** First leg of an L-shape; null until the drag has left the start tile. */
  private xFirst: boolean | null = null;
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
    this.xFirst = null;
    this.refresh();
  }

  hover(pick: TilePick): void {
    // Off-map: keep the last valid end tile so the drag doesn't jump.
    if (!this.dragging || pick.index < 0) return;
    if (pick.x === this.endX && pick.z === this.endZ) return;
    this.endX = pick.x;
    this.endZ = pick.z;
    const dx = this.endX - this.startX;
    const dz = this.endZ - this.startZ;
    // The first leg is picked once, as the drag leaves the start tile, and kept while the
    // cursor sweeps the other leg. Re-picking whenever the drag lined up again would flip
    // the bend as the cursor crossed the start row or column. Back on the start tile, the
    // player can choose again. A fast drag that skips the straight phase starts along
    // its longer axis.
    if (dx === 0 && dz === 0) this.xFirst = null;
    else this.xFirst ??= dz === 0 || (dx !== 0 && Math.abs(dx) >= Math.abs(dz));
    this.refresh();
  }

  pointerUp(): void {
    if (!this.dragging) return;
    this.sim.execute({
      type: 'buildRoad',
      roadType: ROAD.id,
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

  private refresh(): void {
    const { world } = this.sim;
    const { startX, startZ, endX, endZ } = this;
    planRoad(world.grid, startX, startZ, endX, endZ, this.xFirst ?? true, this.path);
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
