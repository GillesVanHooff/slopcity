/**
 * Maps player input onto the CameraRig.
 *
 *   Pan     WASD / arrow keys (Shift = faster), right-mouse drag (grabs the ground)
 *   Zoom    mouse wheel (toward cursor), + / - keys (toward screen centre)
 *   Rotate  Q / E in 90° steps, middle-mouse drag for free yaw + pitch
 *   Reset   Home
 *
 * Left mouse is deliberately left free for tools.
 */

import { MathUtils } from 'three';
import { CAMERA } from '../config';
import type { CameraRig } from '../render/camera/cameraRig';
import { MouseButton, type InputManager } from './input';

const PAN_KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
} as const;

/** Wheel deltas in lines/pages are converted to approximate pixels. */
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 800;
/** Caps a single wheel event so a fast flick can't zoom across the whole range. */
const MAX_WHEEL_STEP_PX = 400;

type DragMode = 'none' | 'pan' | 'rotate';

export class CameraController {
  private readonly input: InputManager;
  private readonly rig: CameraRig;
  private readonly unsubscribe: Array<() => void> = [];

  private drag: DragMode = 'none';
  private lastX = 0;
  private lastY = 0;

  constructor(input: InputManager, rig: CameraRig) {
    this.input = input;
    this.rig = rig;
    const ev = input.events;
    this.unsubscribe.push(
      ev.on('pointerdown', (e) => this.onPointerDown(e)),
      ev.on('pointermove', (e) => this.onPointerMove(e)),
      ev.on('pointerup', (e) => this.onPointerUp(e)),
      ev.on('wheel', (e) => this.onWheel(e)),
      ev.on('keydown', (e) => this.onKeyDown(e)),
    );
  }

  /** True while the camera is being dragged (tools should ignore the pointer). */
  get isDragging(): boolean {
    return this.drag !== 'none';
  }

  /** Applies held-key panning and zooming. Call once per frame before rig.update(). */
  update(dt: number): void {
    if (dt <= 0) return;
    const fast =
      this.input.isKeyDown('ShiftLeft') || this.input.isKeyDown('ShiftRight')
        ? CAMERA.keyPanFastMultiplier
        : 1;
    const step = this.rig.distance * CAMERA.keyPanSpeed * fast * dt;
    let right = 0;
    let forward = 0;
    if (this.anyKeyDown(PAN_KEYS.forward)) forward += 1;
    if (this.anyKeyDown(PAN_KEYS.back)) forward -= 1;
    if (this.anyKeyDown(PAN_KEYS.right)) right += 1;
    if (this.anyKeyDown(PAN_KEYS.left)) right -= 1;
    if (right !== 0 || forward !== 0) {
      const len = Math.hypot(right, forward);
      this.rig.panLocal((right / len) * step, (forward / len) * step);
    }

    let zoom = 0;
    if (this.anyKeyDown(PAN_KEYS.zoomIn)) zoom -= 1;
    if (this.anyKeyDown(PAN_KEYS.zoomOut)) zoom += 1;
    if (zoom !== 0) this.rig.zoomAt(Math.pow(CAMERA.keyZoomSpeed, zoom * dt));
  }

  private anyKeyDown(codes: readonly string[]): boolean {
    for (let i = 0; i < codes.length; i++) if (this.input.isKeyDown(codes[i])) return true;
    return false;
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
  }

  // ------------------------------------------------------------------ handlers

  private onPointerDown(e: PointerEvent): void {
    if (this.drag !== 'none') return;
    if (e.button === MouseButton.Right) {
      if (this.rig.beginGrab(this.input.ndcX, this.input.ndcY)) this.drag = 'pan';
    } else if (e.button === MouseButton.Middle) {
      this.drag = 'rotate';
    }
    this.lastX = this.input.pointerX;
    this.lastY = this.input.pointerY;
  }

  private onPointerMove(_e: PointerEvent): void {
    const x = this.input.pointerX;
    const y = this.input.pointerY;
    if (this.drag === 'pan') {
      this.rig.dragGrab(this.input.ndcX, this.input.ndcY);
    } else if (this.drag === 'rotate') {
      const k = MathUtils.degToRad(CAMERA.dragRotateSpeed);
      this.rig.rotateBy(-(x - this.lastX) * k, (y - this.lastY) * k);
    }
    this.lastX = x;
    this.lastY = y;
  }

  private onPointerUp(e: PointerEvent): void {
    const ends =
      (this.drag === 'pan' && e.button === MouseButton.Right) ||
      (this.drag === 'rotate' && e.button === MouseButton.Middle) ||
      e.type === 'pointercancel';
    if (!ends) return;
    if (this.drag === 'pan') this.rig.endGrab();
    this.drag = 'none';
  }

  private onWheel(e: WheelEvent): void {
    let delta = e.deltaY;
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= LINE_HEIGHT_PX;
    else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= PAGE_HEIGHT_PX;
    delta = MathUtils.clamp(delta, -MAX_WHEEL_STEP_PX, MAX_WHEEL_STEP_PX);
    this.rig.zoomAt(Math.exp(delta * CAMERA.wheelZoomSpeed), this.input.ndcX, this.input.ndcY);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.code) {
      case 'KeyQ':
        this.rig.rotateStep(1);
        break;
      case 'KeyE':
        this.rig.rotateStep(-1);
        break;
      case 'Home':
        this.rig.reset();
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
