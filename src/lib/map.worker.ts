import { bakeTexture, type TextureRequest } from './mapTexture';
import { drawMap, type RenderInput } from './render';

export interface FrameRequest extends RenderInput {
  kind: 'full';
  id: number;
  dpr: number;
}
export interface FrameReply {
  id: number;
  bitmap?: ImageBitmap;
}

// The main thread sends each immutable dataset once, then just view and style changes.
const data: RenderInput['data'] = {};
const previewData: RenderInput['data'][] = [{}, {}];
const textureQueue = new Map<number, TextureRequest>();
let textureScheduled = false;
function scheduleTexture() {
  if (textureScheduled || !textureQueue.size) return;
  textureScheduled = true;
  setTimeout(() => {
    textureScheduled = false;
    const request = textureQueue.values().next().value!;
    const {level} = request.spec;
    textureQueue.delete(level);
    const frame = bakeTexture({...request, data: previewData[level]});
    self.postMessage(frame, {transfer:[frame.pixels.buffer]});
    scheduleTexture();
  }, 0);
}

let canvas: OffscreenCanvas | undefined;
let pending: FrameRequest | undefined;
let scheduled = false;
function schedule() {
  if (!scheduled && pending) {
    scheduled = true;
    setTimeout(renderLatest, 0);
  }
}
async function renderLatest() {
  const request = pending;
  pending = undefined;
  if (!request) { scheduled = false; return; }
  const {id, width, height, dpr} = request;
  try {
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (!canvas || canvas.width !== w || canvas.height !== h) canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap(ctx, {...request, data}, 'base');
    // Finish rasterization here. Transferring a deferred display list can leave
    // seconds of geographic painting on the compositor just as the next drag starts.
    const bitmap = await createImageBitmap(ctx.getImageData(0, 0, w, h));
    self.postMessage({id, bitmap} satisfies FrameReply, {transfer: [bitmap]});
  } catch {
    self.postMessage({id} satisfies FrameReply);
  }
  scheduled = false;
  schedule();
}

self.onmessage = ({data: request}: MessageEvent<FrameRequest | TextureRequest | {kind: 'cancel'}>) => {
  if (request.kind === 'cancel') { pending = undefined; return; }
  if (request.kind === 'texture') {
    const cache = previewData[request.spec.level];
    Object.assign(cache, request.data);
    textureQueue.set(request.spec.level, request);
    scheduleTexture();
    return;
  }
  Object.assign(data, request.data);
  pending = request;
  schedule();
};
