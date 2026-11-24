// Renders the example compositions in examples/ with the same code the web page uses.
// Each example is also reproducible in the browser with the link printed next to it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Library, Size } from "../src/library";
import { compose, hashString, type Pick, type TemplateId } from "../src/layout";
import { parseNames, pickForMetaphor } from "../src/match";
import { PALETTES } from "../src/palette";
import { sceneToSvg } from "../src/render";
import type { Scene } from "../src/scene";

interface Example {
  file: string;
  mode: "metaphor" | "names";
  q: string;
  tpl: TemplateId;
  palette: string;
  size: Size;
}

const EXAMPLES: Example[] = [
  { file: "01-podcast-finance-peach-L.svg", mode: "metaphor", q: "Идеи для подкаста о личных финансах", tpl: "headline", palette: "peach", size: "L" },
  { file: "02-names-teal-S.svg", mode: "names", q: "телефон, фоновые наушники и лампа", tpl: "assembled", palette: "teal", size: "S" },
  { file: "03-teamwork-lilac-L.svg", mode: "metaphor", q: "Командная работа над проектом и договор с банком", tpl: "offset", palette: "lilac", size: "L" },
];

const lilac = PALETTES.find((p) => p.id === "lilac")!;
mkdirSync("examples", { recursive: true });
for (const ex of EXAMPLES) {
  const lib: Library = JSON.parse(readFileSync(`public/library/${ex.size}.json`, "utf8"));
  const picks: Pick[] = ex.mode === "names" ? parseNames(ex.q).picks : pickForMetaphor(ex.q).picks;
  const scene: Scene = { size: ex.size, paletteId: ex.palette, layers: [] };
  scene.layers = compose(picks, ex.tpl, scene, lib, hashString(ex.q));
  const target = PALETTES.find((p) => p.id === ex.palette)!;
  const svg = sceneToSvg(scene, lib, lilac, target).replace(/ data-uid="\d+"/g, "");
  writeFileSync(`examples/${ex.file}`, svg);
  const params = new URLSearchParams({ mode: ex.mode, q: ex.q, tpl: ex.tpl, palette: ex.palette, size: ex.size });
  console.log(`${ex.file}  ${scene.layers.length} layers  ?${params}`);
}
