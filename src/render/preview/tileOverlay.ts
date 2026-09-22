/**
 * Translucent coloured tile markers for tool previews (e.g. the bulldozer's selection):
 * one faint rectangle for the whole area plus instanced per-tile markers.
 */

import {
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
} from 'three';
import type { Grid } from '../../core/grid';

/** Height above the ground: above sidewalks so markers stay visible on roads. */
const LIFT = 0.08;
const INITIAL_CAPACITY = 256;

const matrix = new Matrix4();

export class TileOverlay {
  readonly object = new Object3D();

  private readonly grid: Grid;
  private readonly geometry: PlaneGeometry;
  private readonly areaMaterial: MeshBasicMaterial;
  private readonly tileMaterial: MeshBasicMaterial;
  private readonly area: Mesh;
  private tiles: InstancedMesh;

  constructor(grid: Grid, color: number) {
    this.grid = grid;
    this.object.name = 'tile-overlay';
    this.object.visible = false;
    this.geometry = new PlaneGeometry(1, 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.geometry.translate(0.5, 0, 0.5);

    const common = {
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    };
    this.areaMaterial = new MeshBasicMaterial({ ...common, color, opacity: 0.12 });
    this.tileMaterial = new MeshBasicMaterial({ ...common, color, opacity: 0.45 });
    this.area = new Mesh(this.geometry, this.areaMaterial);
    this.area.renderOrder = 9;
    this.tiles = this.createInstances(INITIAL_CAPACITY);
    this.object.add(this.area);
  }

  /**
   * Shows a faint rectangle over tiles (x0..x1, z0..z1 inclusive) and strong markers on
   * the listed tiles.
   */
  show(x0: number, z0: number, x1: number, z1: number, marked: readonly number[]): void {
    this.area.position.set(Math.min(x0, x1), LIFT, Math.min(z0, z1));
    this.area.scale.set(Math.abs(x1 - x0) + 1, 1, Math.abs(z1 - z0) + 1);

    const capacity = this.tiles.instanceMatrix.count;
    if (marked.length > capacity) {
      this.object.remove(this.tiles);
      this.tiles.dispose();
      this.tiles = this.createInstances(Math.max(marked.length, capacity * 2));
    }
    for (let k = 0; k < marked.length; k++) {
      const i = marked[k];
      matrix.makeTranslation(this.grid.x(i), LIFT + 0.001, this.grid.z(i));
      this.tiles.setMatrixAt(k, matrix);
    }
    this.tiles.count = marked.length;
    this.tiles.instanceMatrix.needsUpdate = true;
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.tiles.dispose();
    this.geometry.dispose();
    this.areaMaterial.dispose();
    this.tileMaterial.dispose();
  }

  private createInstances(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.tileMaterial, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    this.object.add(mesh);
    return mesh;
  }
}
