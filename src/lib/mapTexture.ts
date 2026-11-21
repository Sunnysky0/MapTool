import { drawMap, type RenderInput } from './render';
import { tileCanvas } from './canvas';
import type { TextureArea } from './projections';
import type { LayerId, MapConfig } from '../types';

export interface TextureSpec extends TextureArea {
  size: number;
  height: number;
  level: number;
}
export interface TextureRequest extends RenderInput {
  kind: 'texture';
  id: number;
  spec: TextureSpec;
  strokeScale: number;
}
export interface TexturePixels {
  id: number;
  spec: TextureSpec;
  pixels: Uint32Array;
}

export function bakeTexture(request: TextureRequest): TexturePixels {
  const {spec, strokeScale} = request;
  const surface = tileCanvas(spec.size, spec.height);
  const ctx = surface.getContext('2d', {willReadFrequently: true})!;
  const layers = {...request.config.layers};
  for (const id of Object.keys(layers) as LayerId[]) {
    layers[id] = {...layers[id], width: layers[id].width * strokeScale};
  }
  layers.outline.visible = false;
  const config: MapConfig = {...request.config, layers, transparentBackground: true, width: spec.size, height: spec.height};
  drawMap(ctx, {...request, config, width: spec.size, height: spec.height, texture: spec, preview: true}, 'base');
  const rgba = ctx.getImageData(0, 0, spec.size, spec.height);
  return {id: request.id, spec, pixels: new Uint32Array(rgba.data.buffer)};
}
