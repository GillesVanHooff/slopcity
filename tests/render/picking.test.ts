/**
 * Phase 1 acceptance: "the hovered tile is always correct at every rotation and zoom".
 * Projects known points to the screen with the real camera and checks that picking
 * returns the tile they belong to.
 */

import { describe, expect, it } from 'vitest';
import { MathUtils, Vector3 } from 'three';
import { Grid } from '../../src/core/grid';
import { Rng } from '../../src/core/rng';
import { CameraRig } from '../../src/render/camera/cameraRig';
import { createTilePick, pickTile } from '../../src/render/picking';

const grid = new Grid(256, 256, 16);
const BOUNDS = { minX: 0, minZ: 0, maxX: 256, maxZ: 256 };

describe('pickTile', () => {
  it('returns the tile under a projected point for many camera configurations', () => {
    const rng = new Rng(2024);
    const rig = new CameraRig(BOUNDS, 16 / 9);
    const pick = createTilePick();
    const p = new Vector3();
    let checked = 0;

    for (let config = 0; config < 40; config++) {
      rig.rotateBy(rng.range(-Math.PI, Math.PI), rng.range(-0.6, 0.6));
      rig.zoomAt(rng.range(0.4, 2.5));
      rig.panBy(rng.range(-60, 60), rng.range(-60, 60));
      rig.snap();

      for (let s = 0; s < 50; s++) {
        // Random point strictly inside a tile (avoid exact edges, which are ambiguous).
        const tx = rng.int(0, 255);
        const tz = rng.int(0, 255);
        p.set(tx + rng.range(0.02, 0.98), 0, tz + rng.range(0.02, 0.98));
        p.project(rig.camera);
        // Skip points that are off-screen or behind the camera.
        if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z > 1 || p.z < -1) continue;
        pickTile(rig, grid, p.x, p.y, pick);
        expect(pick.index).toBe(grid.index(tx, tz));
        expect(pick.x).toBe(tx);
        expect(pick.z).toBe(tz);
        checked++;
      }
    }
    // Make sure the test actually exercised a meaningful number of picks.
    expect(checked).toBeGreaterThan(200);
  });

  it('returns -1 when the cursor is off the map', () => {
    const rig = new CameraRig(BOUNDS, 16 / 9);
    rig.panBy(-1000, -1000); // clamp to the corner margin
    rig.zoomAt(0.2);
    rig.snap();
    const pick = createTilePick();
    // Top-left of the screen looks beyond the map's north-west corner.
    pickTile(rig, grid, -0.95, 0.95, pick);
    expect(pick.index).toBe(-1);
  });

  it('never shows the horizon: every screen corner hits the ground at minimum pitch', () => {
    // Guaranteed by config: minPitch (25°) > half the vertical FOV (15°).
    const rig = new CameraRig(BOUNDS, 21 / 9);
    rig.rotateBy(0, -MathUtils.degToRad(90)); // clamps to the minimum pitch
    rig.zoomAt(1e6); // maximum distance
    rig.snap();
    const hit = new Vector3();
    for (const [x, y] of [
      [-1, 1],
      [0, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      expect(rig.groundPointAtNdc(x, y, hit)).toBe(true);
    }
  });
});
