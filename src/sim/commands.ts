/**
 * Player commands. Tools and UI never change world state directly: they submit a Command
 * to the Simulation, which validates it, applies it and reports a CommandResult with the
 * resulting ChangeSet (plan.md §3, rule 2). Commands are plain data so they can later be
 * posted to the sim Web Worker and logged for deterministic replays.
 */

import type { ChangeSet } from './changes';

export interface TileCoord {
  x: number;
  z: number;
}

export type Command =
  | {
      type: 'buildRoad';
      /** Road type id (see ROADS in config.ts). */
      roadType: number;
      from: TileCoord;
      to: TileCoord;
    }
  | {
      /** Clears everything bulldozable in the rectangle spanned by `from` and `to`. */
      type: 'bulldoze';
      from: TileCoord;
      to: TileCoord;
    };

export interface CommandResult {
  ok: boolean;
  /** Human-readable reason when `ok` is false. */
  reason?: string;
  /** Number of tiles actually changed. */
  tilesChanged: number;
  /** Construction cost of the change (display only until the budget exists). */
  cost: number;
  changes: ChangeSet;
}
