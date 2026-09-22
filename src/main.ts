/**
 * Bootstrap: builds the world, renderer, input and HUD, then runs the frame loop.
 * Keep this file as wiring only; behaviour belongs in the modules it connects.
 */

import './ui/hud.css';
import { effect } from '@preact/signals';
import { MathUtils } from 'three';
import { CHUNK_SIZE, DEFAULT_SEED, MAP_SIZE } from './config';
import { CameraController } from './input/cameraController';
import { InputManager } from './input/input';
import { createTestProps } from './render/debug/testProps';
import { FrameStats } from './render/frameStats';
import { createTilePick, pickTile } from './render/picking';
import { TileHighlight } from './render/preview/tileHighlight';
import { GameRenderer } from './render/renderer';
import { TerrainMesh } from './render/terrain/terrainMesh';
import { World } from './sim/world';
import { mountHud } from './ui/hud';
import { resolveKeyLabels } from './ui/keyLabels';
import { hud } from './ui/state';

const HOTKEY_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyG', 'KeyH'];

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element`);
  return el;
}

function main(): void {
  const params = new URLSearchParams(window.location.search);
  const debug = params.has('debug');

  // ---- world (pure sim state)
  const world = new World({ size: MAP_SIZE, chunkSize: CHUNK_SIZE, seed: DEFAULT_SEED });
  const { grid } = world;

  // ---- rendering
  const gr = new GameRenderer(requireElement('viewport'), {
    bounds: { minX: 0, minZ: 0, maxX: grid.width, maxZ: grid.height },
    shadows: !params.has('noshadows'),
  });
  const terrain = new TerrainMesh(world);
  gr.scene.add(terrain.group);
  const highlight = new TileHighlight(world);
  gr.scene.add(highlight.object);
  if (debug) gr.scene.add(createTestProps(world).group);

  // ---- input
  const input = new InputManager(gr.canvas);
  const cameraController = new CameraController(input, gr.rig);

  // ---- HUD
  const actions = {
    resetView: () => gr.rig.reset(),
    toggleGrid: () => (hud.gridVisible.value = !hud.gridVisible.value),
    toggleHelp: () => (hud.helpVisible.value = !hud.helpVisible.value),
  };
  mountHud(requireElement('ui'), actions);
  effect(() => terrain.setGridVisible(hud.gridVisible.value));
  void resolveKeyLabels(HOTKEY_CODES).then((labels) => (hud.keyLabels.value = labels));

  input.events.on('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyG') actions.toggleGrid();
    else if (e.code === 'KeyH') actions.toggleHelp();
  });

  // ---- frame loop
  const pick = createTilePick();
  const stats = new FrameStats();
  let lastHover = -2;
  let lastHeading = Number.NaN;
  let lastZoom = Number.NaN;

  gr.start((dt) => {
    cameraController.update(dt);
    gr.rig.update(dt);

    // Picking runs every frame because the camera can move under a still cursor.
    if (input.pointerInside) pickTile(gr.rig, grid, input.ndcX, input.ndcY, pick);
    else pick.index = -1;
    if (pick.index !== lastHover) {
      lastHover = pick.index;
      highlight.setTile(pick.index, pick.x, pick.z);
      hud.hoverTile.value = pick.index < 0 ? null : { x: pick.x, z: pick.z };
    }

    // Heading = compass bearing of the view direction (0 = north / -z, clockwise).
    const heading = MathUtils.euclideanModulo(-MathUtils.radToDeg(gr.rig.yaw), 360);
    if (!(Math.abs(heading - lastHeading) < 0.25)) {
      lastHeading = heading;
      hud.headingDeg.value = heading;
    }
    const zoom = Math.round(gr.rig.distance);
    if (zoom !== lastZoom) {
      lastZoom = zoom;
      hud.zoomDistance.value = zoom;
    }

    const sample = stats.frame(dt);
    if (sample) {
      hud.fps.value = sample.fps;
      hud.frameMs.value = sample.frameMs;
      hud.drawCalls.value = gr.renderer.info.render.calls;
      hud.triangles.value = gr.renderer.info.render.triangles;
    }
  });

  if (debug) {
    // Handy for poking at the scene from the devtools console.
    Object.assign(window, { slopcity: { world, renderer: gr, terrain, input } });
  }
}

main();
