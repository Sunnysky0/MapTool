import RenderWorker from './map.worker?worker&inline';
import type { FrameRequest, FrameReply } from './map.worker';
import { drawMap, type RenderInput } from './render';
import { previewPainter } from './previewPainter';

interface Frame {
  id: number;
  input: RenderInput;
  dpr: number;
}

export function mapPainter(canvas: HTMLCanvasElement) {
  const preview = previewPainter();
  const ctx = canvas.getContext('2d')!;
  let worker: Worker | undefined;
  let latest: Frame | undefined;
  let serial = 0, fallbackFrame = 0;
  const sent: RenderInput['data'] = {};

  function size({width, height}: RenderInput, dpr: number) {
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function pump() {
    if (!latest) return;
    const {id, input, dpr} = latest;
    if (worker) {
      const changed: RenderInput['data'] = {};
      for (const [key, value] of Object.entries(input.data)) {
        if (value !== sent[key]) changed[key] = value;
      }
      try {
        worker.postMessage({...input, kind: 'full', data: changed, id, dpr} satisfies FrameRequest);
        Object.assign(sent, changed);
      } catch { fallback(); }
    } else {
      cancelAnimationFrame(fallbackFrame);
      fallbackFrame = requestAnimationFrame(() => {
        fallbackFrame = 0;
        if (latest?.id === id) {
          size(input, dpr);
          drawMap(ctx, input);
          latest = undefined;
        }
      });
    }
  }

  function fallback() {
    worker?.terminate();
    worker = undefined;
    pump();
  }

  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try {
      worker = new RenderWorker();
      worker.onerror = fallback;
      worker.onmessageerror = fallback;
      worker.onmessage = ({data: {id, bitmap}}: MessageEvent<FrameReply>) => {
        if (!bitmap) { fallback(); return; }
        try {
          if (latest?.id === id) {
            const {input, dpr} = latest;
            size(input, dpr);
            // Copy also replaces transparent pixels left by a previous view.
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'copy';
            ctx.drawImage(bitmap, 0, 0);
            ctx.restore();
            // Paint labels and lettering with the document's actual loaded fonts.
            drawMap(ctx, input, 'overlay');
            latest = undefined;
          }
        } finally { bitmap.close(); }
      };
    } catch { worker = undefined; }
  }

  function invalidate() {
    if (latest) worker?.postMessage({kind:'cancel'});
    latest = undefined;
    if (fallbackFrame) {
      cancelAnimationFrame(fallbackFrame);
      fallbackFrame = 0;
    }
  }

  return {
    invalidate,
    full(input: RenderInput) {
      latest = {id: ++serial, input, dpr: Math.min(window.devicePixelRatio || 1, 2.5)};
      pump();
      preview.prepare(input);
    },
    preview(input: RenderInput) {
      size(input, 1);
      preview.draw(ctx,input);
    },
    dispose() {
      invalidate();
      preview.dispose();
      worker?.terminate();
    },
  };
}
