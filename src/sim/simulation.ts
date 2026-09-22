/**
 * The simulation facade (SimAPI, plan.md §3). Owns the World, validates and applies
 * Commands, and announces what changed. Runs on the main thread for now; phase 5 moves it
 * into a Web Worker behind the same interface.
 */

import { ROADS } from '../config';
import { Emitter } from '../core/events';
import { ChangeSetBuilder, type ChangeSet } from './changes';
import type { Command, CommandResult } from './commands';
import { updateRoadMasks } from './roads/autotile';
import { planStraightRoad } from './roads/roadPath';
import type { World } from './world';

export interface SimEvents {
  /** Fired after every command that changed the world. */
  changes: ChangeSet;
}

const ROAD_COST_BY_ID = new Map<number, number>(
  Object.values(ROADS).map((r) => [r.id, r.costPerTile]),
);

export class Simulation {
  readonly world: World;
  readonly events = new Emitter<SimEvents>();

  private readonly scratchPath: number[] = [];

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
    const costPerTile = ROAD_COST_BY_ID.get(cmd.roadType);
    if (costPerTile === undefined) {
      return { ok: false, reason: `Unknown road type ${cmd.roadType}`, tilesChanged: 0, cost: 0 };
    }
    const { world } = this;
    const path = planStraightRoad(
      world.grid,
      cmd.from.x,
      cmd.from.z,
      cmd.to.x,
      cmd.to.z,
      this.scratchPath,
    );
    const placed: number[] = [];
    for (const i of path) {
      if (world.road[i] === cmd.roadType) continue;
      world.road[i] = cmd.roadType;
      placed.push(i);
    }
    if (placed.length === 0) {
      return { ok: true, tilesChanged: 0, cost: 0 };
    }
    updateRoadMasks(world, placed, (i) => changes.road(i));
    return { ok: true, tilesChanged: placed.length, cost: placed.length * costPerTile };
  }

  private bulldoze(
    cmd: Extract<Command, { type: 'bulldoze' }>,
    changes: ChangeSetBuilder,
  ): Omit<CommandResult, 'changes'> {
    const { world } = this;
    const cleared: number[] = [];
    world.grid.forEachInRect(cmd.from.x, cmd.from.z, cmd.to.x, cmd.to.z, (i) => {
      if (world.road[i] === 0) return;
      world.road[i] = 0;
      cleared.push(i);
    });
    updateRoadMasks(world, cleared, (i) => changes.road(i));
    return { ok: true, tilesChanged: cleared.length, cost: 0 };
  }
}
