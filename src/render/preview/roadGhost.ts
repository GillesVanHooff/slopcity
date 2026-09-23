/**
 * Drag preview for road building: the planned tiles drawn with the real road geometry,
 * tinted blue (red when the build isn't allowed), connected as they would be once
 * built. The plan is applied to a scratch copy of the road layers, so avenue pieces
 * (curves, median openings, junctions) preview exactly as they'll be built. Drawn with
 * polygon offset so it wins the depth test where it overlaps roads that already exist.
 */

import { BufferGeometry, Color, Mesh, type MeshLambertMaterial } from 'three';
import { applyRoadBuild, type RoadBuildPlan } from '../../sim/roads/build';
import type { RoadLayers, World } from '../../sim/world';
import { GeometryBuilder } from '../procedural/geometryBuilder';
import { appendRoadTile } from '../roads/roadGeometry';
import { createRoadMaterial } from '../roads/roadMaterial';

const VALID_TINT = { color: new Color(0x6fb8ff), amount: 0.45 };
const INVALID_TINT = { color: new Color(0xff5a4a), amount: 0.55 };

export class RoadGhost {
  readonly object: Mesh;

  private readonly world: World;
  private readonly builder = new GeometryBuilder();
  private readonly material: MeshLambertMaterial;
  /** Scratch copy of the world's road layers, allocated on first use. */
  private scratch: RoadLayers | null = null;

  constructor(world: World) {
    this.world = world;
    this.material = createRoadMaterial({ polygonOffset: true });
    this.object = new Mesh(new BufferGeometry(), this.material);
    this.object.name = 'road-ghost';
    this.object.visible = false;
    this.object.renderOrder = 5;
  }

  /** Shows the planned road, as it would look built (red when the plan is invalid). */
  show(plan: RoadBuildPlan): void {
    const { world } = this;
    const scratch = (this.scratch ??= {
      grid: world.grid,
      road: new Uint8Array(world.road.length),
      roadMask: new Uint8Array(world.roadMask.length),
      roadMedian: new Uint8Array(world.roadMedian.length),
    });
    scratch.road.set(world.road);
    scratch.roadMask.set(world.roadMask);
    scratch.roadMedian.set(world.roadMedian);
    // An invalid plan still previews the tiles it could place, in red.
    applyRoadBuild(scratch, plan, noop, true);

    this.builder.clear();
    this.builder.tint = plan.valid ? VALID_TINT : INVALID_TINT;
    const { grid } = world;
    for (const i of plan.tiles) {
      const x = grid.x(i);
      const z = grid.z(i);
      appendRoadTile(this.builder, scratch, x, z, world.tileHeight(x, z));
    }
    this.object.geometry.dispose();
    this.object.geometry = this.builder.toGeometry();
    this.object.visible = plan.tiles.length > 0;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

function noop(): void {}
