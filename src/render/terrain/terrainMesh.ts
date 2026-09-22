/**
 * Terrain renderer. The map is drawn as square blocks (RENDER.terrainBlockSize tiles per
 * side), each one non-indexed, flat-shaded BufferGeometry built from the world's corner
 * heightmap. Blocks are frustum-culled individually and rebuilt individually when the
 * sim reports a dirty chunk (phase 4 terraforming). Blocks are larger than sim chunks to
 * keep draw calls low. A dirt "skirt" around the map edge makes the map read as a solid
 * slab instead of a paper-thin plane.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshLambertMaterial,
  Vector3,
} from 'three';
import { COLORS, RENDER } from '../../config';
import { Grid } from '../../core/grid';
import { fbm2 } from '../../core/noise';
import { hash2Float } from '../../core/rng';
import type { World } from '../../sim/world';
import { createTerrainMaterial, type TerrainMaterial } from './terrainMaterial';

const VERTS_PER_TILE = 6;

// Scratch objects reused across rebuilds (no per-rebuild allocations beyond buffers).
const baseGrass = new Color();
const tileColor = new Color();
const tileRgb = new Float32Array(3);
const va = new Vector3();
const vb = new Vector3();
const vc = new Vector3();
const e1 = new Vector3();
const e2 = new Vector3();
const n = new Vector3();

export class TerrainMesh {
  readonly group = new Group();

  private readonly world: World;
  private readonly terrainMaterial: TerrainMaterial;
  private readonly skirtMaterial: MeshLambertMaterial;
  /** Block layout over the same tiles as the world grid. */
  private readonly blocks: Grid;
  private readonly blockMeshes: Mesh[] = [];
  private skirt: Mesh | null = null;
  private readonly bounds = new Int32Array(4);

  constructor(world: World) {
    this.world = world;
    this.group.name = 'terrain';
    this.terrainMaterial = createTerrainMaterial();
    this.skirtMaterial = new MeshLambertMaterial({ color: COLORS.dirt, flatShading: true });
    baseGrass.setHex(COLORS.grass);

    const { grid } = world;
    this.blocks = new Grid(grid.width, grid.height, RENDER.terrainBlockSize);
    for (let b = 0; b < this.blocks.chunkCount; b++) {
      const mesh = new Mesh(new BufferGeometry(), this.terrainMaterial.material);
      mesh.name = `terrain-block-${b}`;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.blockMeshes.push(mesh);
      this.group.add(mesh);
      this.rebuildBlock(b);
    }
    this.rebuildSkirt();
  }

  /** Number of terrain draw calls (excluding the skirt). */
  get blockCount(): number {
    return this.blocks.chunkCount;
  }

  /** Rebuilds the block(s) covering a sim chunk after its terrain changed. */
  rebuildChunk(chunk: number): void {
    const { grid } = this.world;
    grid.chunkBounds(chunk, this.bounds);
    const [x0, z0, x1, z1] = this.bounds;
    const first = this.blocks.chunkOf(x0, z0);
    const last = this.blocks.chunkOf(x1 - 1, z1 - 1);
    for (let bz = this.blocks.chunkZ(first); bz <= this.blocks.chunkZ(last); bz++) {
      for (let bx = this.blocks.chunkX(first); bx <= this.blocks.chunkX(last); bx++) {
        this.rebuildBlock(bz * this.blocks.chunksX + bx);
      }
    }
  }

  rebuildAll(): void {
    for (let b = 0; b < this.blocks.chunkCount; b++) this.rebuildBlock(b);
    this.rebuildSkirt();
  }

  setGridVisible(visible: boolean): void {
    this.terrainMaterial.setGridOpacity(visible ? 1 : 0);
  }

  /** Rebuilds one block's geometry from the world heightmap. */
  private rebuildBlock(b: number): void {
    const { seed } = this.world;
    this.blocks.chunkBounds(b, this.bounds);
    const [x0, z0, x1, z1] = this.bounds;
    const tileCount = (x1 - x0) * (z1 - z0);

    const positions = new Float32Array(tileCount * VERTS_PER_TILE * 3);
    const normals = new Float32Array(tileCount * VERTS_PER_TILE * 3);
    const colors = new Float32Array(tileCount * VERTS_PER_TILE * 3);

    let v = 0;
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        this.computeTileColor(x, z, seed);
        v = writeTileQuad(positions, normals, colors, v, this.world, x, z);
      }
    }

    const mesh = this.blockMeshes[b];
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  }

  dispose(): void {
    for (const mesh of this.blockMeshes) mesh.geometry.dispose();
    this.skirt?.geometry.dispose();
    this.terrainMaterial.material.dispose();
    this.skirtMaterial.dispose();
    this.group.clear();
  }

  // ------------------------------------------------------------------ internals

  /**
   * Low-frequency tint (meadow patches) plus a tiny per-tile jitter; both are seeded from
   * tile coordinates so colours are stable across rebuilds.
   */
  private computeTileColor(x: number, z: number, seed: number): void {
    const patch = fbm2(x / 14, z / 14, 3, seed); // 0..1, smooth
    const jitter = hash2Float(x, z, seed ^ 0x9e3779b9) - 0.5; // -0.5..0.5
    const light = 0.9 + patch * 0.18 + jitter * 0.035;
    // Drier (yellower) grass in lighter patches.
    tileColor.copy(baseGrass).multiplyScalar(light);
    tileColor.r += (patch - 0.5) * 0.025;
    tileRgb[0] = tileColor.r;
    tileRgb[1] = tileColor.g;
    tileRgb[2] = tileColor.b;
  }

  private rebuildSkirt(): void {
    const { grid } = this.world;
    const W = grid.width;
    const H = grid.height;
    const bottom = -RENDER.mapSkirtDepth;
    const quads = 2 * (W + H);
    const positions = new Float32Array(quads * 6 * 3);
    const normals = new Float32Array(quads * 6 * 3);
    let v = 0;

    const wall = (ax: number, az: number, bx: number, bz: number, ox: number, oz: number) => {
      const ha = this.world.cornerHeight(ax, az);
      const hb = this.world.cornerHeight(bx, bz);
      v = writeWallQuad(positions, normals, v, ax, az, ha, bx, bz, hb, bottom, ox, oz);
    };
    for (let x = 0; x < W; x++) {
      wall(x, 0, x + 1, 0, 0, -1); // north edge faces -z
      wall(x, H, x + 1, H, 0, 1); // south edge faces +z
    }
    for (let z = 0; z < H; z++) {
      wall(0, z, 0, z + 1, -1, 0); // west edge faces -x
      wall(W, z, W, z + 1, 1, 0); // east edge faces +x
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();

    if (this.skirt) {
      this.skirt.geometry.dispose();
      this.skirt.geometry = geometry;
    } else {
      this.skirt = new Mesh(geometry, this.skirtMaterial);
      this.skirt.name = 'terrain-skirt';
      this.skirt.matrixAutoUpdate = false;
      this.group.add(this.skirt);
    }
  }
}

/**
 * Writes a tile as two flat-shaded triangles, CCW seen from above:
 * (00, 01, 11) and (00, 11, 10), where the digits are the corner's x/z offsets.
 */
function writeTileQuad(
  pos: Float32Array,
  nor: Float32Array,
  col: Float32Array,
  v: number,
  world: World,
  x: number,
  z: number,
): number {
  const h00 = world.cornerHeight(x, z);
  const h10 = world.cornerHeight(x + 1, z);
  const h01 = world.cornerHeight(x, z + 1);
  const h11 = world.cornerHeight(x + 1, z + 1);
  va.set(x, h00, z);
  vb.set(x, h01, z + 1);
  vc.set(x + 1, h11, z + 1);
  v = writeTriangle(pos, nor, col, v);
  vb.copy(vc);
  vc.set(x + 1, h10, z);
  return writeTriangle(pos, nor, col, v);
}

/** Writes the triangle (va, vb, vc) with its face normal and the `tileRgb` colour. */
function writeTriangle(pos: Float32Array, nor: Float32Array, col: Float32Array, v: number): number {
  n.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va)).normalize();
  writeVertex(pos, nor, col, v, va);
  writeVertex(pos, nor, col, v + 1, vb);
  writeVertex(pos, nor, col, v + 2, vc);
  return v + 3;
}

function writeVertex(
  pos: Float32Array,
  nor: Float32Array,
  col: Float32Array,
  v: number,
  p: Vector3,
) {
  const o = v * 3;
  pos[o] = p.x;
  pos[o + 1] = p.y;
  pos[o + 2] = p.z;
  nor[o] = n.x;
  nor[o + 1] = n.y;
  nor[o + 2] = n.z;
  col[o] = tileRgb[0];
  col[o + 1] = tileRgb[1];
  col[o + 2] = tileRgb[2];
}

/**
 * Writes a vertical wall quad from the edge segment a→b down to `bottom`, wound so it
 * faces the outward direction (ox, oz) regardless of segment orientation.
 */
function writeWallQuad(
  pos: Float32Array,
  nor: Float32Array,
  v: number,
  ax: number,
  az: number,
  ha: number,
  bx: number,
  bz: number,
  hb: number,
  bottom: number,
  ox: number,
  oz: number,
): number {
  // Triangle (a_top, a_bottom, b_bottom): check its winding against the outward normal.
  e1.set(0, bottom - ha, 0);
  e2.set(bx - ax, bottom - ha, bz - az);
  n.crossVectors(e1, e2);
  const flip = n.x * ox + n.z * oz < 0;

  const quad: [number, number, number][] = [
    [ax, ha, az],
    [ax, bottom, az],
    [bx, bottom, bz],
    [ax, ha, az],
    [bx, bottom, bz],
    [bx, hb, bz],
  ];
  if (flip) {
    [quad[1], quad[2]] = [quad[2], quad[1]];
    [quad[4], quad[5]] = [quad[5], quad[4]];
  }
  for (const [x, y, z] of quad) {
    const o = v * 3;
    pos[o] = x;
    pos[o + 1] = y;
    pos[o + 2] = z;
    nor[o] = ox;
    nor[o + 1] = 0;
    nor[o + 2] = oz;
    v++;
  }
  return v;
}
