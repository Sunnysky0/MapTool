export type MapContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function tileCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document === 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// D3 streams into a fresh native path and never needs to reset it.
export class MapPath extends Path2D { beginPath() {} }
