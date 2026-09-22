import { describe, expect, it } from 'vitest';
import type { BufferGeometry, Mesh } from 'three';
import { RENDER } from '../../src/config';
import { TerrainMesh } from '../../src/render/terrain/terrainMesh';
import { World } from '../../src/sim/world';

function blockMeshes(t: TerrainMesh): Mesh[] {
  return t.group.children.filter((o) => o.name.startsWith('terrain-block-')) as Mesh[];
}

describe('TerrainMesh', () => {
  const world = new World({ size: 256, chunkSize: 16, seed: 7 });
  const terrain = new TerrainMesh(world);

  it('draws the 256² map in a small number of blocks', () => {
    const expected = (256 / RENDER.renderBlockSize) ** 2;
    expect(terrain.blockCount).toBe(expected);
    expect(blockMeshes(terrain)).toHaveLength(expected);
    expect(terrain.group.getObjectByName('terrain-skirt')).toBeDefined();
  });

  it('builds 2 triangles per tile with upward normals and CCW-from-above winding', () => {
    const geo: BufferGeometry = blockMeshes(terrain)[0].geometry;
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const tiles = RENDER.renderBlockSize ** 2;
    expect(pos.count).toBe(tiles * 6);
    expect(geo.getAttribute('color').count).toBe(tiles * 6);

    for (let t = 0; t < pos.count; t += 3) {
      expect(nor.getY(t)).toBeCloseTo(1, 6);
      // Signed area in the xz plane: counter-clockwise seen from +y means the cross
      // product of the edges points up.
      const ax = pos.getX(t),
        az = pos.getZ(t);
      const bx = pos.getX(t + 1),
        bz = pos.getZ(t + 1);
      const cx = pos.getX(t + 2),
        cz = pos.getZ(t + 2);
      const crossY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      expect(crossY).toBeGreaterThan(0);
    }
  });

  it('covers exactly the map extent', () => {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const mesh of blockMeshes(terrain)) {
      const box = mesh.geometry.boundingBox!;
      minX = Math.min(minX, box.min.x);
      maxX = Math.max(maxX, box.max.x);
      minZ = Math.min(minZ, box.min.z);
      maxZ = Math.max(maxZ, box.max.z);
    }
    expect([minX, minZ, maxX, maxZ]).toEqual([0, 0, 256, 256]);
  });

  it('rebuilds only the block covering a changed sim chunk, reflecting new heights', () => {
    const before = blockMeshes(terrain).map((m) => m.geometry);
    // Raise a corner inside sim chunk (row 2, col 3) → tile (48..63, 32..47).
    world.height[40 * world.cornerStride + 50] = 2;
    const chunk = world.grid.chunkOf(50, 40);
    terrain.rebuildChunk(chunk);
    const after = blockMeshes(terrain).map((m) => m.geometry);

    const changed = after.map((g, i) => g !== before[i]).filter(Boolean).length;
    expect(changed).toBe(1);
    const blocksPerRow = 256 / RENDER.renderBlockSize;
    const block =
      Math.floor(40 / RENDER.renderBlockSize) * blocksPerRow +
      Math.floor(50 / RENDER.renderBlockSize);
    expect(after[block].boundingBox!.max.y).toBeCloseTo(2);
    world.height[40 * world.cornerStride + 50] = 0;
  });

  it('rebuilds a block fast enough for interactive terraforming', () => {
    const start = performance.now();
    const n = 10;
    for (let i = 0; i < n; i++) terrain.rebuildChunk(i * 17);
    const perBlock = (performance.now() - start) / n;
    // plan.md §12 budget is < 2 ms per 16² chunk; a 32² block is 4 chunks of work.
    // Generous margin for slow CI machines.
    expect(perBlock).toBeLessThan(20);
  });
});
