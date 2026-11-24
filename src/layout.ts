import { META, UNIT_SCALE, type Library, type Variant } from "./library";
import { CANVAS, newLayer, type Layer, type Scene } from "./scene";

export type TemplateId = "headline" | "offset" | "assembled";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Areas the object group is fitted into. Taken from the six "SVG-drop" frames of the Figma file:
// "Под заголовок" keeps the left half free for a headline, "Со смещением" shifts the group
// off-centre, "Собранно" uses the whole canvas.
export const TEMPLATES: Record<TemplateId, { name: string; area: Box; maxScale: number }> = {
  headline: { name: "Под заголовок", area: { x: 540, y: 90, w: 620, h: 450 }, maxScale: 0.9 },
  offset: { name: "Со смещением", area: { x: 300, y: 50, w: 860, h: 530 }, maxScale: 1 },
  assembled: { name: "Собранно", area: { x: 40, y: 40, w: 1120, h: 550 }, maxScale: 1.1 },
};

export interface Pick {
  objectId: string;
  variant: Variant;
}

// Small deterministic PRNG: the same input and seed always give the same picture.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}

const BG_SCALE = 0.8; // background objects stay smaller than the main ones
const RISE = 0.28; // each next object stands further back: its base is higher, like an isometric floor
const GAP = 12;

// Places objects in one or two rows along an isometric diagonal, then fits the
// whole group into the template area. Bounding boxes never overlap.
export function compose(picks: Pick[], template: TemplateId, scene: Scene, lib: Library, seed = 0): Layer[] {
  if (picks.length === 0) return [];
  const rand = rng(seed);
  const order = [...picks];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const unit = UNIT_SCALE[scene.size];
  const rowSize = order.length > 4 ? Math.ceil(order.length / 2) : order.length;
  const placed: { pick: Pick; box: Box; scale: number }[] = [];
  for (let start = 0; start < order.length; start += rowSize) {
    const row = order.slice(start, start + rowSize);
    let x = start === 0 ? 0 : 120; // back row starts shifted right
    const rowItems = row.map((pick) => {
      const art = lib.objects[pick.objectId][pick.variant];
      const scale = META[pick.objectId].scale * (pick.variant === "bg" ? BG_SCALE : 1);
      const w = art.width * unit * scale;
      const h = art.height * unit * scale;
      const base = -RISE * (x + w / 2); // y of the object's bottom edge
      const box = { x, y: base - h, w, h };
      x += w + GAP;
      return { pick, box, scale };
    });
    // The back row (drawn second) sits above the front row.
    if (start > 0) {
      const lowest = Math.max(...rowItems.map((it) => it.box.y + it.box.h));
      const top = Math.min(...placed.map((p) => p.box.y));
      // tuck the back row partly behind the front one, as objects stand on one table
      const frontHeight = placed.reduce((sum, p) => sum + p.box.h, 0) / placed.length;
      const shift = top - lowest + 0.45 * frontHeight;
      rowItems.forEach((it) => (it.box.y += shift));
    }
    placed.push(...rowItems);
  }

  const minX = Math.min(...placed.map((p) => p.box.x));
  const maxX = Math.max(...placed.map((p) => p.box.x + p.box.w));
  const minY = Math.min(...placed.map((p) => p.box.y));
  const maxY = Math.max(...placed.map((p) => p.box.y + p.box.h));
  const { area, maxScale } = TEMPLATES[template];
  const fit = Math.min(maxScale, area.w / (maxX - minX), area.h / (maxY - minY));
  const offX = area.x + (area.w - (maxX - minX) * fit) / 2;
  const offY = area.y + (area.h - (maxY - minY) * fit) / 2;

  const layers = placed.map(({ pick, box, scale }) =>
    newLayer({
      objectId: pick.objectId,
      variant: pick.variant,
      x: offX + (box.x - minX + box.w / 2) * fit,
      y: offY + (box.y - minY + box.h / 2) * fit,
      scale: scale * fit,
      rotation: 0,
    }),
  );
  // Back row and background objects go to the bottom of the layer stack.
  const depth = (l: Layer) => (l.variant === "bg" ? 0 : 1) * 10000 + l.y;
  return layers.sort((a, b) => depth(a) - depth(b));
}

export function canvasBox(layer: Layer, lib: Library, size: Scene["size"]): Box {
  const art = lib.objects[layer.objectId][layer.variant];
  const s = layer.scale * UNIT_SCALE[size];
  const w = art.width * s;
  const h = art.height * s;
  return { x: layer.x - w / 2, y: layer.y - h / 2, w, h };
}

export const insideCanvas = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= CANVAS.width && b.y + b.h <= CANVAS.height;
