/**
 * Tool contract. The ToolManager forwards left-mouse input and the per-frame hovered tile
 * to the active tool. Tools build previews locally and change the world only by
 * submitting Commands to the Simulation.
 */

import type { TilePick } from '../../render/picking';

export type ToolId = 'select' | 'road' | 'avenue' | 'bulldoze';

/** A rectangle of tiles to highlight under the cursor instead of the single hovered tile. */
export interface HoverArea {
  x: number;
  z: number;
  w: number;
  h: number;
}

export interface Tool {
  readonly id: ToolId;
  /** CSS cursor while the tool is active. */
  readonly cursor: string;
  activate(): void;
  /** Must cancel any drag in progress and hide previews. */
  deactivate(): void;
  /** Left button pressed over the map (`pick.index` >= 0). */
  pointerDown(pick: TilePick): void;
  /** Left button released (anywhere). `pick.index` may be -1 when off the map. */
  pointerUp(pick: TilePick): void;
  /** Called every frame with the tile under the cursor (index -1 when none). */
  hover(pick: TilePick): void;
  /** Cancels a drag in progress. Returns true if there was one. */
  cancel(): boolean;
  /**
   * Optional: the tiles to highlight for this pick (written into `out`), when the tool
   * works on more than the hovered tile. Returns false to highlight just that tile.
   */
  hoverArea?(pick: TilePick, out: HoverArea): boolean;
}

/** Text shown next to the cursor (cost, size) while a tool is dragging. */
export type HintSink = (text: string | null) => void;
