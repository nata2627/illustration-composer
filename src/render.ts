import { UNIT_SCALE, type Library } from "./library";
import { colorMap, recolor, type Palette } from "./palette";
import { CANVAS, layerName, type Layer, type Scene } from "./scene";

const r = (n: number) => Math.round(n * 1000) / 1000;

export function layerTransform(scene: Scene, layer: Layer, lib: Library): string {
  const art = lib.objects[layer.objectId][layer.variant];
  const s = layer.scale * UNIT_SCALE[scene.size];
  return (
    `translate(${r(layer.x)} ${r(layer.y)}) rotate(${r(layer.rotation)}) ` +
    `scale(${r(s)}) translate(${r(-art.width / 2)} ${r(-art.height / 2)})`
  );
}

// One SVG string serves both the on-screen canvas and the downloaded file,
// so what the user sees is exactly what is exported.
export function sceneToSvg(scene: Scene, lib: Library, source: Palette, target: Palette): string {
  const map = colorMap(source, target);
  const groups = scene.layers.map((layer) => {
    const art = lib.objects[layer.objectId][layer.variant];
    return (
      `<g id="${layerName(scene, layer)}" data-uid="${layer.uid}" transform="${layerTransform(scene, layer, lib)}">` +
      recolor(art.body, map) +
      `</g>`
    );
  });
  const { width, height } = CANVAS;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">` +
    `<rect id="background" width="${width}" height="${height}" fill="${target.background.bg1}"/>` +
    groups.join("") +
    `</svg>`
  );
}
