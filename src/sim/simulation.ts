/**
 * The simulation facade (SimAPI, plan.md §3). Owns the World, validates and applies
 * Commands, and announces what changed. Runs on the main thread for now; phase 5 moves it
 * into a Web Worker behind the same interface.
 */

import { Emitter } from '../core/events';
import { ChangeSetBuilder, type ChangeSet } from './changes';
import type { Command, CommandResult } from './commands';
import {
  applyRoadBuild,
  clearRoads,
  collectBulldoze,
  createRoadBuildPlan,
  planRoadBuild,
} from './roads/build';
import type { World } from './world';

export interface SimEvents {
  /** Fired after every command that changed the world. */
  changes: ChangeSet;
}

/**
 * How far (in tiles) a road change can affect how other road tiles look: an avenue
 * tile's piece depends on its neighbours' median partners and connections, so a change
 * reaches up to three tiles away. Chunks within this radius are marked dirty.
 */
const ROAD_INFLUENCE_RADIUS = 3;

export class Simulation {
  readonly world: World;
  readonly events = new Emitter<SimEvents>();

  private readonly plan = createRoadBuildPlan();
  private readonly bulldozeSet = new Set<number>();

  constructor(world: World) {
    this.world = world;
  }

  execute(cmd: Command): CommandResult {
    const changes = new ChangeSetBuilder((i) => this.world.grid.chunkOfIndex(i));
    let result: Omit<CommandResult, 'changes'>;
    switch (cmd.type) {
      case 'buildRoad':
        result = this.buildRoad(cmd, changes);
        break;
      case 'bulldoze':
        result = this.bulldoze(cmd, changes);
        break;
    }
    const changeSet = changes.build();
    if (!changes.isEmpty) this.events.emit('changes', changeSet);
    return { ...result, changes: changeSet };
  }

  // ------------------------------------------------------------------ commands

  private buildRoad(
    cmd: Extract<Command, { type: 'buildRoad' }>,
    changes: ChangeSetBuilder,
  ): Omit<CommandResult, 'changes'> {
    const { world } = this;
    const plan = planRoadBuild(world, cmd, this.plan);
    if (!plan.valid) {
      return { ok: false, reason: plan.reason ?? 'Invalid road', tilesChanged: 0, cost: 0 };
    }
    if (plan.changed === 0) return { ok: true, tilesChanged: 0, cost: 0 };
    const changed = applyRoadBuild(world, plan, (i) => changes.road(i));
    this.markInfluence(changed, changes);
    return { ok: true, tilesChanged: changed.length, cost: plan.cost };
  }

  private bulldoze(
    cmd: Extract<Command, { type: 'bulldoze' }>,
    changes: ChangeSetBuilder,
  ): Omit<CommandResult, 'changes'> {
    const { world } = this;
    const tiles = collectBulldoze(
      world,
      cmd.from.x,
      cmd.from.z,
      cmd.to.x,
      cmd.to.z,
      this.bulldozeSet,
    );
    const cleared = clearRoads(world, tiles, (i) => changes.road(i));
    this.markInfluence(cleared, changes);
    return { ok: true, tilesChanged: cleared.length, cost: 0 };
  }

  /** Marks the chunks around changed road tiles whose pieces may look different now. */
  private markInfluence(tiles: readonly number[], changes: ChangeSetBuilder): void {
    const { grid } = this.world;
    const r = ROAD_INFLUENCE_RADIUS;
    for (const i of tiles) {
      const x = grid.x(i);
      const z = grid.z(i);
      // Chunks are much larger than the radius: the four corners of the square cover it.
      for (const dz of [-r, r]) {
        for (const dx of [-r, r]) {
          const cx = Math.min(grid.width - 1, Math.max(0, x + dx));
          const cz = Math.min(grid.height - 1, Math.max(0, z + dz));
          changes.dirty(grid.index(cx, cz));
        }
      }
    }
  }
}
