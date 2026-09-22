/**
 * Resolves physical key codes (KeyboardEvent.code) to the characters printed on the
 * user's keyboard, so help text reads "Z Q S D" on AZERTY instead of "W A S D".
 * Uses the Keyboard Map API where available (Chromium) and falls back to US labels.
 */

interface KeyboardLayoutMap {
  get(code: string): string | undefined;
}

interface NavigatorKeyboard {
  getLayoutMap?: () => Promise<KeyboardLayoutMap>;
}

/** US-layout label for a code: "KeyW" → "W", "Digit1" → "1", others unchanged. */
export function fallbackKeyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

export async function resolveKeyLabels(codes: readonly string[]): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  for (const code of codes) labels[code] = fallbackKeyLabel(code);

  const keyboard = (navigator as Navigator & { keyboard?: NavigatorKeyboard }).keyboard;
  if (!keyboard?.getLayoutMap) return labels;
  try {
    const map = await keyboard.getLayoutMap();
    for (const code of codes) {
      const key = map.get(code);
      if (key) labels[code] = key.toUpperCase();
    }
  } catch {
    // Not permitted (e.g. in an iframe); keep the fallback labels.
  }
  return labels;
}
