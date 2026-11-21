import { geoPath, geoGraticule, geoDistance, type GeoProjection } from 'd3-geo';
import type { GeoJSON } from 'geojson';
import type { LayerData, LayerId, LayerStyle, MapConfig } from '../types';
import { buildProjection, getProjectionDef } from './projections';
import { atlasLayerFor, layerDataKey } from './data';
import { paintScenario, scenarioSVG } from '../scenarios/render';

export interface RenderInput {
  config: MapConfig;
  data: Record<string, LayerData | undefined>;
  width: number;
  height: number;
}

const SPHERE = { type: 'Sphere' } as unknown as GeoJSON;

/** Order in which layers are painted (back to front). */
const PAINT_ORDER: LayerId[] = [
  'outline',
  'coast',
  'territories',
  'lakes',
  'graticule',
  'rivers',
  'provinces',
  'countries',
  'histA',
  'histB',
  'sovereignBorders',
  'adminBorders',
  'roads',
  'railways',
  'cities',
  'historicalLabels',
];

function dashArray(dash: LayerStyle['dash'], w: number): number[] {
  switch (dash) {
    case 'dashed':
      return [w * 5, w * 4];
    case 'dotted':
      return [w * 0.01, w * 3];
    default:
      return [];
  }
}

function strokeGeoFor(id: LayerId, style: LayerStyle, d: LayerData | undefined): GeoJSON | undefined {
  if (id === 'roads') return d?.variants?.[style.roadClass ?? 'major'] ?? d?.geo;
  return d?.geo;
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (isNaN(n)) return hex;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

let grainPattern: CanvasPattern | null = null;
function getGrainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (grainPattern) return grainPattern;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainPattern = ctx.createPattern(c, 'repeat');
  return grainPattern;
}

interface Placed {
  x: number;
  y: number;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
}

function titlePlacement(cfg: MapConfig, w: number, h: number, k: number): Placed {
  const m = 48 * k;
  const pos = cfg.title.position;
  const x = pos.endsWith('left') ? m : pos.endsWith('right') ? w - m : w / 2;
  const y = pos.startsWith('top') ? m : pos.startsWith('bottom') ? h - m : h / 2;
  const align: CanvasTextAlign = pos.endsWith('left') ? 'left' : pos.endsWith('right') ? 'right' : 'center';
  const baseline: CanvasTextBaseline = pos.startsWith('top') ? 'top' : pos.startsWith('bottom') ? 'alphabetic' : 'middle';
  return { x, y, align, baseline };
}

function visiblePoint(proj: GeoProjection, globe: boolean, lon: number, lat: number, center: [number, number], w: number, h: number): [number, number] | null {
  if (globe && geoDistance([lon, lat], center) > Math.PI / 2 - 0.02) return null;
  const p = proj([lon, lat]);
  if (!p || !isFinite(p[0]) || !isFinite(p[1])) return null;
  if (p[0] < -20 || p[1] < -20 || p[0] > w + 20 || p[1] > h + 20) return null;
  return p as [number, number];
}

/** Draw the map in CSS pixel units. The caller is responsible for DPR scaling. */
export function drawMap(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { config, data, width: w, height: h } = input;
  const k = w / 1920; // line widths are defined relative to a 1920px-wide artboard
  const proj = buildProjection(config.view, w, h);
  const def = getProjectionDef(config.view.projection);
  const path = geoPath(proj, ctx);
  const center: [number, number] = [config.view.lon, config.view.lat];

  // Background
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  if (!config.transparentBackground) {
    if (config.bgGradient) {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, config.background);
      g.addColorStop(1, config.bgGradientColor);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = config.background;
    }
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();

  ctx.lineCap = config.lineCap;
  ctx.lineJoin = 'round';

  for (const id of PAINT_ORDER) {
    const style = config.layers[id];
    if (!style.visible) continue;
    const key = layerDataKey(id, style, config.coastDetail, config.waterDetail, config.scenario);
    const d = key ? data[key] : undefined;
    const atlasLayer=atlasLayerFor(id,config.scenario);
    if (atlasLayer) {
      if (d?.scenario) paintScenario(ctx,atlasLayer,config,d.scenario,w);
      continue;
    }
    const lw = Math.max(0.05, style.width * k);

    if (id === 'outline') {
      if (style.fill) {
        ctx.save();
        ctx.globalAlpha = style.fillOpacity;
        ctx.fillStyle = style.fillColor;
        ctx.beginPath();
        path(SPHERE);
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = style.opacity;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = lw;
      ctx.setLineDash(dashArray(style.dash, lw));
      ctx.beginPath();
      path(SPHERE);
      ctx.stroke();
      ctx.restore();
      continue;
    }

    if (id === 'graticule') {
      const step = style.step ?? 10;
      const grat = geoGraticule().step([step, step])();
      ctx.save();
      ctx.globalAlpha = style.opacity;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = lw;
      ctx.setLineDash(dashArray(style.dash, lw));
      ctx.beginPath();
      path(grat);
      ctx.stroke();
      ctx.restore();
      continue;
    }

    if (id === 'cities') {
      if (!d?.points) continue;
      const maxRank = style.minRank ?? 1;
      const dot = (style.dotSize ?? 2) * k;
      const fontSize = (style.labelSize ?? 11) * k;
      ctx.save();
      ctx.globalAlpha = style.opacity;
      ctx.fillStyle = style.color;
      ctx.font = `500 ${fontSize}px ${config.title.font}, Georgia, serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (const c of d.points) {
        if (c.rank > maxRank) continue;
        const p = visiblePoint(proj, def.globe, c.lon, c.lat, center, w, h);
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p[0], p[1], c.capital ? dot * 1.4 : dot, 0, Math.PI * 2);
        ctx.fill();
        if (style.labels && c.name) {
          ctx.fillText(c.name, p[0] + dot * 2 + 2 * k, p[1]);
        }
      }
      ctx.restore();
      continue;
    }

    if (!d) continue;

    if (style.fill && d.fillGeo) {
      ctx.save();
      ctx.globalAlpha = style.fillOpacity;
      ctx.fillStyle = style.fillColor;
      ctx.beginPath();
      path(d.fillGeo);
      ctx.fill();
      ctx.restore();
    }

    const geo = strokeGeoFor(id, style, d);
    if (!geo) continue;
    ctx.save();
    ctx.globalAlpha = style.opacity;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = lw;
    ctx.setLineDash(style.dash === 'rail' ? [] : dashArray(style.dash, lw));
    ctx.beginPath();
    path(geo);
    ctx.stroke();
    if (style.dash === 'rail') {
      ctx.lineWidth = lw * 3.2;
      ctx.setLineDash([lw * 0.9, lw * 5]);
      ctx.lineCap = 'butt';
      ctx.beginPath();
      path(geo);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Vignette
  if (!config.transparentBackground && config.vignette > 0) {
    ctx.save();
    const r = Math.hypot(w, h) / 2;
    const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${config.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // Grain
  if (!config.transparentBackground && config.grain > 0) {
    const pat = getGrainPattern(ctx);
    if (pat) {
      ctx.save();
      ctx.globalAlpha = config.grain * 0.35;
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  // Title
  if (config.title.text || config.title.subtitle) {
    const t = config.title;
    const { x, y, align, baseline } = titlePlacement(config, w, h, k);
    const size = t.size * k;
    ctx.save();
    ctx.fillStyle = t.color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${t.letterSpacing * size}px`;
    const text = t.uppercase ? t.text.toUpperCase() : t.text;
    const sub = t.uppercase ? t.subtitle.toUpperCase() : t.subtitle;
    const subSize = size * 0.34;
    const gap = size * 0.45;
    let ty = y;
    let sy = y;
    if (baseline === 'top') {
      sy = y + size * 1.05 + gap;
    } else if (baseline === 'alphabetic') {
      ty = sub ? y - subSize - gap : y;
      sy = y;
    } else {
      ty = sub ? y - (subSize + gap) / 2 : y;
      sy = y + size / 2 + gap;
    }
    if (text) {
      ctx.font = `500 ${size}px "${t.font}", Georgia, serif`;
      ctx.fillText(text, x, ty);
    }
    if (sub) {
      ctx.font = `400 ${subSize}px "${t.font}", Georgia, serif`;
      ctx.globalAlpha = 0.75;
      ctx.fillText(sub, x, sy);
    }
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* SVG export                                                          */
/* ------------------------------------------------------------------ */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderSVG(input: RenderInput): string {
  const { config, data, width: w, height: h } = input;
  const k = w / 1920;
  const proj = buildProjection(config.view, w, h);
  const def = getProjectionDef(config.view.projection);
  const path = geoPath(proj);
  const center: [number, number] = [config.view.lon, config.view.lat];
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  if(config.scenario?.revision===2) out.push('<metadata>PeaceSenshado political atlas, 1939-01-01, revision 2. Natural Earth (public domain). Historical Basemaps, A. Ourednik (GPL-3.0). African boundaries adapted from CShapes 2.0, Schvitz et al. (2022), https://icr.ethz.ch/data/cshapes/ (CC BY-NC-SA 4.0, https://creativecommons.org/licenses/by-nc-sa/4.0/).</metadata>');
  out.push('<defs>');
  if (!config.transparentBackground && config.bgGradient) {
    out.push(`<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${config.background}"/><stop offset="1" stop-color="${config.bgGradientColor}"/></linearGradient>`);
  }
  if (!config.transparentBackground && config.vignette > 0) {
    out.push(`<radialGradient id="vig" cx="0.5" cy="0.5" r="0.7"><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${config.vignette}"/></radialGradient>`);
  }
  out.push('</defs>');
  if (!config.transparentBackground) {
    out.push(`<rect width="${w}" height="${h}" fill="${config.bgGradient ? 'url(#bg)' : config.background}"/>`);
  }
  out.push(`<g fill="none" stroke-linecap="${config.lineCap}" stroke-linejoin="round">`);

  const strokeAttrs = (style: LayerStyle, lw: number, rail = false) => {
    const da = rail ? [] : dashArray(style.dash, lw);
    return `stroke="${style.color}" stroke-width="${lw.toFixed(3)}" stroke-opacity="${style.opacity}"${da.length ? ` stroke-dasharray="${da.map((n) => n.toFixed(2)).join(' ')}"` : ''}`;
  };

  for (const id of PAINT_ORDER) {
    const style = config.layers[id];
    if (!style.visible) continue;
    const key = layerDataKey(id, style, config.coastDetail, config.waterDetail, config.scenario);
    const d = key ? data[key] : undefined;
    const atlasLayer=atlasLayerFor(id,config.scenario);
    if (atlasLayer) {
      if (d?.scenario) out.push(scenarioSVG(atlasLayer,config,d.scenario,w));
      continue;
    }
    const lw = Math.max(0.05, style.width * k);

    if (id === 'outline') {
      const dd = path(SPHERE as never) ?? '';
      if (style.fill) out.push(`<path d="${dd}" fill="${style.fillColor}" fill-opacity="${style.fillOpacity}"/>`);
      out.push(`<path d="${dd}" ${strokeAttrs(style, lw)}/>`);
      continue;
    }
    if (id === 'graticule') {
      const step = style.step ?? 10;
      const dd = path(geoGraticule().step([step, step])()) ?? '';
      out.push(`<path d="${dd}" ${strokeAttrs(style, lw)}/>`);
      continue;
    }
    if (id === 'cities') {
      if (!d?.points) continue;
      const maxRank = style.minRank ?? 1;
      const dot = (style.dotSize ?? 2) * k;
      const fs = (style.labelSize ?? 11) * k;
      out.push(`<g fill="${style.color}" fill-opacity="${style.opacity}" font-family="${esc(config.title.font)}, Georgia, serif" font-size="${fs.toFixed(2)}" font-weight="500">`);
      for (const c of d.points) {
        if (c.rank > maxRank) continue;
        const p = visiblePoint(proj, def.globe, c.lon, c.lat, center, w, h);
        if (!p) continue;
        out.push(`<circle cx="${p[0].toFixed(2)}" cy="${p[1].toFixed(2)}" r="${(c.capital ? dot * 1.4 : dot).toFixed(2)}"/>`);
        if (style.labels && c.name) out.push(`<text x="${(p[0] + dot * 2 + 2 * k).toFixed(2)}" y="${p[1].toFixed(2)}" dominant-baseline="middle">${esc(c.name)}</text>`);
      }
      out.push('</g>');
      continue;
    }
    if (!d) continue;
    if (style.fill && d.fillGeo) {
      out.push(`<path d="${path(d.fillGeo as never) ?? ''}" fill="${style.fillColor}" fill-opacity="${style.fillOpacity}"/>`);
    }
    const geo = strokeGeoFor(id, style, d);
    if (!geo) continue;
    const dd = path(geo as never) ?? '';
    out.push(`<path d="${dd}" ${strokeAttrs(style, lw, style.dash === 'rail')}/>`);
    if (style.dash === 'rail') {
      out.push(`<path d="${dd}" stroke="${style.color}" stroke-opacity="${style.opacity}" stroke-width="${(lw * 3.2).toFixed(3)}" stroke-dasharray="${(lw * 0.9).toFixed(2)} ${(lw * 5).toFixed(2)}" stroke-linecap="butt"/>`);
    }
  }
  out.push('</g>');
  if (!config.transparentBackground && config.vignette > 0) out.push(`<rect width="${w}" height="${h}" fill="url(#vig)"/>`);

  if (config.title.text || config.title.subtitle) {
    const t = config.title;
    const { x, y, align, baseline } = titlePlacement(config, w, h, k);
    const size = t.size * k;
    const subSize = size * 0.34;
    const gap = size * 0.45;
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    const text = t.uppercase ? t.text.toUpperCase() : t.text;
    const sub = t.uppercase ? t.subtitle.toUpperCase() : t.subtitle;
    let ty = y;
    let sy = y;
    let tBase = 'alphabetic';
    if (baseline === 'top') {
      tBase = 'hanging';
      sy = y + size * 1.05 + gap;
    } else if (baseline === 'alphabetic') {
      ty = sub ? y - subSize - gap : y;
    } else {
      tBase = 'middle';
      ty = sub ? y - (subSize + gap) / 2 : y;
      sy = y + size / 2 + gap;
    }
    out.push(`<g fill="${t.color}" font-family="${esc(t.font)}, Georgia, serif" text-anchor="${anchor}">`);
    if (text) out.push(`<text x="${x}" y="${ty}" font-size="${size}" font-weight="500" letter-spacing="${t.letterSpacing * size}" dominant-baseline="${tBase}">${esc(text)}</text>`);
    if (sub) out.push(`<text x="${x}" y="${sy}" font-size="${subSize}" letter-spacing="${t.letterSpacing * subSize}" fill-opacity="0.75" dominant-baseline="${tBase}">${esc(sub)}</text>`);
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}
