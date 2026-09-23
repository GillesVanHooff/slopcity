/**
 * Bootstrap: builds the world, renderer, input and HUD, then runs the frame loop.
 * Keep this file as wiring only; behaviour belongs in the modules it connects.
 */

import './ui/hud.css';
import { effect } from '@preact/signals';
import { MathUtils } from 'three';
import { CHUNK_SIZE, DEFAULT_SEED, MAP_SIZE, ROADS, TIME_OF_DAY } from './config';
import { CameraController } from './input/cameraController';
import { InputManager } from './input/input';
import { BulldozeTool } from './input/tools/bulldozeTool';
import { RoadTool } from './input/tools/roadTool';
import { SelectTool } from './input/tools/selectTool';
import { ToolManager } from './input/tools/toolManager';
import { createTestProps } from './render/debug/testProps';
import { FrameStats } from './render/frameStats';
import { createTilePick, pickTile } from './render/picking';
import { RoadGhost } from './render/preview/roadGhost';
import { TileHighlight } from './render/preview/tileHighlight';
import { TileOverlay } from './render/preview/tileOverlay';
import { GameRenderer } from './render/renderer';
import { RoadMesh } from './render/roads/roadMesh';
import { TerrainMesh } from './render/terrain/terrainMesh';
import { Simulation } from './sim/simulation';
import { World } from './sim/world';
import { mountHud } from './ui/hud';
import { resolveKeyLabels } from './ui/keyLabels';
import { hud } from './ui/state';
import type { ToolId } from './input/tools/tool';

const HOTKEY_CODES = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyG',
  'KeyH',
  'KeyR',
  'KeyV',
  'KeyB',
  'BracketLeft',
  'BracketRight',
];
/** Hours moved per press of the time-of-day hotkeys. */
const TIME_HOTKEY_STEP = 0.5;

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
  const sim = new Simulation(world);

  // ---- rendering
  const gr = new GameRenderer(requireElement('viewport'), {
    bounds: { minX: 0, minZ: 0, maxX: grid.width, maxZ: grid.height },
    shadows: !params.has('noshadows'),
  });
  const terrain = new TerrainMesh(world);
  gr.scene.add(terrain.group);
  const roads = new RoadMesh(world);
  gr.scene.add(roads.group);
  sim.events.on('changes', (changes) => roads.rebuildChunks(changes.dirtyChunks));
  const highlight = new TileHighlight(world);
  gr.scene.add(highlight.object);
  const roadGhost = new RoadGhost(world);
  const bulldozeOverlay = new TileOverlay(grid, 0xff4d3d);
  gr.scene.add(roadGhost.object, bulldozeOverlay.object);
  if (debug) gr.scene.add(createTestProps(world).group);

  // ---- input
  const input = new InputManager(gr.canvas);
  const cameraController = new CameraController(input, gr.rig);
  const showHint = (text: string | null) => {
    if (text) hud.pointer.value = { x: input.pointerX, y: input.pointerY };
    hud.cursorHint.value = text;
  };
  const tools = new ToolManager(input, gr.canvas, [
    new SelectTool(),
    new RoadTool('road', ROADS.street, sim, roadGhost, showHint),
    new RoadTool('avenue', ROADS.avenue, sim, roadGhost, showHint),
    new BulldozeTool(sim, bulldozeOverlay, showHint),
  ]);
  tools.onToolChange = (id) => (hud.activeTool.value = id);
  input.events.on('pointermove', () => {
    if (hud.cursorHint.value) hud.pointer.value = { x: input.pointerX, y: input.pointerY };
  });

  // ---- HUD
  const actions = {
    resetView: () => gr.rig.reset(),
    toggleGrid: () => (hud.gridVisible.value = !hud.gridVisible.value),
    toggleHelp: () => (hud.helpVisible.value = !hud.helpVisible.value),
    setTimeOfDay: (hours: number) =>
      (hud.timeOfDay.value = MathUtils.clamp(hours, TIME_OF_DAY.sunrise, TIME_OF_DAY.sunset)),
    setTool: (id: ToolId) => (hud.activeTool.value = id),
  };
  mountHud(requireElement('ui'), actions);
  effect(() => terrain.setGridVisible(hud.gridVisible.value));
  effect(() => gr.setTimeOfDay(hud.timeOfDay.value));
  effect(() => tools.setActive(hud.activeTool.value));
  void resolveKeyLabels(HOTKEY_CODES).then((labels) => (hud.keyLabels.value = labels));

  input.events.on('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.code) {
      case 'KeyG':
        actions.toggleGrid();
        break;
      case 'KeyH':
        actions.toggleHelp();
        break;
      case 'BracketLeft':
        actions.setTimeOfDay(hud.timeOfDay.value - TIME_HOTKEY_STEP);
        break;
      case 'BracketRight':
        actions.setTimeOfDay(hud.timeOfDay.value + TIME_HOTKEY_STEP);
        break;
      case 'KeyR':
        actions.setTool('road');
        break;
      case 'KeyV':
        actions.setTool('avenue');
        break;
      case 'KeyB':
        actions.setTool('bulldoze');
        break;
    }
  });

  // ---- frame loop
  const pick = createTilePick();
  const stats = new FrameStats();
  let lastHover = -2;
  const hoverArea = { x: 0, z: 0, w: 1, h: 1 };
  let areaShown = false;
  let lastHeading = Number.NaN;
  let lastZoom = Number.NaN;

  gr.start((dt) => {
    cameraController.update(dt);
    gr.rig.update(dt);

    // Picking runs every frame because the camera can move under a still cursor.
    if (input.pointerInside) pickTile(gr.rig, grid, input.ndcX, input.ndcY, pick);
    else pick.index = -1;
    // Tools may highlight more than the hovered tile (the avenue tool: 2×2 around a corner).
    if (pick.index >= 0 && tools.hoverArea(pick, hoverArea)) {
      highlight.setArea(hoverArea.x, hoverArea.z, hoverArea.w, hoverArea.h);
      areaShown = true;
    } else if (pick.index !== lastHover || areaShown) {
      highlight.setTile(pick.index, pick.x, pick.z);
      areaShown = false;
    }
    if (pick.index !== lastHover) {
      lastHover = pick.index;
      hud.hoverTile.value = pick.index < 0 ? null : { x: pick.x, z: pick.z };
    }
    tools.update(pick);

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
    Object.assign(window, { slopcity: { world, sim, renderer: gr, terrain, roads, input } });
  }
}

main();
