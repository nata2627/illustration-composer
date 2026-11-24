import "./style.css";
import { loadLibrary, META, OBJECT_IDS, type Library, type Size, type Variant } from "./library";
import { builtinPalette, colorMap, parsePaletteFile, PALETTES, recolor, type Palette } from "./palette";
import { layerTransform, sceneToSvg } from "./render";
import { addLayer, CANVAS, duplicateLayer, findIndex, layerName, moveLayer, removeLayer, type Scene } from "./scene";
import { compose, hashString, TEMPLATES, type Pick, type TemplateId } from "./layout";
import { parseNames, pickForMetaphor } from "./match";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const palettes: Palette[] = [...PALETTES];
const scene: Scene = { size: "L", paletteId: "peach", layers: [] };
let lib: Library;
let selected: number | null = null;
let template: TemplateId = "headline";
let lastPicks: Pick[] = [];
let lastInput = "";
let variantSeed = 0;

const source = () => builtinPalette(lib.sourcePalette);
const target = () => palettes.find((p) => p.id === scene.paletteId)!;

function status(text: string, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function render() {
  const canvas = $("canvas");
  canvas.innerHTML = sceneToSvg(scene, lib, source(), target());
  const svg = canvas.querySelector("svg")!;
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  if (selected !== null) {
    const g = svg.querySelector<SVGGElement>(`g[data-uid="${selected}"]`);
    if (g) {
      // selection frame is drawn only on screen, it is not part of the export
      const box = g.getBBox();
      const frame = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      for (const [k, v] of Object.entries({ x: box.x, y: box.y, width: box.width, height: box.height })) {
        frame.setAttribute(k, String(v));
      }
      frame.setAttribute("class", "selection");
      frame.setAttribute("vector-effect", "non-scaling-stroke");
      g.appendChild(frame);
    }
  }
  renderLayers();
  renderToolbar();
}

function renderLayers() {
  const list = $("layers");
  list.innerHTML = "";
  [...scene.layers].reverse().forEach((layer) => {
    const li = document.createElement("li");
    li.textContent = `${META[layer.objectId].name}${layer.variant === "bg" ? ", фоновый" : ""} (${layerName(scene, layer)})`;
    li.classList.toggle("active", layer.uid === selected);
    li.onclick = () => select(layer.uid);
    list.appendChild(li);
  });
}

function renderToolbar() {
  const layer = scene.layers.find((l) => l.uid === selected);
  $("selected-name").textContent = layer ? META[layer.objectId].name : "Объект не выбран";
  $("toolbar").querySelectorAll("button").forEach((b) => (b.disabled = !layer));
}

function renderLibrary() {
  const box = $("library");
  box.innerHTML = "";
  const map = colorMap(source(), target());
  for (const variant of ["main", "bg"] as Variant[]) {
    for (const id of OBJECT_IDS) {
      const art = lib.objects[id][variant];
      const btn = document.createElement("button");
      btn.className = "thumb";
      btn.title = `${META[id].name}${variant === "bg" ? ", фоновый" : ""}`;
      btn.style.background = target().background.bg1;
      btn.innerHTML = `<svg viewBox="${art.viewBox}">${recolor(art.body, map)}</svg>`;
      btn.onclick = () => {
        const layer = addLayer(scene, id, variant);
        select(layer.uid);
      };
      box.appendChild(btn);
    }
  }
}

function select(uid: number | null) {
  selected = uid;
  render();
}

function autoCompose(picks: Pick[], input: string) {
  lastPicks = picks;
  lastInput = input;
  scene.layers = compose(picks, template, scene, lib, hashString(input) + variantSeed);
  selected = null;
  render();
}

function explainMetaphor(text: string) {
  const r = pickForMetaphor(text);
  const box = $("explain");
  if (r.fallback) {
    box.innerHTML = "<p>Совпадений со смыслами объектов нет, показан набор по умолчанию.</p>";
  } else {
    const byObject = new Map<string, string[]>();
    for (const reason of r.reasons) {
      const list = byObject.get(reason.objectId) ?? [];
      list.push(`${reason.meaning} («${reason.word}»)`);
      byObject.set(reason.objectId, list);
    }
    box.innerHTML = r.picks
      .map((p) => {
        const why = byObject.get(p.objectId)?.join(", ") ?? "для баланса композиции";
        return `<p><b>${META[p.objectId].name}</b>${p.variant === "bg" ? " (фоновый)" : ""}: ${why}</p>`;
      })
      .join("");
  }
  autoCompose(r.picks, text);
}

function composeNames(text: string) {
  const r = parseNames(text);
  const box = $("explain");
  if (r.picks.length === 0) {
    box.innerHTML = "<p>Ни одного объекта не найдено. Доступны: " + OBJECT_IDS.map((id) => META[id].name.toLowerCase()).join(", ") + ".</p>";
    return;
  }
  box.innerHTML =
    `<p>Объекты: ${r.picks.map((p) => META[p.objectId].name + (p.variant === "bg" ? " (фоновый)" : "")).join(", ")}.</p>` +
    (r.unknown.length ? `<p>Не распознано: ${r.unknown.join(", ")}.</p>` : "");
  autoCompose(r.picks, text);
}

function setupControls() {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.querySelectorAll<HTMLElement>(".tab-body").forEach((b) => (b.hidden = b.dataset.tab !== tab.dataset.tab));
    };
  });
  $("metaphor-form").onsubmit = (e) => {
    e.preventDefault();
    variantSeed = 0;
    explainMetaphor($<HTMLTextAreaElement>("metaphor").value);
  };
  $("names-form").onsubmit = (e) => {
    e.preventDefault();
    variantSeed = 0;
    composeNames($<HTMLInputElement>("names").value);
  };
  const chips = $("name-chips");
  for (const id of OBJECT_IDS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = META[id].name.toLowerCase();
    chip.onclick = () => {
      const input = $<HTMLInputElement>("names");
      input.value = input.value.trim() ? `${input.value.trim()}, ${chip.textContent}` : chip.textContent!;
    };
    chips.appendChild(chip);
  }

  const tpl = $<HTMLSelectElement>("template");
  for (const [id, t] of Object.entries(TEMPLATES)) tpl.add(new Option(t.name, id));
  tpl.value = template;
  tpl.onchange = () => {
    template = tpl.value as TemplateId;
    if (lastPicks.length) autoCompose(lastPicks, lastInput);
  };

  fillPalettes();
  $<HTMLSelectElement>("palette").onchange = (e) => {
    scene.paletteId = (e.target as HTMLSelectElement).value;
    renderLibrary();
    render();
  };
  $<HTMLInputElement>("palette-file").onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const loaded = parsePaletteFile(await file.text());
      for (const p of loaded) {
        const i = palettes.findIndex((q) => q.id === p.id);
        if (i >= 0) palettes[i] = p;
        else palettes.push(p);
      }
      scene.paletteId = loaded[0].id;
      fillPalettes();
      renderLibrary();
      render();
      status(`Загружено палитр: ${loaded.length}`);
    } catch (err) {
      status(`Палитра не загружена: ${(err as Error).message}`, true);
    }
  };

  $<HTMLSelectElement>("size").onchange = async (e) => {
    scene.size = (e.target as HTMLSelectElement).value as Size;
    status("Загружаю объекты размера " + scene.size);
    lib = await loadLibrary(scene.size);
    status("");
    renderLibrary();
    render();
  };

  $("variant").onclick = () => {
    if (!lastPicks.length) return;
    variantSeed += 1;
    autoCompose(lastPicks, lastInput);
  };
  $("clear").onclick = () => {
    scene.layers = [];
    select(null);
  };
  $("download").onclick = download;

  $("toolbar").onclick = (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (!act || selected === null) return;
    const layer = scene.layers[findIndex(scene, selected)];
    const actions: Record<string, () => void> = {
      up: () => moveLayer(scene, layer.uid, 1),
      down: () => moveLayer(scene, layer.uid, -1),
      rotl: () => (layer.rotation -= 15),
      rotr: () => (layer.rotation += 15),
      smaller: () => (layer.scale = Math.max(0.1, layer.scale / 1.15)),
      bigger: () => (layer.scale = Math.min(4, layer.scale * 1.15)),
      dup: () => (selected = duplicateLayer(scene, layer.uid).uid),
      del: () => {
        removeLayer(scene, layer.uid);
        selected = null;
      },
    };
    actions[act]();
    render();
  };

  document.addEventListener("keydown", (e) => {
    if (selected === null || (e.target as HTMLElement).closest("input, textarea, select")) return;
    const layer = scene.layers[findIndex(scene, selected)];
    const step = e.shiftKey ? 20 : 4;
    const keys: Record<string, () => void> = {
      Delete: () => (removeLayer(scene, layer.uid), (selected = null)),
      Backspace: () => (removeLayer(scene, layer.uid), (selected = null)),
      ArrowLeft: () => (layer.x -= step),
      ArrowRight: () => (layer.x += step),
      ArrowUp: () => (layer.y -= step),
      ArrowDown: () => (layer.y += step),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
      render();
    }
  });
}

function fillPalettes() {
  const sel = $<HTMLSelectElement>("palette");
  sel.innerHTML = "";
  for (const p of palettes) sel.add(new Option(p.name, p.id));
  sel.value = scene.paletteId;
}

// Dragging updates only the transform of the moved group; full re-render happens on release.
function setupDrag() {
  const canvas = $("canvas");
  let drag: { uid: number; dx: number; dy: number; g: SVGGElement } | null = null;
  const toCanvas = (e: PointerEvent) => {
    const rect = canvas.querySelector("svg")!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * CANVAS.width, y: ((e.clientY - rect.top) / rect.height) * CANVAS.height };
  };
  canvas.addEventListener("pointerdown", (e) => {
    const g = (e.target as Element).closest<SVGGElement>("g[data-uid]");
    if (!g) return select(null);
    const uid = Number(g.dataset.uid);
    if (uid !== selected) select(uid);
    const layer = scene.layers[findIndex(scene, uid)];
    const p = toCanvas(e);
    const fresh = canvas.querySelector<SVGGElement>(`g[data-uid="${uid}"]`)!;
    drag = { uid, dx: p.x - layer.x, dy: p.y - layer.y, g: fresh };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const layer = scene.layers[findIndex(scene, drag.uid)];
    const p = toCanvas(e);
    layer.x = Math.round(p.x - drag.dx);
    layer.y = Math.round(p.y - drag.dy);
    drag.g.setAttribute("transform", layerTransform(scene, layer, lib));
  });
  const end = () => {
    if (drag) render();
    drag = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

function download() {
  const svg = sceneToSvg(scene, lib, source(), target()).replace(/ data-uid="\d+"/g, "");
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `composition-${scene.paletteId}-${scene.size}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function start() {
  setupControls();
  setupDrag();
  const namesMode = await applyLinkParams();
  try {
    lib = await loadLibrary(scene.size);
  } catch (err) {
    status(`Библиотека не загрузилась: ${(err as Error).message}`, true);
    return;
  }
  renderLibrary();
  if (namesMode) composeNames($<HTMLInputElement>("names").value);
  else explainMetaphor($<HTMLTextAreaElement>("metaphor").value);
}

// Link parameters reproduce a composition: ?mode=names&q=лампа,книга&tpl=assembled&palette=teal&size=S
async function applyLinkParams() {
  const params = new URLSearchParams(location.search);
  const size = params.get("size");
  if (size === "L" || size === "S") {
    scene.size = size;
    $<HTMLSelectElement>("size").value = size;
  }
  const palette = params.get("palette");
  if (palette && palettes.some((p) => p.id === palette)) {
    scene.paletteId = palette;
    $<HTMLSelectElement>("palette").value = palette;
  }
  const tpl = params.get("tpl");
  if (tpl && tpl in TEMPLATES) {
    template = tpl as TemplateId;
    $<HTMLSelectElement>("template").value = tpl;
  }
  variantSeed = Number(params.get("v") ?? 0) || 0;
  const q = params.get("q");
  if (q && params.get("mode") === "names") {
    $<HTMLInputElement>("names").value = q;
    (document.querySelector('.tab[data-tab="names"]') as HTMLButtonElement).click();
  } else if (q) {
    $<HTMLTextAreaElement>("metaphor").value = q;
  }
  return params.get("mode") === "names";
}

start();
