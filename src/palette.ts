import builtin from "./data/palettes.json";

export const BACKGROUND_ROLES = ["bg1", "bg2", "bg3", "ink"] as const;
export const OBJECT_ROLES = ["obj1", "obj2", "obj3", "paper"] as const;
type BgRole = (typeof BACKGROUND_ROLES)[number];
type ObjRole = (typeof OBJECT_ROLES)[number];

export interface Palette {
  id: string;
  name: string;
  background: Record<BgRole, string>;
  objects: Record<ObjRole, string>;
}

export const PALETTES: Palette[] = builtin.palettes as Palette[];

export function normalizeColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (v === "white") return "#ffffff";
  if (v === "black") return "#000000";
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) return "#" + [...m[1]].map((c) => c + c).join("");
  m = v.match(/^#([0-9a-f]{6})$/);
  if (m) return v;
  m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return "#" + m.slice(1, 4).map((n) => (+n).toString(16).padStart(2, "0")).join("");
  return null;
}

function roleColors(p: Palette): Record<string, string> {
  return { ...p.background, ...p.objects };
}

// Map every colour of the source palette to the colour of the same role in the target palette.
export function colorMap(source: Palette, target: Palette): Map<string, string> {
  const src = roleColors(source);
  const dst = roleColors(target);
  const map = new Map<string, string>();
  for (const role of Object.keys(src)) {
    map.set(normalizeColor(src[role])!, dst[role]);
  }
  return map;
}

// Only fill and stroke values change; path geometry and element order stay untouched.
export function recolor(body: string, map: Map<string, string>): string {
  return body.replace(/(fill|stroke)="([^"]+)"/g, (whole, attr: string, value: string) => {
    const key = normalizeColor(value);
    const next = key && map.get(key);
    return next ? `${attr}="${next}"` : whole;
  });
}

export function colorsIn(body: string): Set<string> {
  const out = new Set<string>();
  for (const m of body.matchAll(/(?:fill|stroke)="([^"]+)"/g)) {
    const c = normalizeColor(m[1]);
    if (c) out.add(c);
  }
  return out;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

// Validates a user-supplied palette file; returns the palettes or throws a readable error.
export function parsePaletteFile(text: string): Palette[] {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : Array.isArray(data.palettes) ? data.palettes : [data];
  return list.map((p: Partial<Palette>, i: number) => {
    const where = `палитра ${i + 1}`;
    if (!p.id || !p.name) throw new Error(`${where}: нужны поля id и name`);
    for (const role of BACKGROUND_ROLES) {
      if (!HEX.test(p.background?.[role] ?? "")) throw new Error(`${where}: background.${role} должен быть #RRGGBB`);
    }
    for (const role of OBJECT_ROLES) {
      if (!HEX.test(p.objects?.[role] ?? "")) throw new Error(`${where}: objects.${role} должен быть #RRGGBB`);
    }
    return p as Palette;
  });
}
