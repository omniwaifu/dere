export function isHexColor(value: string | undefined | null): value is string {
  if (!value) return false;
  return /^#([0-9a-fA-F]{6})$/.test(value.trim());
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function mixHex(baseHex: string, targetHex: string, ratio: number): string {
  const a = hexToRgb(baseHex);
  const b = hexToRgb(targetHex);
  const t = Math.max(0, Math.min(1, ratio));
  return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

export function darkenHex(hex: string, amount: number): string {
  return mixHex(hex, "#000000", amount);
}

export function alphaHex(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
