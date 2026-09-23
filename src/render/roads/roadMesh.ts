/**
 * Road renderer: one merged mesh per render block containing every road tile in it.
 * Rebuilt only for blocks touched by a sim ChangeSet. Blocks without roads have no mesh.
 */

import { Group, Mesh, type MeshLambertMaterial } from 'three';
import { RENDER } from '../../config';
import type { World } from '../../sim/world';
import { RenderBlocks } from '../blocks';
import { GeometryBuilder } from '../procedural/geometryBuilder';
import { appendRoadTile } from './roadGeometry';
import { createRoadMaterial } from './roadMaterial';

export class RoadMesh {
  readonly group = new Group();

  private readonly world: World;
  private readonly blocks: RenderBlocks;
  private readonly material: MeshLambertMaterial;
  private readonly meshes: (Mesh | null)[];
  private readonly builder = new GeometryBuilder();
  private readonly bounds = new Int32Array(4);
  private readonly dirtyBlocks = new Set<number>();

  constructor(world: World) {
    this.world = world;
    this.group.name = 'roads';
    this.blocks = new RenderBlocks(world.grid, RENDER.renderBlockSize);
    this.material = createRoadMaterial();
    this.meshes = new Array<Mesh | null>(this.blocks.count).fill(null);
    for (let b = 0; b < this.blocks.count; b++) this.rebuildBlock(b);
  }

  /** Rebuilds the blocks covering the given sim chunks. */
  rebuildChunks(chunks: Iterable<number>): void {
    this.dirtyBlocks.clear();
    for (const c of chunks) this.blocks.addBlocksForChunk(c, this.dirtyBlocks);
    for (const b of this.dirtyBlocks) this.rebuildBlock(b);
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh?.geometry.dispose();
    this.material.dispose();
    this.group.clear();
  }

  private rebuildBlock(b: number): void {
    const { grid, road } = this.world;
    this.blocks.blockBounds(b, this.bounds);
    const [x0, z0, x1, z1] = this.bounds;

    this.builder.clear();
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        const i = grid.index(x, z);
        if (road[i] === 0) continue;
        appendRoadTile(this.builder, this.world, x, z, this.world.tileHeight(x, z));
      }
    }

    const existing = this.meshes[b];
    if (this.builder.vertexCount === 0) {
      if (existing) {
        existing.geometry.dispose();
        this.group.remove(existing);
        this.meshes[b] = null;
      }
      return;
    }
    const geometry = this.builder.toGeometry();
    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geometry;
    } else {
      const mesh = new Mesh(geometry, this.material);
      mesh.name = `roads-block-${b}`;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.meshes[b] = mesh;
      this.group.add(mesh);
    }
  }
}
