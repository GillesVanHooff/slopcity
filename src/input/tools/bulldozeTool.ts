/**
 * Bulldozer: press, drag a rectangle, release to clear it. The selection is shown as a
 * faint red area with strong red markers on tiles that will actually be cleared,
 * including the rest of any avenue slice it cuts (avenues go in whole slices).
 */

import type { TilePick } from '../../render/picking';
import type { TileOverlay } from '../../render/preview/tileOverlay';
import { collectBulldoze } from '../../sim/roads/build';
import type { Simulation } from '../../sim/simulation';
import type { HintSink, Tool } from './tool';

export class BulldozeTool implements Tool {
  readonly id = 'bulldoze' as const;
  readonly cursor = 'crosshair';

  private readonly sim: Simulation;
  private readonly overlay: TileOverlay;
  private readonly hint: HintSink;
  private dragging = false;
  private startX = 0;
  private startZ = 0;
  private endX = 0;
  private endZ = 0;
  private readonly marked: number[] = [];
  private readonly markedSet = new Set<number>();

  constructor(sim: Simulation, overlay: TileOverlay, hint: HintSink) {
    this.sim = sim;
    this.overlay = overlay;
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
    if (!this.dragging || pick.index < 0) return;
    if (pick.x === this.endX && pick.z === this.endZ) return;
    this.endX = pick.x;
    this.endZ = pick.z;
    this.refresh();
  }

  pointerUp(): void {
    if (!this.dragging) return;
    this.sim.execute({
      type: 'bulldoze',
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
    // Includes the avenue tiles that go together with the selected ones.
    collectBulldoze(world, this.startX, this.startZ, this.endX, this.endZ, this.markedSet);
    this.marked.length = 0;
    for (const i of this.markedSet) this.marked.push(i);
    this.overlay.show(this.startX, this.startZ, this.endX, this.endZ, this.marked);
    const w = Math.abs(this.endX - this.startX) + 1;
    const h = Math.abs(this.endZ - this.startZ) + 1;
    this.hint(`Bulldoze ${w}×${h} · ${this.marked.length} road tiles`);
  }

  private reset(): void {
    this.dragging = false;
    this.overlay.hide();
    this.hint(null);
  }
}
