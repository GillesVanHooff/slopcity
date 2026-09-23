/**
 * Hover highlight for a single tile: a translucent fill with a crisp outline, drawn just
 * above the ground. Uses polygon offset instead of a large Y offset so it never floats
 * visibly, and ignores depth writes so it can't occlude anything.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { COLORS } from '../../config';
import type { World } from '../../sim/world';

/** Inset keeps the outline inside the tile so adjacent highlights never overlap. */
const INSET = 0.04;
/** Above sidewalk height so the highlight stays visible over roads. */
const LIFT = 0.07;

export class TileHighlight {
  readonly object = new Group();

  private readonly fillMaterial: MeshBasicMaterial;
  private readonly lineMaterial: LineBasicMaterial;
  private readonly fill: Mesh;
  private readonly outline: LineLoop;
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
    this.object.name = 'tile-highlight';
    this.object.visible = false;
    this.object.renderOrder = 10;

    this.fillMaterial = new MeshBasicMaterial({
      color: COLORS.hover,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const plane = new PlaneGeometry(1 - INSET * 2, 1 - INSET * 2);
    plane.rotateX(-Math.PI / 2);
    this.fill = new Mesh(plane, this.fillMaterial);
    this.fill.position.set(0.5, 0, 0.5);

    this.lineMaterial = new LineBasicMaterial({
      color: COLORS.hover,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const a = INSET;
    const b = 1 - INSET;
    const outlineGeometry = new BufferGeometry();
    outlineGeometry.setAttribute(
      'position',
      new Float32BufferAttribute([a, 0, a, b, 0, a, b, 0, b, a, 0, b], 3),
    );
    this.outline = new LineLoop(outlineGeometry, this.lineMaterial);

    this.object.add(this.fill, this.outline);
  }

  /** Shows the highlight on tile (x, z), or hides it when index is -1. */
  setTile(index: number, x: number, z: number): void {
    if (index < 0) {
      this.object.visible = false;
      return;
    }
    this.setArea(x, z, 1, 1);
  }

  /** Shows the highlight over the w×h tiles starting at tile (x, z). */
  setArea(x: number, z: number, w: number, h: number): void {
    const { grid } = this.world;
    const hx = Math.min(grid.width - 1, Math.max(0, x));
    const hz = Math.min(grid.height - 1, Math.max(0, z));
    this.object.visible = true;
    this.object.position.set(x, this.world.tileHeight(hx, hz) + LIFT, z);
    this.object.scale.set(w, 1, h);
  }

  dispose(): void {
    this.fill.geometry.dispose();
    this.outline.geometry.dispose();
    this.fillMaterial.dispose();
    this.lineMaterial.dispose();
  }
}
