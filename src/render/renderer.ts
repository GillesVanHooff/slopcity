/**
 * Owns the WebGL renderer, scene, camera rig and lighting, and drives the frame loop.
 * Game-specific per-frame logic (input, picking, HUD updates) is injected via the
 * `onFrame` callback so this class stays a thin rendering shell.
 */

import {
  ACESFilmicToneMapping,
  Color,
  Fog,
  PCFShadowMap,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from 'three';
import { COLORS, RENDER } from '../config';
import { CameraRig, type CameraBounds } from './camera/cameraRig';
import { SceneLighting } from './lighting';

export interface RendererOptions {
  bounds: CameraBounds;
  shadows?: boolean;
}

/** Called once per animation frame, before rendering. `dt` is in seconds (clamped). */
export type FrameCallback = (dt: number, now: number) => void;

/** Longest frame step fed to animations, so a background tab doesn't cause a jump. */
const MAX_DT = 0.1;

export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly rig: CameraRig;
  readonly lighting: SceneLighting;
  readonly canvas: HTMLCanvasElement;

  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private lastTime = -1;
  private onFrame: FrameCallback | null = null;
  private readonly fog: Fog;
  private readonly skyColor = new Color();

  constructor(container: HTMLElement, opts: RendererOptions) {
    this.container = container;

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = opts.shadows ?? true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.tabIndex = 0; // focusable, so keyboard input targets the game
    container.appendChild(this.canvas);

    this.scene.background = this.skyColor.set(COLORS.sky);
    this.fog = new Fog(COLORS.sky, 200, 800);
    this.scene.fog = this.fog;

    this.rig = new CameraRig(opts.bounds);
    this.lighting = new SceneLighting(opts.shadows ?? true);
    this.scene.add(...this.lighting.objects);
    this.applySkyColor();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Sets the time of day in hours: moves the sun and tints the sky and fog. */
  setTimeOfDay(hours: number): void {
    this.lighting.setTimeOfDay(hours);
    this.applySkyColor();
  }

  start(onFrame: FrameCallback): void {
    this.onFrame = onFrame;
    this.lastTime = -1;
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  stop(): void {
    this.renderer.setAnimationLoop(null);
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.lighting.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private frame(time: number): void {
    const now = time / 1000;
    const dt = this.lastTime < 0 ? 0 : Math.min(now - this.lastTime, MAX_DT);
    this.lastTime = now;

    this.onFrame?.(dt, now);
    this.lighting.follow(this.rig);
    this.updateFog();
    this.renderer.render(this.scene, this.rig.camera);
  }

  private applySkyColor(): void {
    this.skyColor.copy(this.lighting.sunState.skyColor);
    this.fog.color.copy(this.skyColor);
  }

  /** Fog scales with zoom so it only softens the far horizon, never the play area. */
  private updateFog(): void {
    const d = this.rig.distance;
    this.fog.near = d * 2.2 + 60;
    this.fog.far = d * 5 + 300;
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.rig.setAspect(w / h);
  }
}
