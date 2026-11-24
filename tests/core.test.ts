import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Library, Size } from "../src/library";
import { META, OBJECT_IDS } from "../src/library";
import { builtinPalette, colorMap, colorsIn, normalizeColor, parsePaletteFile, PALETTES, recolor } from "../src/palette";
import { sceneToSvg } from "../src/render";
import { addLayer, duplicateLayer, moveLayer, removeLayer, type Scene } from "../src/scene";
import { canvasBox, compose, insideCanvas, rng, TEMPLATES, type TemplateId } from "../src/layout";
import { parseNames, pickForMetaphor } from "../src/match";

const load = (size: Size): Library => JSON.parse(readFileSync(`public/library/${size}.json`, "utf8"));
const libs = { L: load("L"), S: load("S") };
const lilac = PALETTES.find((p) => p.id === "lilac")!;
const paths = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);

describe("library", () => {
  it.each(["L", "S"] as const)("size %s has 10 objects in main and background variants", (size) => {
    expect(Object.keys(libs[size].objects).sort()).toEqual([...OBJECT_IDS].sort());
  });

  it.each(["L", "S"] as const)("every color of size %s has a role in the source palette", (size) => {
    const known = new Set(colorMap(lilac, lilac).keys());
    for (const id of OBJECT_IDS) {
      for (const v of ["main", "bg"] as const) {
        for (const c of colorsIn(libs[size].objects[id][v].body)) expect(known, `${size} ${id} ${v} ${c}`).toContain(c);
      }
    }
  });

  it("background objects use only background colors", () => {
    const bgColors = new Set(Object.values(lilac.background).map((c) => normalizeColor(c)));
    for (const size of ["L", "S"] as const) {
      for (const id of OBJECT_IDS) {
        for (const c of colorsIn(libs[size].objects[id].bg.body)) expect(bgColors).toContain(c);
      }
    }
  });
});

describe("recolor", () => {
  it.each(PALETTES.map((p) => [p.id, p] as const))("to %s keeps paths and leaves no foreign colors", (_id, target) => {
    const own = new Set([...Object.values(target.background), ...Object.values(target.objects)].map((c) => normalizeColor(c)));
    for (const id of OBJECT_IDS) {
      const src = libs.L.objects[id].main.body;
      const out = recolor(src, colorMap(lilac, target));
      expect(paths(out)).toEqual(paths(src));
      for (const c of colorsIn(out)) expect(own).toContain(c);
    }
  });

  it("background variant in any scheme takes only that scheme's background colors", () => {
    for (const target of PALETTES) {
      const bg = new Set(Object.values(target.background).map((c) => normalizeColor(c)));
      for (const size of ["L", "S"] as const) {
        for (const id of OBJECT_IDS) {
          for (const c of colorsIn(recolor(libs[size].objects[id].bg.body, colorMap(lilac, target)))) expect(bg).toContain(c);
        }
      }
    }
  });

  it("normalizes color notations", () => {
    expect(normalizeColor("#FDD7B9")).toBe("#fdd7b9");
    expect(normalizeColor("rgb(253, 215, 185)")).toBe("#fdd7b9");
    expect(normalizeColor("white")).toBe("#ffffff");
    expect(normalizeColor("#fff")).toBe("#ffffff");
  });

  it("recolors from the shipped source scheme even after a user palette reuses its id", () => {
    const edited = parsePaletteFile(JSON.stringify({ ...lilac, background: { ...lilac.background, bg1: "#E0D8FA" } }))[0];
    expect(builtinPalette("lilac").background.bg1).toBe(lilac.background.bg1);
    const out = colorsIn(recolor(libs.L.objects.lamp.main.body, colorMap(builtinPalette("lilac"), edited)));
    expect(out).toContain("#e0d8fa");
    expect(out).not.toContain(normalizeColor(lilac.background.bg1));
  });

  it("validates a palette file", () => {
    const ok = JSON.stringify({ ...PALETTES[0], id: "mint", name: "Мятная" });
    expect(parsePaletteFile(ok)[0].id).toBe("mint");
    expect(() => parsePaletteFile(JSON.stringify({ id: "x", name: "x", background: {} }))).toThrow(/bg1/);
  });
});

describe("scene and export", () => {
  const scene = (): Scene => ({ size: "L", paletteId: "peach", layers: [] });

  it("edits layers", () => {
    const s = scene();
    const a = addLayer(s, "book", "main");
    const b = addLayer(s, "lamp", "main");
    duplicateLayer(s, a.uid);
    expect(s.layers.map((l) => l.objectId)).toEqual(["book", "book", "lamp"]);
    moveLayer(s, b.uid, -1);
    expect(s.layers.map((l) => l.objectId)).toEqual(["book", "lamp", "book"]);
    removeLayer(s, a.uid);
    expect(s.layers).toHaveLength(2);
  });

  it("exports vector groups with original paths and unique names", () => {
    const s = scene();
    addLayer(s, "book", "main");
    addLayer(s, "book", "main");
    addLayer(s, "coin", "bg");
    const peach = PALETTES.find((p) => p.id === "peach")!;
    const svg = sceneToSvg(s, libs.L, lilac, peach);
    expect(svg).not.toMatch(/<image|foreignObject/);
    const ids = [...svg.matchAll(/<g id="([^"]+)" data-uid/g)].map((m) => m[1]);
    expect(ids).toEqual(["book-1", "book-2", "coin-bg-1"]);
    const src = [libs.L.objects.book.main, libs.L.objects.book.main, libs.L.objects.coin.bg].flatMap((a) => paths(a.body));
    expect(paths(svg)).toEqual(src);
    expect(svg).toContain(`fill="${peach.background.bg1}"`);
  });
});

describe("layout", () => {
  const cases: string[][] = [["lamp"], ["book", "headphones", "lamp"], ["book", "phone", "puzzle", "coin", "pen", "folder"]];
  it.each((Object.keys(TEMPLATES) as TemplateId[]).flatMap((t) => cases.map((c) => [t, c] as const)))(
    "%s with %j keeps objects inside the canvas, main bigger than background",
    (template, ids) => {
      for (const size of ["L", "S"] as const) {
        const s: Scene = { size, paletteId: "lilac", layers: [] };
        const picks = ids.map((objectId, i) => ({ objectId, variant: i === 1 ? ("bg" as const) : ("main" as const) }));
        const layers = compose(picks, template, s, libs[size], 7);
        expect(layers).toHaveLength(ids.length);
        for (const l of layers) expect(insideCanvas(canvasBox(l, libs[size], size)), `${size} ${l.objectId}`).toBe(true);
        // compared after removing the per-object size correction
        const rel = (l: (typeof layers)[number]) => l.scale / META[l.objectId].scale;
        const mainScale = Math.min(...layers.filter((l) => l.variant === "main").map(rel));
        for (const l of layers.filter((l) => l.variant === "bg")) expect(rel(l)).toBeLessThan(mainScale);
      }
    },
  );

  it("is deterministic for the same seed", () => {
    const s: Scene = { size: "L", paletteId: "lilac", layers: [] };
    const picks = ["book", "lamp", "pen"].map((objectId) => ({ objectId, variant: "main" as const }));
    const strip = (ls: ReturnType<typeof compose>) => ls.map(({ uid: _uid, ...rest }) => rest);
    expect(strip(compose(picks, "offset", s, libs.L, 3))).toEqual(strip(compose(picks, "offset", s, libs.L, 3)));
  });

  const sceneOf = (size: Size): Scene => ({ size, paletteId: "lilac", layers: [] });
  const mains = (...ids: string[]) => ids.map((objectId) => ({ objectId, variant: "main" as const }));
  const box = (layers: ReturnType<typeof compose>, id: string, size: Size = "L") =>
    canvasBox(layers.find((l) => l.objectId === id)!, libs[size], size);
  const index = (layers: ReturnType<typeof compose>, id: string) => layers.findIndex((l) => l.objectId === id);
  const cx = (b: { x: number; w: number }) => b.x + b.w / 2;
  const cy = (b: { y: number; h: number }) => b.y + b.h / 2;

  it.each([1, 2, 3, 4, 5])("puts the phone on the book and the puzzle on the phone (seed %i)", (seed) => {
    const layers = compose(mains("puzzle", "book", "headphones", "phone"), "assembled", sceneOf("L"), libs.L, seed);
    const book = box(layers, "book");
    const phone = box(layers, "phone");
    const puzzle = box(layers, "puzzle");
    expect(cx(phone)).toBeGreaterThan(book.x);
    expect(cx(phone)).toBeLessThan(book.x + book.w);
    expect(cy(phone)).toBeGreaterThan(book.y);
    expect(cy(phone)).toBeLessThan(book.y + book.h / 2);
    expect(cx(puzzle)).toBeGreaterThan(phone.x);
    expect(cx(puzzle)).toBeLessThan(phone.x + phone.w);
    expect(index(layers, "book")).toBeLessThan(index(layers, "phone"));
    expect(index(layers, "phone")).toBeLessThan(index(layers, "puzzle"));
  });

  it("stands a flat phone right behind the headphones, as in the S frames", () => {
    const layers = compose(mains("lamp", "headphones", "phone"), "assembled", sceneOf("S"), libs.S, 1);
    const hp = box(layers, "headphones", "S");
    const phone = box(layers, "phone", "S");
    expect(Math.abs(cx(phone) - cx(hp))).toBeLessThan(1);
    expect(phone.y + phone.h).toBeLessThanOrEqual(hp.y + 0.05 * phone.h);
    expect(index(layers, "phone")).toBeLessThan(index(layers, "headphones"));
  });

  it.each([1, 2, 3])("keeps the lamp at the back end and the pen in front (seed %i)", (seed) => {
    const picks = mains("book", "headphones", "lamp", "pen");
    const right = compose(picks, "assembled", sceneOf("L"), libs.L, seed);
    const left = compose(picks, "offset", sceneOf("L"), libs.L, seed);
    for (const [layers, lampRight] of [[right, true], [left, false]] as const) {
      const lamp = box(layers, "lamp");
      const others = ["book", "headphones"].map((id) => box(layers, id));
      for (const o of others) {
        expect(cx(lamp) > cx(o)).toBe(lampRight);
        expect(cy(lamp)).toBeLessThan(cy(o)); // further back
        expect(cy(box(layers, "pen"))).toBeGreaterThan(cy(o)); // in front
      }
      expect(layers.at(-1)!.objectId).toBe("pen");
    }
  });

  it("matches the sizes of the reference frame without extra scaling", () => {
    // "Собранно L": book 529 px wide, headphones 365, lamp 243 (Figma frame 275:635)
    const layers = compose(mains("book", "phone", "puzzle", "headphones", "lamp", "pen"), "assembled", sceneOf("L"), libs.L, 1);
    expect(box(layers, "book").w).toBeGreaterThan(529 * 0.9);
    expect(box(layers, "book").w).toBeLessThan(529 * 1.1);
    expect(box(layers, "headphones").w / box(layers, "book").w).toBeCloseTo(365 / 529, 1);
    expect(box(layers, "lamp").w / box(layers, "book").w).toBeCloseTo(243 / 529, 1);
  });

  it("keeps every random scene inside the canvas", () => {
    const rand = rng(42);
    for (let n = 0; n < 600; n++) {
      const size: Size = rand() < 0.5 ? "L" : "S";
      const count = 1 + Math.floor(rand() * 8);
      const picks = Array.from({ length: count }, () => ({
        objectId: OBJECT_IDS[Math.floor(rand() * OBJECT_IDS.length)],
        variant: rand() < 0.3 ? ("bg" as const) : ("main" as const),
      }));
      const template = (Object.keys(TEMPLATES) as TemplateId[])[n % 3];
      const layers = compose(picks, template, sceneOf(size), libs[size], n);
      expect(layers).toHaveLength(count);
      for (const l of layers) {
        expect(Number.isFinite(l.x) && Number.isFinite(l.y) && l.scale > 0).toBe(true);
        expect(insideCanvas(canvasBox(l, libs[size], size)), JSON.stringify({ n, template, picks })).toBe(true);
      }
    }
  });

  it("headline template leaves the left half free", () => {
    const s: Scene = { size: "L", paletteId: "lilac", layers: [] };
    const picks = ["book", "headphones", "lamp"].map((objectId) => ({ objectId, variant: "main" as const }));
    for (const l of compose(picks, "headline", s, libs.L, 1)) expect(canvasBox(l, libs.L, "L").x).toBeGreaterThanOrEqual(540);
  });
});

describe("scenario 2: names", () => {
  const ids = (t: string) => parseNames(t).picks.map((p) => p.objectId);
  it.each([
    ["наушники, лампа", ["headphones", "lamp"]],
    ["Наушники и лампу", ["headphones", "lamp"]],
    ["кошелёк", ["wallet"]],
    ["кашелек", ["wallet"]],
    ["книгу, телефон и пазлы", ["book", "phone", "puzzle"]],
    ["монетку с ручкой", ["coin", "pen"]],
    ["вазу с тюльпанами", ["vase"]],
    ["лампа и лампа", ["lamp", "lamp"]],
  ])("%s", (text, expected) => expect(ids(text)).toEqual(expected));

  it("marks background objects", () => {
    expect(parseNames("лампа и фоновая папка").picks).toEqual([
      { objectId: "lamp", variant: "main" },
      { objectId: "folder", variant: "bg" },
    ]);
  });

  it("reports unknown words", () => expect(parseNames("лампа, слон").unknown).toEqual(["слон"]));
});

describe("scenario 1: metaphor", () => {
  const headlines: { text: string; expect: string[] }[] = JSON.parse(readFileSync("tests/fixtures/headlines.json", "utf8"));
  it.each(headlines.map((h) => [h.text, h.expect] as const))("%s", (text, expected) => {
    const r = pickForMetaphor(text);
    expect(r.fallback).toBe(false);
    const main = r.picks.filter((p) => p.variant === "main").map((p) => p.objectId);
    for (const id of expected) expect(main).toContain(id);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it.each([
    ["Ваша зарплата выросла", "vase"],
    ["Папа и дочь читают вместе", "folder"],
  ])("does not take an ordinary word for an object name: %s", (text, wrong) => {
    const r = pickForMetaphor(text);
    expect(r.picks.map((p) => p.objectId)).not.toContain(wrong);
    expect(r.reasons.filter((x) => x.meaning === "названо прямо")).toEqual([]);
  });

  it("falls back to a default set without matches", () => {
    const r = pickForMetaphor("Квантовая хромодинамика");
    expect(r.fallback).toBe(true);
    expect(r.picks.length).toBeGreaterThan(0);
  });
});
