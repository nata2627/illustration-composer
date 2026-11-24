import { META, UNIT_SCALE, type Library, type Variant } from "./library";
import { CANVAS, newLayer, type Layer, type Scene } from "./scene";

export type TemplateId = "headline" | "offset" | "assembled";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Areas the object group is fitted into, measured on the six "SVG-drop" frames of the Figma
// file. "Под заголовок" keeps the left half free for a headline. "Со смещением" is the
// "Собранно" scene in reverse order: the tall object and the pen move to the left edge.
// The objects themselves are never flipped, their isometric direction stays as drawn.
export const TEMPLATES: Record<TemplateId, { name: string; area: Box; maxScale: number; mirror: boolean }> = {
  headline: { name: "Под заголовок", area: { x: 540, y: 60, w: 620, h: 510 }, maxScale: 1.15, mirror: false },
  offset: { name: "Со смещением", area: { x: 40, y: 40, w: 1120, h: 550 }, maxScale: 1.25, mirror: true },
  assembled: { name: "Собранно", area: { x: 40, y: 40, w: 1120, h: 550 }, maxScale: 1.25, mirror: false },
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

// Proportions taken from the reference frames (natural object size, "Собранно L").
const BG_SCALE = 0.8; // background objects stay smaller than the main ones
const OVERLAP = 0.08; // neighbours in a row overlap by 8% of the narrower one
const TALL_RAISE = 0.36; // a tall object (lamp) stands further back: its centre is higher by 0.36 of its height
const PEN_DROP = 0.71; // the pen lies in front: its centre is lower than the row by 0.71 of its height
const PEN_OUT = 0.1; // and sticks out past the row end by 0.1 of its width
const BACK_VISIBLE = 0.5; // half of a back row shows above the row in front of it
// Where a flat object lies on its carrier: centre of the top object in carrier-box fractions.
// Both "phone on book" and "puzzle on phone" in the frames sit at x 0.49-0.57, y 0.35-0.37.
const STACK_Y = 0.35;
const STACK_X = [0.49, 0.57];
// In the S frames the phone is not in the row but right behind the headphones, centred
// over them and touching their top edge. A flat object (height under 0.65 of width) that
// is at most 0.85 of the width of the widest object goes there when the row has 3+ objects.
const FLAT = 0.65;
const BEHIND_WIDTH = 0.85;
const BEHIND_OVERLAP = 0.015;
const CARRIERS: Record<string, string[]> = {
  book: ["phone", "puzzle", "coin"],
  folder: ["phone", "puzzle", "coin"],
  phone: ["puzzle", "coin"],
};
const FRONT = "pen";

interface Item {
  pick: Pick;
  scale: number;
  x: number; // box in group coordinates
  y: number;
  w: number;
  h: number;
}

// One position in a row: a single object, a carrier with what lies on it, or an object
// with a flat one standing right behind it.
interface Unit {
  items: Item[]; // drawing order
  anchor: Item; // the object the row is aligned by
  tall: boolean;
}

function bounds(items: Item[]): Box {
  const x = Math.min(...items.map((i) => i.x));
  const y = Math.min(...items.map((i) => i.y));
  return { x, y, w: Math.max(...items.map((i) => i.x + i.w)) - x, h: Math.max(...items.map((i) => i.y + i.h)) - y };
}

function moveUnit(u: Unit, dx: number, dy: number): void {
  for (const it of u.items) {
    it.x += dx;
    it.y += dy;
  }
}

function makeItem(pick: Pick, scene: Scene, lib: Library): Item {
  const art = lib.objects[pick.objectId][pick.variant];
  const scale = META[pick.objectId].scale * (pick.variant === "bg" ? BG_SCALE : 1);
  const unit = UNIT_SCALE[scene.size];
  return { pick, scale, x: 0, y: 0, w: art.width * unit * scale, h: art.height * unit * scale };
}

const isTall = (it: Item) => it.h > it.w * 1.1;
const single = (it: Item): Unit => ({ items: [it], anchor: it, tall: isTall(it) });

// Puts flat objects on top of a book, a folder or a phone, one per carrier, so that
// "book, phone, puzzle" becomes the stack from the reference frames. Carriers are
// visited from the largest, so a phone first lands on the book and then takes the puzzle.
function stack(items: Item[], rand: () => number): Unit[] {
  const units: Unit[] = items.map(single);
  const unitOf = new Map(units.map((u) => [u.items[0], u]));
  for (const [carrierId, fits] of Object.entries(CARRIERS)) {
    for (const carrier of items.filter((i) => i.pick.objectId === carrierId)) {
      const unit = unitOf.get(carrier)!;
      if (unit.items.at(-1) !== carrier) continue; // something already lies on it
      // the largest fitting object goes on top, so the book takes the phone, not the puzzle
      const top = items
        .filter((i) => i !== carrier && fits.includes(i.pick.objectId) && unitOf.get(i)!.items.length === 1 && i.w <= carrier.w * 0.75)
        .sort((a, b) => b.w - a.w)[0];
      if (!top) continue;
      const ax = STACK_X[Math.floor(rand() * STACK_X.length)];
      top.x = carrier.x + ax * carrier.w - top.w / 2;
      top.y = carrier.y + STACK_Y * carrier.h - top.h / 2;
      units.splice(units.indexOf(unitOf.get(top)!), 1);
      unit.items.push(top);
      unitOf.set(top, unit);
    }
  }
  return units;
}

function putBehind(units: Unit[]): void {
  if (units.length < 3) return;
  const flat = units
    .filter((u) => u.items.length === 1 && !u.tall && u.anchor.h < u.anchor.w * FLAT)
    .sort((a, b) => a.anchor.w - b.anchor.w)[0];
  if (!flat) return;
  const host = units.filter((u) => u !== flat && !u.tall).sort((a, b) => b.anchor.w - a.anchor.w)[0];
  if (!host || flat.anchor.w > host.anchor.w * BEHIND_WIDTH) return;
  const it = flat.anchor;
  it.x = host.anchor.x + host.anchor.w / 2 - it.w / 2;
  it.y = host.anchor.y - it.h * (1 - BEHIND_OVERLAP);
  host.items.unshift(it);
  units.splice(units.indexOf(flat), 1);
}

// Lays units left to right with a small overlap. Ordinary objects share one centre line,
// tall ones are raised to stand further back. Alignment goes by the anchor object, so a
// phone standing behind the headphones does not push them down.
function packRow(units: Unit[]): void {
  let right = 0;
  let prevW = 0;
  for (const u of units) {
    const b = bounds(u.items);
    const a = u.anchor;
    const left = prevW ? right - OVERLAP * Math.min(prevW, b.w) : 0;
    const cy = u.tall ? -TALL_RAISE * a.h : 0;
    moveUnit(u, left - b.x, cy - a.h / 2 - a.y);
    right = left + b.w;
    prevW = b.w;
  }
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Builds the scene the way the reference frames are built: a row of objects with
// overlapping neighbours, flat objects stacked on a book or a phone, the tall object at
// the end and further back, the pen in front. Background objects form a row behind.
// The whole group is then scaled uniformly into the template area.
export function compose(picks: Pick[], template: TemplateId, scene: Scene, lib: Library, seed = 0): Layer[] {
  if (picks.length === 0) return [];
  const rand = rng(seed);
  const { area, maxScale, mirror } = TEMPLATES[template];

  const items = shuffle(picks, rand).map((p) => makeItem(p, scene, lib));
  const main = items.filter((i) => i.pick.variant === "main");
  const bg = items.filter((i) => i.pick.variant === "bg");

  const units = stack(main, rand);
  const penUnit = units.length > 1 ? units.find((u) => u.items.length === 1 && u.items[0].pick.objectId === FRONT) : undefined;
  const rowUnits = units.filter((u) => u !== penUnit);
  // tall objects go to the far end of the row, as the lamp in every reference frame
  rowUnits.sort((a, b) => Number(a.tall) - Number(b.tall));
  putBehind(rowUnits);

  // more than four positions do not fit one row. Tall and large objects go to a back row,
  // small ones stay in front, so nothing large hides behind a coin.
  const backMain: Unit[] = [];
  if (rowUnits.length > 4) {
    const bySize = [...rowUnits].sort((a, b) => Number(b.tall) - Number(a.tall) || bounds(b.items).h - bounds(a.items).h);
    for (const u of bySize.slice(0, Math.ceil(rowUnits.length / 2))) {
      backMain.push(u);
      rowUnits.splice(rowUnits.indexOf(u), 1);
    }
    // keep the row order inside the back row: tall objects at the far end
    backMain.sort((a, b) => Number(a.tall) - Number(b.tall));
  }
  const rows: { units: Unit[]; level: number }[] = [];
  const bgUnits: Unit[] = bg.map(single);
  if (bgUnits.length) rows.push({ units: bgUnits, level: (rowUnits.length ? 1 : 0) + (backMain.length ? 1 : 0) });
  if (backMain.length) rows.push({ units: backMain, level: 1 });
  if (rowUnits.length) rows.push({ units: rowUnits, level: 0 });

  const all = [...bgUnits, ...backMain, ...rowUnits];
  for (const row of rows) packRow(row.units);
  // back rows are centred over the front row and lifted so that half of each stays visible
  const front = rows.find((r) => r.level === 0)!;
  const frontBox = bounds(front.units.flatMap((u) => u.items));
  let top = frontBox.y;
  for (const row of [...rows].filter((r) => r.level > 0).sort((a, b) => a.level - b.level)) {
    const b = bounds(row.units.flatMap((u) => u.items));
    const dx = frontBox.x + frontBox.w / 2 - (b.x + b.w / 2);
    const dy = top + BACK_VISIBLE * b.h - (b.y + b.h);
    row.units.forEach((u) => moveUnit(u, dx, dy));
    top = b.y + dy;
  }

  if (penUnit) {
    const pen = penUnit.items[0];
    pen.x = frontBox.x + frontBox.w + PEN_OUT * pen.w - pen.w;
    pen.y = PEN_DROP * pen.h - pen.h / 2;
  }

  // "Со смещением": the same scene read from the other side. Positions are mirrored,
  // the drawings are not, so every unit keeps its inner layout (phone stays on the book).
  if (mirror) {
    const units = [...all, ...(penUnit ? [penUnit] : [])];
    for (const u of units) {
      const b = bounds(u.items);
      moveUnit(u, -2 * b.x - b.w, 0);
    }
  }

  // drawing order: background row, back row, tall objects, the row, the pen on top
  const order: Item[] = [
    ...bgUnits.flatMap((u) => u.items),
    ...backMain.filter((u) => u.tall).flatMap((u) => u.items),
    ...backMain.filter((u) => !u.tall).flatMap((u) => u.items),
    ...rowUnits.filter((u) => u.tall).flatMap((u) => u.items),
    ...rowUnits.filter((u) => !u.tall).flatMap((u) => u.items),
    ...(penUnit ? penUnit.items : []),
  ];

  const g = bounds(order);
  const fit = Math.min(maxScale, area.w / g.w, area.h / g.h);
  const offX = area.x + (area.w - g.w * fit) / 2;
  const offY = area.y + (area.h - g.h * fit) / 2;
  return order.map((it) =>
    newLayer({
      objectId: it.pick.objectId,
      variant: it.pick.variant,
      x: offX + (it.x - g.x + it.w / 2) * fit,
      y: offY + (it.y - g.y + it.h / 2) * fit,
      scale: it.scale * fit,
      rotation: 0,
    }),
  );
}

export function canvasBox(layer: Layer, lib: Library, size: Scene["size"]): Box {
  const art = lib.objects[layer.objectId][layer.variant];
  const s = layer.scale * UNIT_SCALE[size];
  const w = art.width * s;
  const h = art.height * s;
  return { x: layer.x - w / 2, y: layer.y - h / 2, w, h };
}

export const insideCanvas = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= CANVAS.width && b.y + b.h <= CANVAS.height;
