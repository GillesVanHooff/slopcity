/** Display formatting helpers for the HUD. */

/** Formats fractional hours as "HH:MM" (e.g. 15.25 → "15:15"). */
export function formatTimeOfDay(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
