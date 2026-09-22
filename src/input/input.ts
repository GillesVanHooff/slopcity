/**
 * Raw input collection for the game canvas. Tracks pointer position (CSS px and NDC),
 * held keys and mouse buttons, and re-emits DOM events through a typed emitter so tools
 * and the camera controller can subscribe without touching the DOM themselves.
 *
 * Keys are tracked by `KeyboardEvent.code` (physical position), so WASD / Q / E stay in
 * the same place on AZERTY and other layouts.
 */

import { Emitter } from '../core/events';

export interface InputEvents {
  pointerdown: PointerEvent;
  pointermove: PointerEvent;
  pointerup: PointerEvent;
  wheel: WheelEvent;
  keydown: KeyboardEvent;
  keyup: KeyboardEvent;
}

export const MouseButton = { Left: 0, Middle: 1, Right: 2 } as const;

export class InputManager {
  readonly events = new Emitter<InputEvents>();

  /** Pointer position relative to the element, in CSS pixels. */
  pointerX = 0;
  pointerY = 0;
  /** True while the pointer is over the element (or captured by a drag). */
  pointerInside = false;

  private readonly element: HTMLElement;
  private readonly keys = new Set<string>();
  private buttons = 0;
  private readonly abort = new AbortController();

  constructor(element: HTMLElement) {
    this.element = element;
    const signal = this.abort.signal;
    const el = element;

    el.addEventListener('pointerdown', (e) => this.onPointerDown(e), { signal });
    el.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal });
    el.addEventListener('pointerup', (e) => this.onPointerUp(e), { signal });
    el.addEventListener('pointercancel', (e) => this.onPointerUp(e), { signal });
    el.addEventListener('pointerenter', () => (this.pointerInside = true), { signal });
    el.addEventListener(
      'pointerleave',
      () => {
        if (this.buttons === 0) this.pointerInside = false;
      },
      { signal },
    );
    el.addEventListener('wheel', (e) => this.onWheel(e), { signal, passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    // Middle-click autoscroll would fight the rotate drag.
    el.addEventListener('auxclick', (e) => e.preventDefault(), { signal });

    window.addEventListener('keydown', (e) => this.onKeyDown(e), { signal });
    window.addEventListener('keyup', (e) => this.onKeyUp(e), { signal });
    // Releasing keys while the window is unfocused would leave them "stuck".
    window.addEventListener('blur', () => this.releaseAll(), { signal });
    document.addEventListener('visibilitychange', () => document.hidden && this.releaseAll(), {
      signal,
    });
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  isButtonDown(button: number): boolean {
    return (this.buttons & (1 << button)) !== 0;
  }

  /** Pointer in normalised device coordinates (-1..1, y up). */
  get ndcX(): number {
    return (this.pointerX / Math.max(1, this.element.clientWidth)) * 2 - 1;
  }

  get ndcY(): number {
    return -(this.pointerY / Math.max(1, this.element.clientHeight)) * 2 + 1;
  }

  dispose(): void {
    this.abort.abort();
    this.events.clear();
    this.keys.clear();
  }

  // ------------------------------------------------------------------ handlers

  private updatePointer(e: PointerEvent | WheelEvent): void {
    const rect = this.element.getBoundingClientRect();
    this.pointerX = e.clientX - rect.left;
    this.pointerY = e.clientY - rect.top;
  }

  private onPointerDown(e: PointerEvent): void {
    this.updatePointer(e);
    this.pointerInside = true;
    this.buttons |= 1 << e.button;
    this.element.setPointerCapture(e.pointerId);
    this.element.focus({ preventScroll: true });
    if (e.button === MouseButton.Middle) e.preventDefault();
    this.events.emit('pointerdown', e);
  }

  private onPointerMove(e: PointerEvent): void {
    this.updatePointer(e);
    this.events.emit('pointermove', e);
  }

  private onPointerUp(e: PointerEvent): void {
    this.updatePointer(e);
    this.buttons &= ~(1 << e.button);
    if (e.type === 'pointercancel') this.buttons = 0;
    if (this.element.hasPointerCapture(e.pointerId)) {
      this.element.releasePointerCapture(e.pointerId);
    }
    this.events.emit('pointerup', e);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.updatePointer(e);
    this.events.emit('wheel', e);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (isTypingTarget(e.target)) return;
    this.keys.add(e.code);
    this.events.emit('keydown', e);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    this.events.emit('keyup', e);
  }

  private releaseAll(): void {
    this.keys.clear();
    this.buttons = 0;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
