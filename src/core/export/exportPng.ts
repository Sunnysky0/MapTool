import type { RenderPlan } from '../render/render-plan';
import { drawRenderPlan } from '../render/canvas-renderer';
import { downloadBlob } from '../utils/download';

export const MAX_PNG_AXIS = 8192;
export const MAX_PNG_BYTES = 256 * 1024 * 1024;

export class PngExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngExportError';
  }
}

export interface PngExportOptions {
  /** Optional dependency injection for tests and non-browser hosts. */
  canvasFactory?: (width: number, height: number) => CanvasLike;
}

interface CanvasLike {
  width: number;
  height: number;
  getContext(
    contextId: '2d',
    options?: CanvasRenderingContext2DSettings,
  ): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  convertToBlob?: (options?: ImageEncodeOptions) => Promise<Blob>;
  toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
}

function isPngDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0 && Number.isInteger(value);
}

export function estimatePngMemoryBytes(width: number, height: number): number {
  return width * height * 4;
}

export function validatePngDimensions(width: number, height: number): void {
  if (!isPngDimension(width) || !isPngDimension(height)) {
    throw new PngExportError('PNG width and height must be positive integers.');
  }
  const bytes = estimatePngMemoryBytes(width, height);
  if (!Number.isSafeInteger(bytes) || bytes > MAX_PNG_BYTES) {
    throw new PngExportError(
      `PNG canvas requires ${bytes} bytes; the limit is ${MAX_PNG_BYTES} bytes (256 MiB).`,
    );
  }
  if (width > MAX_PNG_AXIS || height > MAX_PNG_AXIS) {
    throw new PngExportError(
      `PNG dimensions exceed the ${MAX_PNG_AXIS}px per-axis limit (${width}×${height}).`,
    );
  }
}

function getCanvasContext(canvas: CanvasLike): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new PngExportError('A 2D canvas context is unavailable.');
  return context as CanvasRenderingContext2D;
}

async function blobFromCanvas(canvas: CanvasLike, plan: RenderPlan): Promise<Blob> {
  const context = getCanvasContext(canvas);
  drawRenderPlan(context, plan);

  if (canvas.convertToBlob) {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  if (canvas.toBlob) {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob!((blob) => {
        if (blob) resolve(blob);
        else reject(new PngExportError('The canvas could not be encoded as PNG.'));
      }, 'image/png');
    });
  }
  throw new PngExportError('The canvas does not support PNG encoding.');
}

function createDomCanvas(width: number, height: number): CanvasLike {
  if (typeof document === 'undefined') {
    throw new PngExportError('No DOM canvas is available for PNG export.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function createOffscreenBlob(plan: RenderPlan): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  try {
    const canvas = new OffscreenCanvas(plan.width, plan.height);
    return await blobFromCanvas(canvas, plan);
  } catch (error) {
    // A browser can expose OffscreenCanvas while omitting 2D or image encoding.
    // In that case the DOM canvas is the supported fallback.
    if (error instanceof PngExportError) return null;
    throw error;
  }
}

export async function exportPng(plan: RenderPlan, options: PngExportOptions = {}): Promise<Blob> {
  validatePngDimensions(plan.width, plan.height);

  if (options.canvasFactory) {
    const canvas = options.canvasFactory(plan.width, plan.height);
    canvas.width = plan.width;
    canvas.height = plan.height;
    return blobFromCanvas(canvas, plan);
  }

  const offscreenBlob = await createOffscreenBlob(plan);
  if (offscreenBlob) return offscreenBlob;
  return blobFromCanvas(createDomCanvas(plan.width, plan.height), plan);
}

export async function downloadPng(
  plan: RenderPlan,
  filename = 'map.png',
  options?: PngExportOptions,
): Promise<void> {
  downloadBlob(await exportPng(plan, options), filename);
}
