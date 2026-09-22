/**
 * Drag preview for road building: the planned tiles drawn with the real road geometry,
 * tinted blue, including how they would connect to existing roads. Drawn with polygon
 * offset so it wins the depth test where it overlaps roads that already exist.
 */

import { BufferGeometry, Color, Mesh, type MeshLambertMaterial } from 'three';
import { DIR_BIT, DIR_DX, DIR_DZ } from '../../core/grid';
import type { World } from '../../sim/world';
import { GeometryBuilder } from '../procedural/geometryBuilder';
import { appendRoadTile } from '../roads/roadGeometry';
import { createRoadMaterial } from '../roads/roadMaterial';

const TINT = { color: new Color(0x6fb8ff), amount: 0.45 };

export class RoadGhost {
  readonly object: Mesh;

  private readonly world: World;
  private readonly builder = new GeometryBuilder();
  private readonly material: MeshLambertMaterial;
  private readonly pathSet = new Set<number>();

  constructor(world: World) {
    this.world = world;
    this.builder.tint = TINT;
    this.material = createRoadMaterial({ polygonOffset: true });
    this.object = new Mesh(new BufferGeometry(), this.material);
    this.object.name = 'road-ghost';
    this.object.visible = false;
    this.object.renderOrder = 5;
  }

  /** Shows the given planned road tiles, connected as they would be once built. */
  show(path: readonly number[]): void {
    const { grid, road } = this.world;
    this.pathSet.clear();
    for (const i of path) this.pathSet.add(i);

    this.builder.clear();
    for (const i of path) {
      const x = grid.x(i);
      const z = grid.z(i);
      let mask = 0;
      for (let d = 0; d < 4; d++) {
        const n = grid.indexSafe(x + DIR_DX[d], z + DIR_DZ[d]);
        if (n !== -1 && (road[n] !== 0 || this.pathSet.has(n))) mask |= DIR_BIT[d];
      }
      appendRoadTile(this.builder, x, z, mask, this.world.tileHeight(x, z));
    }
    this.object.geometry.dispose();
    this.object.geometry = this.builder.toGeometry();
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
