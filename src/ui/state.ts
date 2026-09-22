/**
 * Reactive HUD state. The game loop writes these signals only when a value actually
 * changes (or at a throttled rate for stats), so Preact re-renders stay rare and never
 * sit in the per-frame hot path.
 */

import { signal } from '@preact/signals';
import { TIME_OF_DAY } from '../config';

export interface HoverTile {
  x: number;
  z: number;
}

export const hud = {
  fps: signal(0),
  frameMs: signal(0),
  drawCalls: signal(0),
  triangles: signal(0),
  hoverTile: signal<HoverTile | null>(null),
  /** Camera heading in degrees, 0 = looking north (-z). */
  headingDeg: signal(0),
  /** Camera distance in world units, for the zoom readout. */
  zoomDistance: signal(0),
  gridVisible: signal(true),
  /** Time of day in hours; drives the sun. Later phases will drive it from the sim clock. */
  timeOfDay: signal<number>(TIME_OF_DAY.default),
  helpVisible: signal(true),
  /** Display labels for physical key codes on the user's keyboard layout. */
  keyLabels: signal<Record<string, string>>({}),
};
