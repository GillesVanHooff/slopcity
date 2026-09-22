import { describe, expect, it } from 'vitest';
import { MathUtils, Vector3 } from 'three';
import { CAMERA } from '../../src/config';
import { CameraRig } from '../../src/render/camera/cameraRig';

const BOUNDS = { minX: 0, minZ: 0, maxX: 256, maxZ: 256 };

function makeRig(): CameraRig {
  const rig = new CameraRig(BOUNDS, 16 / 9);
  rig.snap();
  return rig;
}

/** Angular distance in degrees from the nearest diagonal heading (45° + k·90°). */
function offDiagonal(yawRad: number): number {
  const m = MathUtils.euclideanModulo(MathUtils.radToDeg(yawRad) - 45, 90);
  return Math.min(m, 90 - m);
}

/** Runs the easing until settled (or a generous frame budget runs out). */
function settle(rig: CameraRig, frames = 600): void {
  for (let i = 0; i < frames && rig.isAnimating; i++) rig.update(1 / 60);
}

describe('CameraRig', () => {
  it('starts centred on the map with the configured view', () => {
    const rig = makeRig();
    const t = rig.getTarget(new Vector3());
    expect(t.x).toBe(128);
    expect(t.z).toBe(128);
    expect(rig.distance).toBe(CAMERA.defaultDistance);
    expect(MathUtils.radToDeg(rig.pitch)).toBeCloseTo(CAMERA.defaultPitch);
    expect(MathUtils.radToDeg(rig.yaw)).toBeCloseTo(CAMERA.defaultYaw);
  });

  it('looks at its target from above', () => {
    const rig = makeRig();
    const cam = rig.camera;
    expect(cam.position.y).toBeGreaterThan(0);
    // The screen centre ray must hit the target.
    const hit = new Vector3();
    expect(rig.groundPointAtNdc(0, 0, hit)).toBe(true);
    expect(hit.x).toBeCloseTo(128, 6);
    expect(hit.z).toBeCloseTo(128, 6);
  });

  it('zooms toward the cursor: the ground point under it stays fixed', () => {
    const rig = makeRig();
    const ndc: [number, number] = [0.45, -0.3];
    const before = new Vector3();
    rig.groundPointAtNdc(...ndc, before);

    rig.zoomAt(0.5, ...ndc);
    settle(rig);

    const after = new Vector3();
    rig.groundPointAtNdc(...ndc, after);
    expect(rig.distance).toBeCloseTo(CAMERA.defaultDistance * 0.5, 4);
    expect(after.distanceTo(before)).toBeLessThan(1e-3);
  });

  it('keeps the zoom anchor fixed during the easing animation, not just at the end', () => {
    const rig = makeRig();
    const ndc: [number, number] = [-0.6, 0.4];
    const anchor = new Vector3();
    rig.groundPointAtNdc(...ndc, anchor);
    rig.zoomAt(0.3, ...ndc);
    const p = new Vector3();
    for (let i = 0; i < 30; i++) {
      rig.update(1 / 60);
      rig.groundPointAtNdc(...ndc, p);
      expect(p.distanceTo(anchor)).toBeLessThan(1e-3);
    }
  });

  it('clamps zoom distance', () => {
    const rig = makeRig();
    rig.zoomAt(1e-6);
    rig.snap();
    expect(rig.distance).toBe(CAMERA.minDistance);
    rig.zoomAt(1e6);
    rig.snap();
    expect(rig.distance).toBe(CAMERA.maxDistance);
  });

  it('rotates in quarter turns that stay on the diagonal isometric headings', () => {
    const rig = makeRig();
    for (const steps of [1, 1, 1, 1, -1, -1]) {
      rig.rotateStep(steps);
      settle(rig);
      expect(offDiagonal(rig.yaw)).toBeCloseTo(0, 3);
    }
    // After a free rotation, a step snaps back onto the lattice.
    rig.rotateBy(MathUtils.degToRad(20), 0);
    rig.rotateStep(1);
    settle(rig);
    expect(offDiagonal(rig.yaw)).toBeCloseTo(0, 3);
  });

  it('keeps the rotation centre on screen while rotating', () => {
    const rig = makeRig();
    rig.rotateStep(1);
    const hit = new Vector3();
    for (let i = 0; i < 20; i++) {
      rig.update(1 / 60);
      rig.groundPointAtNdc(0, 0, hit);
      expect(hit.x).toBeCloseTo(128, 4);
      expect(hit.z).toBeCloseTo(128, 4);
    }
  });

  it('clamps pitch', () => {
    const rig = makeRig();
    rig.rotateBy(0, 10);
    rig.snap();
    expect(MathUtils.radToDeg(rig.pitch)).toBeCloseTo(CAMERA.maxPitch);
    rig.rotateBy(0, -10);
    rig.snap();
    expect(MathUtils.radToDeg(rig.pitch)).toBeCloseTo(CAMERA.minPitch);
  });

  it('keeps the target within the map bounds plus margin', () => {
    const rig = makeRig();
    rig.panBy(-1e5, 1e5);
    rig.snap();
    const t = rig.getTarget(new Vector3());
    expect(t.x).toBe(-CAMERA.boundsMargin);
    expect(t.z).toBe(256 + CAMERA.boundsMargin);
  });

  it('pans relative to the heading (forward = away from camera)', () => {
    for (const steps of [0, 1, 2, 3]) {
      const rig = makeRig();
      rig.rotateStep(steps);
      rig.snap();
      const start = rig.getTarget(new Vector3());
      const forward = start.clone().sub(rig.camera.position).setY(0).normalize();
      rig.panLocal(0, 10);
      rig.snap();
      const moved = rig.getTarget(new Vector3()).sub(start);
      expect(moved.length()).toBeCloseTo(10, 6);
      expect(moved.normalize().dot(forward)).toBeCloseTo(1, 6);
    }
  });

  it('grab-pan keeps the grabbed ground point under the cursor', () => {
    const rig = makeRig();
    const grabbed = new Vector3();
    rig.groundPointAtNdc(0.2, 0.1, grabbed);
    expect(rig.beginGrab(0.2, 0.1)).toBe(true);
    rig.dragGrab(-0.3, -0.25);
    const now = new Vector3();
    rig.groundPointAtNdc(-0.3, -0.25, now);
    expect(now.distanceTo(grabbed)).toBeLessThan(1e-4);
    rig.endGrab();
    // No easing afterward: the view already matches the goal.
    expect(rig.isAnimating).toBe(false);
  });

  it('reset() returns to the default view the short way round', () => {
    const rig = makeRig();
    for (let i = 0; i < 9; i++) rig.rotateStep(1); // 2.25 turns
    rig.zoomAt(3);
    rig.panBy(40, -30);
    rig.snap();
    rig.reset();
    settle(rig);
    expect(MathUtils.radToDeg(rig.yaw)).toBeCloseTo(CAMERA.defaultYaw, 3);
    expect(rig.distance).toBeCloseTo(CAMERA.defaultDistance, 3);
    const t = rig.getTarget(new Vector3());
    expect(t.x).toBeCloseTo(128, 3);
  });
});
