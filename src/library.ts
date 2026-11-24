import objectsMeta from "./data/objects.json";

export type Size = "L" | "S";
export type Variant = "main" | "bg";

export interface ObjectArt {
  width: number;
  height: number;
  viewBox: string;
  body: string;
}

export interface Library {
  size: Size;
  sourcePalette: string;
  objects: Record<string, Record<Variant, ObjectArt>>;
}

export interface ObjectMeta {
  name: string;
  scale: number; // relative size on the canvas, see README
  words: string[];
  meanings: Record<string, string>;
}

export const META: Record<string, ObjectMeta> = objectsMeta;
export const OBJECT_IDS = Object.keys(META);

// Source objects of size S are drawn at half the units of size L,
// so S is scaled twice as much to look the same size on the canvas.
export const UNIT_SCALE: Record<Size, number> = { L: 0.36, S: 0.72 };

const cache = new Map<Size, Promise<Library>>();

export function loadLibrary(size: Size): Promise<Library> {
  if (!cache.has(size)) {
    const url = `${import.meta.env.BASE_URL}library/${size}.json`;
    cache.set(
      size,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`library ${size}: HTTP ${r.status}`);
        return r.json() as Promise<Library>;
      }),
    );
  }
  return cache.get(size)!;
}
