/**
 * Accumulates flat-shaded, vertex-coloured triangles for procedural low-poly geometry
 * (roads now, buildings later) and turns them into a non-indexed BufferGeometry.
 * All shapes are axis-aligned, which covers everything tile-based.
 *
 * Every vertex also carries a `surface` id (attribute `aSurface`) that materials can use
 * to pick a procedural pattern (e.g. sidewalk slabs); 0 means plain vertex colour.
 */

import { BufferAttribute, BufferGeometry, Color } from 'three';

export interface BuilderTint {
  color: Color;
  /** 0 = original colours, 1 = fully the tint colour. */
  amount: number;
}

const tmp = new Color();

export class GeometryBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private surfaces: number[] = [];
  /** Optional tint applied to every colour as it's written (used by ghost previews). */
  tint: BuilderTint | null = null;

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  clear(): void {
    this.positions.length = 0;
    this.normals.length = 0;
    this.colors.length = 0;
    this.surfaces.length = 0;
  }

  /** Horizontal rectangle at height `y`, facing up. */
  quadUp(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y: number,
    color: Color,
    surface = 0,
  ): void {
    // CCW seen from above: (x0,z0) → (x0,z1) → (x1,z1), (x0,z0) → (x1,z1) → (x1,z0).
    this.tri(x0, y, z0, x0, y, z1, x1, y, z1, 0, 1, 0, color, surface);
    this.tri(x0, y, z0, x1, y, z1, x1, y, z0, 0, 1, 0, color, surface);
  }

  /**
   * Axis-aligned box from y0 to y1: top and four sides (no bottom; it sits on the ground).
   * `topSurface` tags the top face only; sides are always plain.
   */
  box(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y0: number,
    y1: number,
    color: Color,
    topSurface = 0,
  ): void {
    this.quadUp(x0, z0, x1, z1, y1, color, topSurface);
    // North side (z = z0) faces -z.
    this.tri(x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, color);
    this.tri(x0, y0, z0, x1, y1, z0, x1, y0, z0, 0, 0, -1, color);
    // South side (z = z1) faces +z.
    this.tri(x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, color);
    this.tri(x1, y0, z1, x0, y1, z1, x0, y0, z1, 0, 0, 1, color);
    // West side (x = x0) faces -x.
    this.tri(x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, color);
    this.tri(x0, y0, z1, x0, y1, z0, x0, y0, z0, -1, 0, 0, color);
    // East side (x = x1) faces +x.
    this.tri(x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, color);
    this.tri(x1, y0, z0, x1, y1, z1, x1, y0, z1, 1, 0, 0, color);
  }

  /** Builds a new BufferGeometry from the accumulated triangles. */
  toGeometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    geometry.setAttribute('aSurface', new BufferAttribute(new Float32Array(this.surfaces), 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }

  private tri(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    nx: number,
    ny: number,
    nz: number,
    color: Color,
    surface = 0,
  ): void {
    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    const c = this.tint ? tmp.copy(color).lerp(this.tint.color, this.tint.amount) : color;
    this.colors.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
    this.surfaces.push(surface, surface, surface);
  }
}
