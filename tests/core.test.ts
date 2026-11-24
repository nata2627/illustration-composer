import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Library, Size } from "../src/library";
import { META, OBJECT_IDS } from "../src/library";
import { colorMap, colorsIn, normalizeColor, parsePaletteFile, PALETTES, recolor } from "../src/palette";
import { sceneToSvg } from "../src/render";
import { addLayer, duplicateLayer, moveLayer, removeLayer, type Scene } from "../src/scene";
import { canvasBox, compose, insideCanvas, TEMPLATES, type TemplateId } from "../src/layout";
import { parseNames, pickForMetaphor } from "../src/match";

const load = (size: Size): Library => JSON.parse(readFileSync(`public/library/${size}.json`, "utf8"));
const libs = { L: load("L"), S: load("S") };
const lilac = PALETTES.find((p) => p.id === "lilac")!;
const paths = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);

describe("library", () => {
  it.each(["L", "S"] as const)("size %s has 10 objects in main and background variants", (size) => {
    expect(Object.keys(libs[size].objects).sort()).toEqual([...OBJECT_IDS].sort());
  });

  it.each(["L", "S"] as const)("every colour of size %s has a role in the source palette", (size) => {
    const known = new Set(colorMap(lilac, lilac).keys());
    for (const id of OBJECT_IDS) {
      for (const v of ["main", "bg"] as const) {
        for (const c of colorsIn(libs[size].objects[id][v].body)) expect(known, `${size} ${id} ${v} ${c}`).toContain(c);
      }
    }
  });

  it("background objects use only background colours", () => {
    const bgColors = new Set(Object.values(lilac.background).map((c) => normalizeColor(c)));
    for (const size of ["L", "S"] as const) {
      for (const id of OBJECT_IDS) {
        for (const c of colorsIn(libs[size].objects[id].bg.body)) expect(bgColors).toContain(c);
      }
    }
  });
});

describe("recolor", () => {
  it.each(PALETTES.map((p) => [p.id, p] as const))("to %s keeps paths and leaves no foreign colours", (_id, target) => {
    const own = new Set([...Object.values(target.background), ...Object.values(target.objects)].map((c) => normalizeColor(c)));
    for (const id of OBJECT_IDS) {
      const src = libs.L.objects[id].main.body;
      const out = recolor(src, colorMap(lilac, target));
      expect(paths(out)).toEqual(paths(src));
      for (const c of colorsIn(out)) expect(own).toContain(c);
    }
  });

  it("background variant in any scheme takes only that scheme's background colours", () => {
    for (const target of PALETTES) {
      const bg = new Set(Object.values(target.background).map((c) => normalizeColor(c)));
      for (const size of ["L", "S"] as const) {
        for (const id of OBJECT_IDS) {
          for (const c of colorsIn(recolor(libs[size].objects[id].bg.body, colorMap(lilac, target)))) expect(bg).toContain(c);
        }
      }
    }
  });

  it("normalizes colour notations", () => {
    expect(normalizeColor("#FDD7B9")).toBe("#fdd7b9");
    expect(normalizeColor("rgb(253, 215, 185)")).toBe("#fdd7b9");
    expect(normalizeColor("white")).toBe("#ffffff");
    expect(normalizeColor("#fff")).toBe("#ffffff");
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

  it("falls back to a default set without matches", () => {
    const r = pickForMetaphor("Квантовая хромодинамика");
    expect(r.fallback).toBe(true);
    expect(r.picks.length).toBeGreaterThan(0);
  });
});
