/**
 * Accumulates flat-shaded, vertex-coloured triangles for procedural low-poly geometry
 * (roads now, buildings later) and turns them into a non-indexed BufferGeometry.
 * All shapes are axis-aligned, which covers everything tile-based.
 *
 * Every vertex also carries a `surface` id (attribute `aSurface`) that materials can use
 * to pick a procedural pattern (e.g. sidewalk slabs); 0 means plain vertex colour.
 *
 * Vertices go straight into growable typed arrays (capacity doubles when full) that are
 * reused across builds, so a road block rebuild doesn't push hundreds of thousands of
 * numbers through plain arrays.
 */

import { Box3, BufferAttribute, BufferGeometry, Color, Sphere } from 'three';

export interface BuilderTint {
  color: Color;
  /** 0 = original colours, 1 = fully the tint colour. */
  amount: number;
}

const tmp = new Color();
/** `box()` wall mask with every side (N | E | S | W, as DIR_BIT). */
export const BOX_ALL_WALLS = 15;
/** Initial capacity in vertices (a few street tiles); grows by doubling. */
const INITIAL_VERTICES = 1024;

export class GeometryBuilder {
  private positions = new Float32Array(INITIAL_VERTICES * 3);
  private normals = new Float32Array(INITIAL_VERTICES * 3);
  private colors = new Float32Array(INITIAL_VERTICES * 3);
  private surfaces = new Float32Array(INITIAL_VERTICES);
  private count = 0;
  /** Optional tint applied to every colour as it's written (used by ghost previews). */
  tint: BuilderTint | null = null;

  get vertexCount(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
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
   * Axis-aligned box from y0 to y1: top and the sides in `walls` (no bottom; it sits on
   * the ground). `walls` is a mask with the DIR_BIT layout (N = z0, E = x1, S = z1,
   * W = x0), so callers can skip sides hidden against a neighbour of the same height.
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
    walls = BOX_ALL_WALLS,
  ): void {
    this.quadUp(x0, z0, x1, z1, y1, color, topSurface);
    if (walls & 1) {
      // North side (z = z0) faces -z.
      this.tri(x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, 0, -1, color);
      this.tri(x0, y0, z0, x1, y1, z0, x1, y0, z0, 0, 0, -1, color);
    }
    if (walls & 4) {
      // South side (z = z1) faces +z.
      this.tri(x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, 0, 1, color);
      this.tri(x1, y0, z1, x0, y1, z1, x0, y0, z1, 0, 0, 1, color);
    }
    if (walls & 8) {
      // West side (x = x0) faces -x.
      this.tri(x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0, color);
      this.tri(x0, y0, z1, x0, y1, z0, x0, y0, z0, -1, 0, 0, color);
    }
    if (walls & 2) {
      // East side (x = x1) faces +x.
      this.tri(x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0, color);
      this.tri(x1, y0, z0, x1, y1, z1, x1, y0, z1, 1, 0, 0, color);
    }
  }

  /** Horizontal triangle at height `y`, facing up whatever the order of its corners. */
  triUp(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    y: number,
    color: Color,
    surface = 0,
  ): void {
    // Seen from above (+y), counter-clockwise means (b - a) × (c - a) has a positive y.
    const cross = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (cross >= 0) this.tri(ax, y, az, bx, y, bz, cx, y, cz, 0, 1, 0, color, surface);
    else this.tri(ax, y, az, cx, y, cz, bx, y, bz, 0, 1, 0, color, surface);
  }

  /**
   * Vertical quad from y0 to y1 along the segment a → b, facing the left-hand side of the
   * segment seen from above (walking east, it faces north).
   */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, color: Color): void {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len === 0) return;
    const nx = dz / len;
    const nz = -dx / len;
    this.tri(ax, y0, az, ax, y1, az, bx, y1, bz, nx, 0, nz, color);
    this.tri(ax, y0, az, bx, y1, bz, bx, y0, bz, nx, 0, nz, color);
  }

  /** Builds a new BufferGeometry from the accumulated triangles. */
  toGeometry(): BufferGeometry {
    const n = this.count;
    const positions = this.positions.slice(0, n * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(this.normals.slice(0, n * 3), 3));
    geometry.setAttribute('color', new BufferAttribute(this.colors.slice(0, n * 3), 3));
    geometry.setAttribute('aSurface', new BufferAttribute(this.surfaces.slice(0, n), 1));
    // Same bounds as computeBoundingBox/Sphere, from tight loops over the typed array
    // (three reads every vertex through the attribute accessors, three passes).
    const box = (geometry.boundingBox = new Box3());
    const sphere = (geometry.boundingSphere = new Sphere());
    if (n > 0) computeBounds(positions, box, sphere);
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
    if (this.count + 3 > this.surfaces.length) this.grow();
    const v = this.count;
    this.count = v + 3;
    const p = this.positions;
    const o = v * 3;
    p[o] = ax;
    p[o + 1] = ay;
    p[o + 2] = az;
    p[o + 3] = bx;
    p[o + 4] = by;
    p[o + 5] = bz;
    p[o + 6] = cx;
    p[o + 7] = cy;
    p[o + 8] = cz;
    const nrm = this.normals;
    const col = this.colors;
    const c = this.tint ? tmp.copy(color).lerp(this.tint.color, this.tint.amount) : color;
    for (let k = o; k < o + 9; k += 3) {
      nrm[k] = nx;
      nrm[k + 1] = ny;
      nrm[k + 2] = nz;
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
    const srf = this.surfaces;
    srf[v] = surface;
    srf[v + 1] = surface;
    srf[v + 2] = surface;
  }

  /** Doubles the capacity, keeping what's been written. */
  private grow(): void {
    const cap = this.surfaces.length * 2;
    this.positions = growTo(this.positions, cap * 3);
    this.normals = growTo(this.normals, cap * 3);
    this.colors = growTo(this.colors, cap * 3);
    this.surfaces = growTo(this.surfaces, cap);
  }
}

function growTo(a: Float32Array, length: number): Float32Array<ArrayBuffer> {
  const b = new Float32Array(length);
  b.set(a);
  return b;
}

/** Bounding box of the xyz triples, and the sphere around its centre enclosing them all. */
function computeBounds(p: Float32Array, box: Box3, sphere: Sphere): void {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let k = 0; k < p.length; k += 3) {
    const x = p[k];
    const y = p[k + 1];
    const z = p[k + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  box.min.set(minX, minY, minZ);
  box.max.set(maxX, maxY, maxZ);
  const c = box.getCenter(sphere.center);
  let r2 = 0;
  for (let k = 0; k < p.length; k += 3) {
    const dx = p[k] - c.x;
    const dy = p[k + 1] - c.y;
    const dz = p[k + 2] - c.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) r2 = d2;
  }
  sphere.radius = Math.sqrt(r2);
}
