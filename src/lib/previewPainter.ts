import MapWorker from './map.worker?worker&inline';
import { buildProjection } from './projections';
import { interactiveInput } from './previewData';
import { bakeTexture, type TextureSpec, type TexturePixels, type TextureRequest } from './mapTexture';
import { drawMap, type RenderInput } from './render';
import { rasterPreview, unitOutline } from './reproject';
import { atlasLayerFor } from './layers';
import type { LayerId } from '../types';

const WORLD: TextureSpec = {lon: 0, lat: 0, span: 360, size: 2048, height: 1024, level: 0};

export function previewPainter() {
  const reproject = rasterPreview();
  let world: TexturePixels | undefined, region: TexturePixels | undefined;
  let worker: Worker | undefined, serial = 0;
  let previous: RenderInput | undefined, style = '', bucket = '', area: TextureSpec | undefined;
  let sheet: {canvas: HTMLCanvasElement; origin: [number,number]; pad: number; input: RenderInput} | undefined;
  const expected = [0, 0];
  let vectorLayers: LayerId[] = [];
  let layerStyles: RenderInput['config']['layers'] | undefined;
  const sent: RenderInput['data'][] = [{}, {}];

  function receive(result: TexturePixels) {
    if (result.id !== expected[result.spec.level]) return;
    sheet = undefined;
    if (result.spec.level === 0) world = result;
    else region = result;
    if (previous && world && (!area || region) && european(previous)) projectedSheet(previous, world);
  }
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try {
      worker = new MapWorker();
      worker.onmessage = (event: MessageEvent<TexturePixels>) => receive(event.data);
      worker.onerror = () => {worker?.terminate(); worker = undefined; previous = undefined;};
    } catch { worker = undefined; }
  }

  function prepare(input: RenderInput) {
    const {config, width, height} = input, {view} = config;
    if (layerStyles !== config.layers) {
      layerStyles = config.layers;
      vectorLayers = (Object.keys(layerStyles) as LayerId[]).filter(id =>
        id !== 'outline' && id !== 'cities' && id !== 'historicalLabels' && config.layers[id].visible);
    }
    if (!vectorLayers.length) return;
    const scale = buildProjection(view, width, height).scale();
    unitOutline(view.projection);
    const tier = view.zoom < 1.9 ? 0 : view.zoom < 2.4 ? 1 : view.zoom < 12 ? 2 : view.zoom < 80 ? 3 : 4;
    const artwork = [config.coastDetail, config.waterDetail, config.atlasTheme, config.atlasSheet, config.scenario?.revision, config.lineCap].join('|');
    const key = [view.projection, tier, Math.round(Math.log2(scale / width)*2)].join('|');
    const changed = previous?.data !== input.data || previous.config.layers !== config.layers ||
      previous.config.territoryColors !== config.territoryColors || style !== artwork;
    const zoomChanged = bucket !== key;
    style = artwork;
    previous = input;
    bucket = key;
    function request(spec: TextureSpec) {
      const preview = interactiveInput(input, spec.level);
      const job: TextureRequest = {...preview, kind: 'texture', id: ++serial, spec,
        strokeScale: Math.max(.18, Math.min(4, width / (scale*spec.span*Math.PI/180)))};
      expected[spec.level] = job.id;
      if (worker) {
        const cache = sent[spec.level], changedData: RenderInput['data'] = {};
        for (const [k, v] of Object.entries(preview.data)) if (cache[k] !== v) changedData[k] = v;
        try { worker.postMessage({...job, data: changedData}); Object.assign(cache, changedData); return; }
        catch { worker.terminate(); worker = undefined; }
      }
      receive(bakeTexture(job));
    }
    if (changed) sheet = world = region = undefined;
    if (changed || zoomChanged) {
      area = undefined;
      request(WORLD);
    }
    // A padded regional texture gives close views enough texels per screen pixel.
    const span = Math.min(360, 2.8 * Math.max(width,height) * 180 / (Math.PI*scale*Math.max(.15, Math.cos(view.lat*Math.PI/180))));
    if (span >= 300) { region = undefined; area = undefined; expected[1] = 0; return; }
    const delta = area ? Math.abs(((view.lon-area.lon+540)%360)-180) : Infinity;
    if (!area || span < area.span*.67 || span > area.span*1.5 || delta > area.span*.20 || Math.abs(view.lat-area.lat)>area.span*.20) {
      area = {lon:view.lon, lat:view.lat, span, size:1024, height:1024, level:1};
      request(area);
    }
  }

  function european({config}: RenderInput) {
    return config.atlasSheet === 'europe' && config.view.projection === 'lambertEurope' && !!config.scenario;
  }
  function projectedSheet(input: RenderInput, texture: TexturePixels) {
    // Lambert Europe keeps a fixed central meridian. At a fixed zoom and angle
    // changing its center is exactly a translation, including all label anchors.
    const {config, width, height} = input;
    const projection = buildProjection(config.view,width,height);
    const anchor = projection([10,52])!;
    let dx = sheet ? anchor[0]-sheet.origin[0] : 0, dy = sheet ? anchor[1]-sheet.origin[1] : 0;
    if (!sheet || sheet.input.width !== width || sheet.input.height !== height ||
        sheet.input.config.view.zoom !== config.view.zoom || sheet.input.config.view.angle !== config.view.angle ||
        sheet.input.config.labelEdits !== config.labelEdits || Math.max(Math.abs(dx),Math.abs(dy)) >= sheet.pad-1) {
      const pad = Math.ceil(Math.min(width,height)*.32);
      const canvas = document.createElement('canvas');
      canvas.width = width+2*pad; canvas.height = height+2*pad;
      const g = canvas.getContext('2d')!;
      projection.translate([canvas.width/2,canvas.height/2]);
      reproject(g, {...input,width:canvas.width,height:canvas.height}, projection, texture, region, true);
      g.translate(pad,pad);
      drawMap(g, {...input,preview:true,margin:pad}, 'points');
      sheet = {canvas, origin:anchor, pad, input};
      dx = dy = 0;
    }
    return {canvas:sheet.canvas, x:dx-sheet.pad, y:dy-sheet.pad};
  }

  return {
    prepare,
    draw(ctx: CanvasRenderingContext2D, input: RenderInput) {
      prepare(input);
      const {config} = input;
      // The two maps can have different clipping rectangles when a regional sheet
      // is combined with ordinary layers. Preserve their interleaved paint order.
      const mixed = config.scenario && config.atlasSheet !== 'world' &&
        vectorLayers.some(id => !atlasLayerFor(id, config.scenario));
      if (!vectorLayers.length) { drawMap(ctx, input); return; }
      if (!world || mixed) { drawMap(ctx, interactiveInput(input)); return; }
      drawMap(ctx, input, 'background');
      if (european(input)) {
        const current = projectedSheet(input, world);
        const inset = input.width*7.2/583.56;
        ctx.save();
        ctx.beginPath(); ctx.rect(inset,inset,input.width-2*inset,input.height-2*inset); ctx.clip();
        ctx.drawImage(current.canvas, current.x, current.y);
        ctx.restore();
        drawMap(ctx, input, 'decoration');
      } else {
        reproject(ctx, input, buildProjection(config.view, input.width, input.height), world, region);
        drawMap(ctx, input, 'overlay');
      }
    },
    dispose() { worker?.terminate(); },
  };
}
