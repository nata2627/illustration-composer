import { META, type Size, type Variant } from "./library";

export const CANVAS = { width: 1200, height: 630 };

export interface Layer {
  uid: number;
  objectId: string;
  variant: Variant;
  x: number; // centre of the object on the canvas
  y: number;
  scale: number; // relative to the size's unit scale, always uniform
  rotation: number; // degrees
}

export interface Scene {
  size: Size;
  paletteId: string;
  layers: Layer[]; // first is the bottom layer
}

let nextUid = 1;

export function newLayer(fields: Omit<Layer, "uid">): Layer {
  return { uid: nextUid++, ...fields };
}

export function addLayer(scene: Scene, objectId: string, variant: Variant): Layer {
  const layer = newLayer({ objectId, variant, x: CANVAS.width / 2, y: CANVAS.height / 2, scale: META[objectId].scale, rotation: 0 });
  scene.layers.push(layer);
  return layer;
}

export function findIndex(scene: Scene, uid: number): number {
  const i = scene.layers.findIndex((l) => l.uid === uid);
  if (i < 0) throw new Error(`no layer ${uid}`);
  return i;
}

export function removeLayer(scene: Scene, uid: number): void {
  scene.layers.splice(findIndex(scene, uid), 1);
}

export function duplicateLayer(scene: Scene, uid: number): Layer {
  const i = findIndex(scene, uid);
  const copy = newLayer({ ...scene.layers[i], x: scene.layers[i].x + 30, y: scene.layers[i].y + 30 });
  scene.layers.splice(i + 1, 0, copy);
  return copy;
}

// step +1 moves the layer one level up (towards the viewer), -1 one level down.
export function moveLayer(scene: Scene, uid: number, step: 1 | -1): void {
  const i = findIndex(scene, uid);
  const j = i + step;
  if (j < 0 || j >= scene.layers.length) return;
  [scene.layers[i], scene.layers[j]] = [scene.layers[j], scene.layers[i]];
}

export function layerName(scene: Scene, layer: Layer): string {
  const same = scene.layers.filter((l) => l.objectId === layer.objectId && l.variant === layer.variant);
  const n = same.indexOf(layer) + 1;
  return `${layer.objectId}${layer.variant === "bg" ? "-bg" : ""}-${n}`;
}
