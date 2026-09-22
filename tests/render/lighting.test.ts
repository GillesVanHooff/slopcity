/**
 * The shadow frustum must contain everything that can cast a visible shadow: the ground
 * around the view target and the tops of the tallest casters whose shadows fall there, at
 * every time of day and zoom level. Anything outside the frustum silently loses its shadow.
 */

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { TIME_OF_DAY } from '../../src/config';
import { CameraRig } from '../../src/render/camera/cameraRig';
import { SceneLighting } from '../../src/render/lighting';

const BOUNDS = { minX: 0, minZ: 0, maxX: 256, maxZ: 256 };

function inShadowFrustum(lighting: SceneLighting, p: Vector3): boolean {
  const cam = lighting.sun.shadow.camera;
  const ndc = p.clone().project(cam);
  return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z >= -1 && ndc.z <= 1;
}

describe('SceneLighting shadow frustum', () => {
  for (const distance of [8, 70, 300]) {
    it(`contains the ground and tall casters at every hour (zoom ${distance})`, () => {
      const rig = new CameraRig(BOUNDS, 16 / 9);
      rig.zoomAt(distance / rig.distance);
      rig.snap();
      const lighting = new SceneLighting(true);
      const target = rig.getTarget(new Vector3());

      for (let h = TIME_OF_DAY.sunrise; h <= TIME_OF_DAY.sunset; h += 0.5) {
        lighting.setTimeOfDay(h);
        lighting.follow(rig);
        lighting.sun.shadow.updateMatrices(lighting.sun);
        const half = lighting.sun.shadow.camera.right;

        // Ground right under the view centre and a bit around it.
        expect(inShadowFrustum(lighting, target)).toBe(true);
        for (const [dx, dz] of [
          [0.4, 0],
          [-0.4, 0],
          [0, 0.4],
          [0, -0.4],
        ]) {
          const p = target.clone().add(new Vector3(dx * half, 0, dz * half));
          expect(inShadowFrustum(lighting, p)).toBe(true);
        }
        // The top of the tallest caster whose shadow tip lands on the view centre: walk up
        // the light ray from the ground until reaching maxCasterHeight.
        const s = lighting.sunState;
        const top = target
          .clone()
          .addScaledVector(s.direction, TIME_OF_DAY.maxCasterHeight / Math.sin(s.elevation));
        expect(top.y).toBeCloseTo(TIME_OF_DAY.maxCasterHeight, 6);
        expect(inShadowFrustum(lighting, top)).toBe(true);
      }
    });
  }

  it('keeps the depth bias at ~1 cm in world units regardless of depth range', () => {
    const rig = new CameraRig(BOUNDS, 16 / 9);
    const lighting = new SceneLighting(true);
    for (const h of [TIME_OF_DAY.sunrise, 13, TIME_OF_DAY.sunset]) {
      lighting.setTimeOfDay(h);
      lighting.follow(rig);
      const cam = lighting.sun.shadow.camera;
      const worldBias = -lighting.sun.shadow.bias * (cam.far - cam.near);
      expect(worldBias).toBeCloseTo(0.01, 6);
    }
  });
});
