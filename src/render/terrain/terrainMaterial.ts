/**
 * Terrain material: flat-shaded Lambert with vertex colours plus an optional tile grid
 * overlay drawn in the fragment shader. Lines are anti-aliased with screen-space
 * derivatives (≈1 px wide at any zoom) and fade out when tiles get smaller than a few
 * pixels, which avoids moiré when zoomed far out. Toggling the grid only changes a
 * uniform, so it never triggers a shader recompile.
 */

import { MeshLambertMaterial } from 'three';

export interface TerrainMaterial {
  material: MeshLambertMaterial;
  setGridOpacity(opacity: number): void;
}

/** How strongly grid lines darken the ground at full opacity. */
const GRID_STRENGTH = 0.22;

export function createTerrainMaterial(): TerrainMaterial {
  const uniforms = {
    uGridOpacity: { value: 1 },
  };

  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGridOpacity = uniforms.uGridOpacity;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWorld;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vTerrainWorld;\nuniform float uGridOpacity;',
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          vec2 coord = vTerrainWorld.xz;
          vec2 fw = max(fwidth(coord), vec2(1e-5));
          // Distance to the nearest integer grid line, in pixels.
          vec2 lineDist = abs(fract(coord + 0.5) - 0.5) / fw;
          float line = 1.0 - min(min(lineDist.x, lineDist.y), 1.0);
          // Fade out once a tile covers fewer than ~4 pixels.
          float fade = 1.0 - smoothstep(0.12, 0.3, max(fw.x, fw.y));
          diffuseColor.rgb *= 1.0 - uGridOpacity * ${GRID_STRENGTH.toFixed(3)} * line * fade;
        }`,
      );
  };
  // All terrain chunks share this material; give it a stable, distinct program key.
  material.customProgramCacheKey = () => 'slopcity-terrain-grid-v1';

  return {
    material,
    setGridOpacity(opacity: number) {
      uniforms.uGridOpacity.value = opacity;
    },
  };
}
