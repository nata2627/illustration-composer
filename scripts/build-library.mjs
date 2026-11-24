// Builds public/library/{L,S}.json from the Figma export in assets/figma.
// Each object keeps its original <path> elements; only Figma's layer ids are dropped
// so that two copies of one object can live in the same document.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SVG_DIR = join(ROOT, "assets/figma/svg");
const OUT_DIR = join(ROOT, "public/library");

// Figma node ids of the 20 objects on the frames "Размер L" and "Размер S".
// Unnamed groups ("Group 2136136344" etc.) were identified by their position on the frame.
const NODES = {
  L: {
    book: ["21:29965", "24:6273"],
    phone: ["21:25472", "24:6327"],
    puzzle: ["21:417", "24:6214"],
    coin: ["24:2207", "24:6795"],
    headphones: ["23:122", "24:6484"],
    lamp: ["23:121", "24:6569"],
    vase: ["28:11628", "30:11902"],
    wallet: ["23:211", "24:6660"],
    folder: ["24:1899", "24:6772"],
    pen: ["24:1734", "24:6747"],
  },
  S: {
    book: ["24:3810", "24:6934"],
    phone: ["24:4746", "24:6990"],
    puzzle: ["24:4903", "24:7147"],
    coin: ["24:5345", "24:7205"],
    headphones: ["24:5089", "24:7344"],
    lamp: ["24:5485", "24:7429"],
    vase: ["28:11629", "28:11766"],
    wallet: ["24:4594", "24:7568"],
    folder: ["24:4430", "24:7520"],
    pen: ["24:4287", "24:7543"],
  },
};

// In size L a small white patch of the book lies next to the group instead of inside it
// (in size S it is inside). It is put back as the first path, as in the Figma layer order.
const LOOSE = { "21:29965": "21:29952", "24:6273": "24:6272" };

const files = readdirSync(SVG_DIR);
const fileFor = (nodeId) => {
  const suffix = `__${nodeId.replace(":", "-")}.svg`;
  const f = files.find((n) => n.endsWith(suffix));
  if (!f) throw new Error(`no svg for node ${nodeId}`);
  return readFileSync(join(SVG_DIR, f), "utf8");
};

let figmaNodes = null;
function figmaNode(id) {
  if (!figmaNodes) {
    figmaNodes = new Map();
    const walk = (n) => {
      figmaNodes.set(n.id, n);
      (n.children || []).forEach(walk);
    };
    walk(JSON.parse(readFileSync(join(ROOT, "assets/figma/file.json"), "utf8")).document);
  }
  return figmaNodes.get(id);
}

function loosePath(groupId) {
  const group = figmaNode(groupId).absoluteBoundingBox;
  const node = figmaNode(LOOSE[groupId]);
  const b = node.absoluteBoundingBox;
  const c = node.fills[0].color;
  const hex = "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
  const fill = hex === "#FFFFFF" ? "white" : hex;
  const dx = +(b.x - group.x).toFixed(3);
  const dy = +(b.y - group.y).toFixed(3);
  return `<path transform="translate(${dx} ${dy})" d="${node.fillGeometry[0].path}" fill="${fill}"/>`;
}

function parse(svg, nodeId) {
  const head = svg.match(/<svg width="([\d.]+)" height="([\d.]+)" viewBox="([^"]+)"/);
  if (!head) throw new Error(`unexpected svg header for ${nodeId}`);
  let body = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/ id="[^"]*"/g, "")
    .trim();
  if (/<(image|use|defs|clipPath|mask|filter|linearGradient|radialGradient)\b|url\(#/.test(body)) {
    throw new Error(`object ${nodeId} uses references, ids cannot be dropped`);
  }
  if (LOOSE[nodeId]) body = body.replace(/^<g>/, `<g>${loosePath(nodeId)}`);
  return { width: +head[1], height: +head[2], viewBox: head[3], body };
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [size, objects] of Object.entries(NODES)) {
  const out = { size, sourcePalette: "lilac", objects: {} };
  for (const [id, [mainNode, bgNode]] of Object.entries(objects)) {
    out.objects[id] = { main: parse(fileFor(mainNode), mainNode), bg: parse(fileFor(bgNode), bgNode) };
  }
  const path = join(OUT_DIR, `${size}.json`);
  writeFileSync(path, JSON.stringify(out));
  console.log(size, Object.keys(out.objects).length, "objects", Math.round(JSON.stringify(out).length / 1024), "KB");
}
