/**
 * Simple stylised sun model: maps a time of day to a sun direction and lighting mood.
 * Not astronomically accurate. The sun rises due east, peaks due south at the midpoint
 * between sunrise and sunset, and sets due west, with a sine-shaped elevation curve.
 * Warm, dimmer light near the horizon; neutral bright light at midday.
 */

import { Color, MathUtils, Vector3 } from 'three';
import { COLORS, TIME_OF_DAY } from '../config';

export interface SunState {
  /** Unit vector pointing *toward* the sun. */
  direction: Vector3;
  /** Elevation above the horizon in radians (never below TIME_OF_DAY.minElevation). */
  elevation: number;
  /** Compass azimuth in radians (0 = north / -z, π/2 = east / +x). */
  azimuth: number;
  sunColor: Color;
  sunIntensity: number;
  hemiIntensity: number;
  skyColor: Color;
}

export function createSunState(): SunState {
  return {
    direction: new Vector3(),
    elevation: 0,
    azimuth: 0,
    sunColor: new Color(),
    sunIntensity: 0,
    hemiIntensity: 0,
    skyColor: new Color(),
  };
}

const noonSun = new Color(COLORS.sunLight);
const lowSun = new Color(COLORS.sunLightLow);
const noonSky = new Color(COLORS.sky);
const lowSky = new Color(COLORS.skyLow);

/** Fills `out` with the sun state for `hours` (clamped to the sunrise–sunset range). */
export function computeSun(hours: number, out: SunState): SunState {
  const { sunrise, sunset } = TIME_OF_DAY;
  const t = MathUtils.clamp((hours - sunrise) / (sunset - sunrise), 0, 1);

  const maxEl = MathUtils.degToRad(TIME_OF_DAY.maxElevation);
  const minEl = MathUtils.degToRad(TIME_OF_DAY.minElevation);
  const elevation = Math.max(minEl, maxEl * Math.sin(Math.PI * t));
  const azimuth = MathUtils.degToRad(90 + 180 * t); // east → south → west

  const ce = Math.cos(elevation);
  out.direction.set(ce * Math.sin(azimuth), Math.sin(elevation), -ce * Math.cos(azimuth));
  out.elevation = elevation;
  out.azimuth = azimuth;

  // 1 when the sun is on the horizon, 0 from ~30° elevation upward.
  const low = 1 - MathUtils.smoothstep(elevation, minEl, MathUtils.degToRad(30));
  out.sunColor.copy(noonSun).lerp(lowSun, low);
  // Flat ground only receives sin(elevation) of the direct light, so a low sun leaves it
  // dim; lift the sky light to compensate and keep golden hour readable.
  out.sunIntensity = MathUtils.lerp(2.4, 2.1, low);
  out.hemiIntensity = MathUtils.lerp(1.1, 1.5, low);
  out.skyColor.copy(noonSky).lerp(lowSky, low * 0.85);
  return out;
}
