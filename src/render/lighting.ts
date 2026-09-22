/**
 * Scene lighting: a hemisphere fill light plus a directional sun whose shadow frustum
 * follows the camera. The frustum is sized from the zoom distance (quantised to avoid
 * constant re-fitting) and its centre is snapped to whole shadow-map texels in light
 * space, which stops shadow edges from shimmering while the camera pans.
 */

import type { Object3D } from 'three';
import { DirectionalLight, HemisphereLight, Vector3 } from 'three';
import { COLORS, RENDER } from '../config';
import type { CameraRig } from './camera/cameraRig';

/** Direction *toward* the sun (normalised in the constructor). */
const SUN_DIRECTION = new Vector3(-0.55, 1, 0.35);
const SUN_DISTANCE = 400;

export class SceneLighting {
  readonly hemisphere: HemisphereLight;
  readonly sun: DirectionalLight;
  readonly objects: Object3D[];

  private readonly sunDir = SUN_DIRECTION.clone().normalize();
  // Orthonormal light-space basis used for texel snapping.
  private readonly lightRight = new Vector3();
  private readonly lightUp = new Vector3();
  private readonly target = new Vector3();
  private readonly center = new Vector3();
  private halfSize = 0;

  constructor(shadows: boolean) {
    this.hemisphere = new HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 1.1);

    this.sun = new DirectionalLight(COLORS.sunLight, 2.4);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = SUN_DISTANCE * 2;

    this.lightRight.crossVectors(new Vector3(0, 1, 0), this.sunDir).normalize();
    this.lightUp.crossVectors(this.sunDir, this.lightRight).normalize();

    this.objects = [this.hemisphere, this.sun, this.sun.target];
  }

  /** Re-centres the sun and its shadow frustum on the camera's view. */
  follow(rig: CameraRig): void {
    const wanted = Math.min(
      Math.max(rig.distance * RENDER.shadowCoverage, RENDER.shadowMinHalfSize),
      RENDER.shadowMaxHalfSize,
    );
    // Quantise the frustum size to steps of 1/8 of a doubling so it only changes
    // occasionally while zooming (each change resamples the whole shadow map).
    const half = Math.pow(2, Math.ceil(Math.log2(wanted) * 8) / 8);
    if (half !== this.halfSize) {
      this.halfSize = half;
      const cam = this.sun.shadow.camera;
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.updateProjectionMatrix();
    }

    // Snap the view target to the shadow texel grid in light space.
    rig.getTarget(this.target);
    const texel = (2 * half) / RENDER.shadowMapSize;
    const r = Math.round(this.target.dot(this.lightRight) / texel) * texel;
    const u = Math.round(this.target.dot(this.lightUp) / texel) * texel;
    const d = this.target.dot(this.sunDir);
    this.center
      .copy(this.lightRight)
      .multiplyScalar(r)
      .addScaledVector(this.lightUp, u)
      .addScaledVector(this.sunDir, d);

    this.sun.target.position.copy(this.center);
    this.sun.position.copy(this.center).addScaledVector(this.sunDir, SUN_DISTANCE);
    this.sun.target.updateMatrixWorld();
  }

  dispose(): void {
    this.sun.dispose();
    this.hemisphere.dispose();
  }
}
