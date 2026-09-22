/**
 * Shared material factories. Every shadow-casting object (buildings, trees, props) should
 * get its material from here so shadow settings stay consistent.
 *
 * Why `shadowSide: FrontSide`: three.js by default renders *back* faces into the shadow
 * map. For closed shapes standing on the ground, the stored depth inside the footprint
 * is then the far wall, which the PCF filter treats as "lit" for ground right next to the
 * base, producing a thin light seam where a building meets its shadow. Front faces put
 * the occluder clearly in front of the ground; the acne that front faces would cause on
 * sunlit walls is handled by the normal-offset bias in lighting.ts.
 */

import { FrontSide, MeshLambertMaterial, type ColorRepresentation } from 'three';

/** Flat-shaded, shadow-correct material for low-poly scenery. */
export function createLowPolyMaterial(color: ColorRepresentation): MeshLambertMaterial {
  return new MeshLambertMaterial({ color, flatShading: true, shadowSide: FrontSide });
}
