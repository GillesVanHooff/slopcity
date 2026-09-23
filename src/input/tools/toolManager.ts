/**
 * Owns the tools, tracks which one is active and routes input to it: left button presses
 * and releases, Esc (cancel a drag, or return to the select tool), right click during a
 * drag (cancel, like SimCity 4) and the per-frame hovered tile.
 */

import type { TilePick } from '../../render/picking';
import { MouseButton, type InputManager } from '../input';
import type { HoverArea, Tool, ToolId } from './tool';

export class ToolManager {
  private readonly tools = new Map<ToolId, Tool>();
  private readonly element: HTMLElement;
  private readonly unsubscribe: Array<() => void> = [];
  private active: Tool;
  private leftDown = false;
  private lastPick: TilePick | null = null;
  /** Called when the tool changes from inside (e.g. Esc); lets the HUD stay in sync. */
  onToolChange: ((id: ToolId) => void) | null = null;

  constructor(input: InputManager, element: HTMLElement, tools: Tool[]) {
    this.element = element;
    for (const t of tools) this.tools.set(t.id, t);
    const select = this.tools.get('select');
    if (!select) throw new Error('ToolManager needs a select tool');
    this.active = select;
    this.active.activate();

    const ev = input.events;
    this.unsubscribe.push(
      ev.on('pointerdown', (e) => this.onPointerDown(e)),
      ev.on('pointerup', (e) => this.onPointerUp(e)),
      ev.on('keydown', (e) => this.onKeyDown(e)),
    );
  }

  get activeId(): ToolId {
    return this.active.id;
  }

  setActive(id: ToolId): void {
    if (id === this.active.id) return;
    const next = this.tools.get(id);
    if (!next) throw new Error(`Unknown tool ${id}`);
    this.active.deactivate();
    this.leftDown = false;
    this.active = next;
    this.active.activate();
    this.element.style.cursor = next.cursor;
    this.onToolChange?.(id);
  }

  /** The active tool's highlight area for this pick (see Tool.hoverArea). */
  hoverArea(pick: TilePick, out: HoverArea): boolean {
    return this.active.hoverArea?.(pick, out) ?? false;
  }

  /** Per-frame update with the tile under the cursor. */
  update(pick: TilePick): void {
    this.lastPick = pick;
    this.active.hover(pick);
  }

  dispose(): void {
    this.active.deactivate();
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button === MouseButton.Right && this.leftDown) {
      this.active.cancel();
      this.leftDown = false;
      return;
    }
    if (e.button !== MouseButton.Left) return;
    const pick = this.lastPick;
    if (!pick || pick.index < 0) return;
    this.leftDown = true;
    this.active.pointerDown(pick);
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button !== MouseButton.Left || !this.leftDown) return;
    this.leftDown = false;
    if (this.lastPick) this.active.pointerUp(this.lastPick);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.code !== 'Escape') return;
    if (this.active.cancel()) {
      this.leftDown = false;
    } else if (this.active.id !== 'select') {
      this.setActive('select');
    }
    e.preventDefault();
  }
}
