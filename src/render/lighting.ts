/**
 * Scene lighting: a hemisphere fill light plus a directional sun whose position follows
 * the time of day (see sun.ts) and whose shadow frustum follows the camera. The frustum
 * is sized from the zoom distance (quantised to avoid constant re-fitting) and its centre
 * is snapped to whole shadow-map texels in light space, which stops shadow edges from
 * shimmering while the camera pans.
 *
 * Shadow biases are specified in world units / texels and converted whenever the frustum
 * changes. three.js's `shadow.bias` is a fraction of the shadow camera's depth range, so
 * a fixed value means very different world offsets at different zoom levels; too large an
 * offset detaches shadows from building bases ("peter panning"). Casters render their
 * front faces into the shadow map (see materials.ts), so the normal-offset bias must be
 * at least the PCF filter radius to keep sunlit walls free of acne.
 */

import type { Object3D } from 'three';
import { DirectionalLight, HemisphereLight, Vector3 } from 'three';
import { COLORS, RENDER, TIME_OF_DAY } from '../config';
import type { CameraRig } from './camera/cameraRig';
import { computeSun, createSunState, type SunState } from './sun';

/** Constant depth bias in world units. Just enough to stop acne on flat ground. */
const DEPTH_BIAS_WORLD = 0.01;
/** PCF filter radius in texels; softens stair-stepping where the sun grazes a wall. */
const SHADOW_FILTER_RADIUS = 2.5;
/** Offset along the surface normal in texels; must exceed the filter radius (see header). */
const NORMAL_BIAS_TEXELS = 3;
/** Extra depth beyond the view area kept behind the ground, in world units. */
const DEPTH_SLACK = 10;

const WORLD_UP = new Vector3(0, 1, 0);

export class SceneLighting {
  readonly hemisphere: HemisphereLight;
  readonly sun: DirectionalLight;
  readonly objects: Object3D[];
  /** Current sun state (direction, colours); read by the renderer for the sky colour. */
  readonly sunState: SunState = createSunState();

  // Orthonormal light-space basis used for texel snapping.
  private readonly lightRight = new Vector3();
  private readonly lightUp = new Vector3();
  private readonly target = new Vector3();
  private readonly center = new Vector3();
  private halfSize = 0;
  private sunDistance = 0;
  private frustumDirty = true;

  constructor(shadows: boolean) {
    this.hemisphere = new HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 1.1);
    this.sun = new DirectionalLight(COLORS.sunLight, 2.4);
    this.sun.castShadow = shadows;
    this.sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    this.sun.shadow.radius = SHADOW_FILTER_RADIUS;
    this.objects = [this.hemisphere, this.sun, this.sun.target];
    this.setTimeOfDay(TIME_OF_DAY.default);
  }

  /** Moves the sun to the given time of day (hours) and updates light colours. */
  setTimeOfDay(hours: number): void {
    const s = computeSun(hours, this.sunState);
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = s.sunIntensity;
    this.hemisphere.intensity = s.hemiIntensity;

    this.lightRight.crossVectors(WORLD_UP, s.direction).normalize();
    this.lightUp.crossVectors(s.direction, this.lightRight).normalize();
    // Depth range depends on the sun's elevation; refit on the next follow().
    this.frustumDirty = true;
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
    const texel = (2 * half) / RENDER.shadowMapSize;
    if (half !== this.halfSize || this.frustumDirty) {
      this.halfSize = half;
      this.frustumDirty = false;
      this.fitShadowFrustum(half, texel);
    }

    // Snap the view target to the shadow texel grid in light space.
    const dir = this.sunState.direction;
    rig.getTarget(this.target);
    const r = Math.round(this.target.dot(this.lightRight) / texel) * texel;
    const u = Math.round(this.target.dot(this.lightUp) / texel) * texel;
    const d = this.target.dot(dir);
    this.center
      .copy(this.lightRight)
      .multiplyScalar(r)
      .addScaledVector(this.lightUp, u)
      .addScaledVector(dir, d);

    this.sun.target.position.copy(this.center);
    this.sun.position.copy(this.center).addScaledVector(dir, this.sunDistance);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  /**
   * Sizes the orthographic shadow camera to ±half and keeps its depth range as tight as
   * possible (precision), then converts the world-space biases for that range.
   */
  private fitShadowFrustum(half: number, texel: number): void {
    const shadow = this.sun.shadow;
    const cam = shadow.camera;
    // In front of the ground (toward the sun) we need room for the tallest caster, whose
    // top lies maxCasterHeight / sin(elevation) closer to the sun than its shadow; low
    // sun needs more. Ground in the view area lies within ±half of the centre in depth.
    const toCasterTop = TIME_OF_DAY.maxCasterHeight / Math.sin(this.sunState.elevation);
    this.sunDistance = half + toCasterTop;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 0.5;
    cam.far = this.sunDistance + half + DEPTH_SLACK;
    cam.updateProjectionMatrix();

    shadow.bias = -DEPTH_BIAS_WORLD / (cam.far - cam.near);
    shadow.normalBias = texel * NORMAL_BIAS_TEXELS;
  }

  dispose(): void {
    this.sun.dispose();
    this.hemisphere.dispose();
  }
}
