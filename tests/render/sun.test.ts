import { describe, expect, it } from 'vitest';
import { MathUtils } from 'three';
import { TIME_OF_DAY } from '../../src/config';
import { computeSun, createSunState } from '../../src/render/sun';
import { formatTimeOfDay } from '../../src/ui/format';

const noon = (TIME_OF_DAY.sunrise + TIME_OF_DAY.sunset) / 2;

describe('computeSun', () => {
  it('peaks due south at solar noon', () => {
    const s = computeSun(noon, createSunState());
    expect(MathUtils.radToDeg(s.elevation)).toBeCloseTo(TIME_OF_DAY.maxElevation, 6);
    expect(s.direction.x).toBeCloseTo(0, 6);
    expect(s.direction.z).toBeGreaterThan(0); // south is +z
  });

  it('rises in the east and sets in the west, at the minimum elevation', () => {
    const rise = computeSun(TIME_OF_DAY.sunrise, createSunState());
    const set = computeSun(TIME_OF_DAY.sunset, createSunState());
    expect(rise.direction.x).toBeGreaterThan(0.9); // east is +x
    expect(set.direction.x).toBeLessThan(-0.9);
    expect(MathUtils.radToDeg(rise.elevation)).toBeCloseTo(TIME_OF_DAY.minElevation, 6);
    expect(MathUtils.radToDeg(set.elevation)).toBeCloseTo(TIME_OF_DAY.minElevation, 6);
  });

  it('always returns a unit direction above the horizon, clamped outside the day', () => {
    const s = createSunState();
    for (let h = TIME_OF_DAY.sunrise - 2; h <= TIME_OF_DAY.sunset + 2; h += 0.25) {
      computeSun(h, s);
      expect(s.direction.length()).toBeCloseTo(1, 6);
      expect(s.direction.y).toBeGreaterThan(0);
    }
  });

  it('is warmer and dimmer near the horizon than at noon', () => {
    const low = computeSun(TIME_OF_DAY.sunrise + 0.25, createSunState());
    const high = computeSun(noon, createSunState());
    expect(low.sunIntensity).toBeLessThan(high.sunIntensity);
    // Warmer = relatively less blue.
    expect(low.sunColor.b / low.sunColor.r).toBeLessThan(high.sunColor.b / high.sunColor.r);
  });
});

describe('formatTimeOfDay', () => {
  it('formats fractional hours as HH:MM', () => {
    expect(formatTimeOfDay(6)).toBe('06:00');
    expect(formatTimeOfDay(15.25)).toBe('15:15');
    expect(formatTimeOfDay(19.999)).toBe('20:00');
  });
});
