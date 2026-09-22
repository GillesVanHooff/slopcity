/**
 * Orbiting city-builder camera: a target point on the ground plus yaw / pitch / distance.
 *
 * The rig keeps two states: `goal` (where input wants the camera) and `view` (what is
 * rendered). `update(dt)` eases view toward goal with the same exponential rate for every
 * component, so a zoom toward the cursor stays anchored under the cursor even while
 * animating (target and distance move along the same homothety). The rig has no DOM
 * dependencies, which keeps it unit-testable; input is mapped onto it by
 * input/cameraController.ts.
 */

import { MathUtils, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { CAMERA } from '../../config';

export interface CameraBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

interface ViewState {
  tx: number;
  tz: number;
  /** Radians. Unwrapped (may exceed 2π) so easing never takes the long way round. */
  yaw: number;
  /** Radians above the horizon. */
  pitch: number;
  distance: number;
}

const QUARTER_TURN = Math.PI / 2;
const EPSILON = 1e-4;

export class CameraRig {
  readonly camera: PerspectiveCamera;

  private readonly goal: ViewState;
  private readonly view: ViewState;
  private readonly bounds: CameraBounds;

  /** Scratch camera positioned at the goal state, used to anchor zoom consistently. */
  private readonly goalCamera: PerspectiveCamera;
  private readonly raycaster = new Raycaster();
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly ndc = new Vector2();
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();

  private grabActive = false;
  private readonly grabPoint = new Vector3();

  constructor(bounds: CameraBounds, aspect = 1) {
    this.bounds = bounds;
    this.camera = new PerspectiveCamera(CAMERA.fov, aspect, 0.1, 2000);
    this.goalCamera = new PerspectiveCamera(CAMERA.fov, aspect, 0.1, 2000);
    const initial = this.defaultState();
    this.goal = { ...initial };
    this.view = { ...initial };
    this.applyState(this.camera, this.view);
  }

  // ---------------------------------------------------------------- accessors

  /** Current (rendered) yaw in radians, normalised to [0, 2π). */
  get yaw(): number {
    return MathUtils.euclideanModulo(this.view.yaw, Math.PI * 2);
  }

  get pitch(): number {
    return this.view.pitch;
  }

  get distance(): number {
    return this.view.distance;
  }

  /** Writes the current (rendered) ground target into `out`. */
  getTarget(out: Vector3): Vector3 {
    return out.set(this.view.tx, 0, this.view.tz);
  }

  /** True while the view is still easing toward the goal. */
  get isAnimating(): boolean {
    const g = this.goal;
    const v = this.view;
    return (
      Math.abs(g.tx - v.tx) > EPSILON ||
      Math.abs(g.tz - v.tz) > EPSILON ||
      Math.abs(g.yaw - v.yaw) > EPSILON ||
      Math.abs(g.pitch - v.pitch) > EPSILON ||
      Math.abs(g.distance - v.distance) > EPSILON
    );
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.goalCamera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.goalCamera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- commands

  /** Moves the goal target by a world-space offset. */
  panBy(dx: number, dz: number): void {
    this.goal.tx += dx;
    this.goal.tz += dz;
    this.clampState(this.goal);
  }

  /** Moves the goal target relative to the camera heading (screen right / screen up). */
  panLocal(right: number, forward: number): void {
    const s = Math.sin(this.goal.yaw);
    const c = Math.cos(this.goal.yaw);
    // Forward is the view direction projected on the ground: (-sin, -cos).
    // Right is forward × up: (cos, -sin).
    this.panBy(right * c - forward * s, -right * s - forward * c);
  }

  /**
   * Multiplies the zoom distance by `factor` (< 1 zooms in). When `ndcX/ndcY` are given
   * and hit the ground, the point under them stays fixed on screen.
   */
  zoomAt(factor: number, ndcX?: number, ndcY?: number): void {
    const g = this.goal;
    const newDistance = MathUtils.clamp(
      g.distance * factor,
      CAMERA.minDistance,
      CAMERA.maxDistance,
    );
    const k = newDistance / g.distance;
    if (Math.abs(k - 1) < 1e-9) return;

    if (ndcX !== undefined && ndcY !== undefined) {
      this.applyState(this.goalCamera, g);
      if (this.intersectGround(this.goalCamera, ndcX, ndcY, this.tmpA)) {
        // Scale the whole camera configuration about the anchor point: the anchor keeps
        // its screen position because orientation is unchanged.
        g.tx = this.tmpA.x + (g.tx - this.tmpA.x) * k;
        g.tz = this.tmpA.z + (g.tz - this.tmpA.z) * k;
      }
    }
    g.distance = newDistance;
    this.clampState(g);
  }

  /** Rotates by whole quarter turns, snapping to the diagonal isometric headings. */
  rotateStep(steps: number): void {
    const base = MathUtils.degToRad(CAMERA.defaultYaw);
    const k = Math.round((this.goal.yaw - base) / QUARTER_TURN);
    this.goal.yaw = base + (k + steps) * QUARTER_TURN;
  }

  /** Free rotation (radians). Pitch is clamped. */
  rotateBy(dYaw: number, dPitch: number): void {
    this.goal.yaw += dYaw;
    this.goal.pitch += dPitch;
    this.clampState(this.goal);
  }

  /** Starts a "grab the ground" pan at the given screen point. Returns false if the ray misses. */
  beginGrab(ndcX: number, ndcY: number): boolean {
    this.grabActive = this.intersectGround(this.camera, ndcX, ndcY, this.grabPoint);
    return this.grabActive;
  }

  /** Continues a grab so the grabbed ground point follows the cursor. Applied immediately. */
  dragGrab(ndcX: number, ndcY: number): void {
    if (!this.grabActive) return;
    if (!this.intersectGround(this.camera, ndcX, ndcY, this.tmpB)) return;
    const dx = this.grabPoint.x - this.tmpB.x;
    const dz = this.grabPoint.z - this.tmpB.z;
    this.view.tx += dx;
    this.view.tz += dz;
    this.clampState(this.view);
    // The goal follows the view so the pan does not ease afterward.
    this.goal.tx = this.view.tx;
    this.goal.tz = this.view.tz;
    this.applyState(this.camera, this.view);
  }

  endGrab(): void {
    this.grabActive = false;
  }

  /** Animates back to the default view centred on the map. */
  reset(): void {
    const d = this.defaultState();
    // Keep yaw continuous so the reset rotates the short way round.
    const turns = Math.round((this.goal.yaw - d.yaw) / (Math.PI * 2));
    Object.assign(this.goal, d, { yaw: d.yaw + turns * Math.PI * 2 });
  }

  /** Jumps the view to the goal immediately (no easing). */
  snap(): void {
    Object.assign(this.view, this.goal);
    this.applyState(this.camera, this.view);
  }

  /** Eases the view toward the goal and updates the three.js camera. */
  update(dt: number): void {
    const a = 1 - Math.exp(-CAMERA.damping * Math.max(0, dt));
    const g = this.goal;
    const v = this.view;
    v.tx += (g.tx - v.tx) * a;
    v.tz += (g.tz - v.tz) * a;
    v.yaw += (g.yaw - v.yaw) * a;
    v.pitch += (g.pitch - v.pitch) * a;
    v.distance += (g.distance - v.distance) * a;
    if (!this.isAnimating) Object.assign(v, g);
    this.applyState(this.camera, v);
  }

  // ---------------------------------------------------------------- picking

  /**
   * Intersects the screen ray at (ndcX, ndcY) with the ground plane (y = 0) using the
   * rendered camera. Returns false when the ray does not hit the ground.
   */
  groundPointAtNdc(ndcX: number, ndcY: number, out: Vector3): boolean {
    return this.intersectGround(this.camera, ndcX, ndcY, out);
  }

  // ---------------------------------------------------------------- internals

  private defaultState(): ViewState {
    return {
      tx: (this.bounds.minX + this.bounds.maxX) / 2,
      tz: (this.bounds.minZ + this.bounds.maxZ) / 2,
      yaw: MathUtils.degToRad(CAMERA.defaultYaw),
      pitch: MathUtils.degToRad(CAMERA.defaultPitch),
      distance: CAMERA.defaultDistance,
    };
  }

  private clampState(s: ViewState): void {
    const m = CAMERA.boundsMargin;
    s.tx = MathUtils.clamp(s.tx, this.bounds.minX - m, this.bounds.maxX + m);
    s.tz = MathUtils.clamp(s.tz, this.bounds.minZ - m, this.bounds.maxZ + m);
    s.pitch = MathUtils.clamp(
      s.pitch,
      MathUtils.degToRad(CAMERA.minPitch),
      MathUtils.degToRad(CAMERA.maxPitch),
    );
    s.distance = MathUtils.clamp(s.distance, CAMERA.minDistance, CAMERA.maxDistance);
  }

  private applyState(cam: PerspectiveCamera, s: ViewState): void {
    const cp = Math.cos(s.pitch);
    cam.position.set(
      s.tx + Math.sin(s.yaw) * cp * s.distance,
      Math.sin(s.pitch) * s.distance,
      s.tz + Math.cos(s.yaw) * cp * s.distance,
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(s.tx, 0, s.tz);

    // Scale clip planes with zoom to keep depth precision high at every distance.
    const near = Math.max(0.1, s.distance * 0.02);
    const far = s.distance * 2.5 + 400;
    if (Math.abs(cam.near - near) > near * 0.01 || Math.abs(cam.far - far) > far * 0.01) {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  private intersectGround(
    cam: PerspectiveCamera,
    ndcX: number,
    ndcY: number,
    out: Vector3,
  ): boolean {
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, cam);
    return this.raycaster.ray.intersectPlane(this.groundPlane, out) !== null;
  }
}
