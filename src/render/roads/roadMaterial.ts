/**
 * Road material: flat-shaded Lambert with vertex colours, plus procedural surface
 * patterns selected by the `aSurface` vertex attribute (see ROAD_SURFACE):
 *
 *  - Sidewalk: long concrete slabs across the full sidewalk width, separated by thin
 *    grooves (American style), with a slight tone variation per slab. On curved
 *    sidewalks the grooves are radial, pointing at the point the curve bends around.
 *  - Verge: mottled grass from two octaves of value noise.
 *
 * Patterns are computed from world position, so they line up seamlessly across tiles,
 * and they fade out with screen-space derivatives when zoomed far out to avoid moiré.
 */

import { MeshLambertMaterial } from 'three';
import { ROAD_ARC_SLABS, ROAD_SURFACE } from './roadStyle';

/** Slab length along the sidewalk in tile units (8 slabs per tile ≈ 2 m each). */
const SLAB_LENGTH = 0.125;

export interface RoadMaterialOptions {
  /** Pull the surface toward the camera in the depth test (for ghost previews). */
  polygonOffset?: boolean;
}

export function createRoadMaterial(opts: RoadMaterialOptions = {}): MeshLambertMaterial {
  const material = new MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    polygonOffset: opts.polygonOffset ?? false,
    polygonOffsetFactor: opts.polygonOffset ? -1 : 0,
    polygonOffsetUnits: opts.polygonOffset ? -4 : 0,
  });

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aSurface;
        varying float vSurface;
        varying vec3 vRoadWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSurface = aSurface;
        vRoadWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying float vSurface;
        varying vec3 vRoadWorld;

        float roadHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float roadNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = roadHash(i);
          float b = roadHash(i + vec2(1.0, 0.0));
          float c = roadHash(i + vec2(0.0, 1.0));
          float d = roadHash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        if (vSurface > 0.5) {
          vec2 p = vRoadWorld.xz;
          if (vSurface < ${(ROAD_SURFACE.Verge - 0.5).toFixed(1)} ||
              vSurface > ${(ROAD_SURFACE.Verge + 0.5).toFixed(1)}) {
            // Sidewalk slabs. 'along' runs with the sidewalk, 'across' spans its width.
            float along;
            float across;
            if (vSurface < ${(ROAD_SURFACE.Verge - 0.5).toFixed(1)}) {
              bool alongX = vSurface < ${(ROAD_SURFACE.SidewalkAlongZ - 0.5).toFixed(1)};
              along = (alongX ? p.x : p.y) / ${SLAB_LENGTH.toFixed(4)};
              across = alongX ? p.y : p.x;
            } else {
              // Curved sidewalk: polar coordinates around the point it bends around.
              float id = floor(vSurface + 0.5);
              vec2 center;
              float slabs;
              if (id > ${(ROAD_SURFACE.SidewalkAvenueArc - 0.5).toFixed(1)}) {
                // Avenue curve: the centre's offset from the tile origin is in the id.
                float k = id - ${ROAD_SURFACE.SidewalkAvenueArc.toFixed(1)};
                center = floor(p) + vec2(mod(k, 4.0), floor(k / 4.0)) - 1.0;
                slabs = ${ROAD_ARC_SLABS.avenue.toFixed(1)};
              } else {
                bool pad = id > ${(ROAD_SURFACE.SidewalkPad - 0.5).toFixed(1)};
                float corner = id - (pad ? ${ROAD_SURFACE.SidewalkPad.toFixed(1)} : ${ROAD_SURFACE.SidewalkArc.toFixed(1)});
                center = floor(p) + vec2(
                  corner > 0.5 && corner < 2.5 ? 1.0 : 0.0,
                  corner > 1.5 ? 1.0 : 0.0);
                slabs = pad ? ${ROAD_ARC_SLABS.pad.toFixed(1)} : ${ROAD_ARC_SLABS.arc.toFixed(1)};
              }
              vec2 d = abs(p - center);
              along = atan(d.y, d.x) * slabs / ${(Math.PI / 2).toFixed(6)};
              across = length(d);
            }
            float fw = max(fwidth(along), 1e-5);
            // Distance to the nearest groove in pixels; ~1.5 px wide anti-aliased line.
            float px = abs(fract(along + 0.5) - 0.5) / fw;
            float groove = 1.0 - smoothstep(0.4, 1.4, px);
            // Hide the pattern once a slab spans only a few pixels.
            float detail = 1.0 - smoothstep(0.12, 0.3, fw);
            float tone = roadHash(vec2(floor(along), floor(across * 4.0)));
            diffuseColor.rgb *= mix(1.0, 0.95 + 0.08 * tone, detail);
            diffuseColor.rgb *= 1.0 - 0.38 * groove * detail;
          } else {
            // Grass verge: fine blades plus larger mottling.
            float fine = roadNoise(p * 90.0);
            float coarse = roadNoise(p * 14.0 + 7.3);
            float detail = 1.0 - smoothstep(0.35, 1.0, fwidth(p.x * 90.0));
            float g = mix(0.5, fine, detail) * 0.55 + coarse * 0.45;
            diffuseColor.rgb *= 0.78 + 0.42 * g;
          }
        }`,
      );
  };
  material.customProgramCacheKey = () => 'slopcity-road-v3';
  return material;
}
