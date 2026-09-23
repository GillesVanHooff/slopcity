/**
 * Test fixtures for road geometry: small worlds with roads in them, and the geometry of
 * one tile, so pieces are built from real road layers like in the game.
 */

import type { BufferGeometry } from 'three';
import { DIR_BIT, DIR_DX, DIR_DZ } from '../../src/core/grid';
import { ROADS } from '../../src/config';
import { GeometryBuilder } from '../../src/render/procedural/geometryBuilder';
import { appendRoadTile } from '../../src/render/roads/roadGeometry';
import { updateRoadMasks } from '../../src/sim/roads/autotile';
import { World } from '../../src/sim/world';

/** Geometry of road tile (x, z) of `world`, in world coordinates. */
export function tileGeometry(world: World, x: number, z: number): BufferGeometry {
  const b = new GeometryBuilder();
  appendRoadTile(b, world, x, z, 0);
  return b.toGeometry();
}

/**
 * Geometry of a street tile with connection mask `mask`: the tile sits in a small world
 * with a street tile on each connected side (dead ends pointing at it), and is moved so
 * its origin is at (x, z).
 */
export function streetTileGeometry(mask: number, x = 0, z = 0): BufferGeometry {
  const world = new World({ size: 8, chunkSize: 8, seed: 1 });
  const c = world.grid.index(3, 3);
  const tiles = [c];
  world.road[c] = ROADS.street.id;
  for (let d = 0; d < 4; d++) {
    if ((mask & DIR_BIT[d]) === 0) continue;
    const n = world.grid.index(3 + DIR_DX[d], 3 + DIR_DZ[d]);
    world.road[n] = ROADS.street.id;
    tiles.push(n);
  }
  updateRoadMasks(world, tiles, () => {});
  const g = tileGeometry(world, 3, 3);
  g.translate(x - 3, 0, z - 3);
  return g;
}

export type Kind = 'asphalt' | 'curb' | 'verge' | 'sidewalk' | 'center' | 'stop' | 'lane' | 'none';

export interface UpTri {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  cx: number;
  cz: number;
  y: number;
  kind: Kind;
  surface: number;
}

/** Upward-facing triangles of `g`, classified by their colour. */
export function upTriangles(g: BufferGeometry, colors: Record<string, Color3>): UpTri[] {
  const kinds: [Kind, Color3][] = [
    ['asphalt', colors.asphalt],
    ['curb', colors.curb],
    ['verge', colors.verge],
    ['sidewalk', colors.sidewalk],
    ['center', colors.centerLine],
    ['stop', colors.stopLine],
    ['lane', colors.laneLine],
  ];
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('color');
  const surf = g.getAttribute('aSurface');
  const out: UpTri[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    if (nor.getY(t) < 0.99) continue;
    const r = col.getX(t);
    const gg = col.getY(t);
    const bb = col.getZ(t);
    const match = kinds.find(
      ([, c]) => Math.abs(c.r - r) < 1e-6 && Math.abs(c.g - gg) < 1e-6 && Math.abs(c.b - bb) < 1e-6,
    );
    out.push({
      ax: pos.getX(t),
      az: pos.getZ(t),
      bx: pos.getX(t + 1),
      bz: pos.getZ(t + 1),
      cx: pos.getX(t + 2),
      cz: pos.getZ(t + 2),
      y: pos.getY(t),
      kind: match?.[0] ?? 'none',
      surface: surf.getX(t),
    });
  }
  return out;
}

interface Color3 {
  r: number;
  g: number;
  b: number;
}

/** The topmost upward surface at (x, z), or null where the tile shows bare ground. */
export function topAt(tris: readonly UpTri[], x: number, z: number): UpTri | null {
  let best: UpTri | null = null;
  for (const t of tris) {
    const d1 = (t.bx - t.ax) * (z - t.az) - (t.bz - t.az) * (x - t.ax);
    const d2 = (t.cx - t.bx) * (z - t.bz) - (t.cz - t.bz) * (x - t.bx);
    const d3 = (t.ax - t.cx) * (z - t.cz) - (t.az - t.cz) * (x - t.cx);
    const inside =
      (d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9) || (d1 <= 1e-9 && d2 <= 1e-9 && d3 <= 1e-9);
    if (inside && (!best || t.y > best.y)) best = t;
  }
  return best;
}

export function kindAt(tris: readonly UpTri[], x: number, z: number): Kind {
  return topAt(tris, x, z)?.kind ?? 'none';
}
