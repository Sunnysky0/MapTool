import type { ViewState } from '../types';
import { buildProjection, getProjectionDef } from './projections';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 12000;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function normalizeLon(lon: number): number {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  if (l === -180) l = 180;
  return l;
}

export function normalizeAngle(a: number): number {
  let r = a % 360;
  if (r > 180) r -= 360;
  if (r < -180) r += 360;
  return r;
}

export function clampView(view: ViewState): ViewState {
  const def = getProjectionDef(view.projection);
  return {
    ...view,
    lon: normalizeLon(view.lon),
    lat: clamp(view.lat, -def.maxLat, def.maxLat),
    zoom: clamp(view.zoom, MIN_ZOOM, MAX_ZOOM),
    angle: normalizeAngle(view.angle),
  };
}

/** Move the map content by (dx, dy) screen pixels. */
export function panView(view: ViewState, w: number, h: number, dx: number, dy: number): ViewState {
  const def = getProjectionDef(view.projection);
  const proj = buildProjection(view, w, h);
  if (!def.globe) {
    const c = proj.invert?.([w / 2 - dx, h / 2 - dy]);
    if (c && isFinite(c[0]) && isFinite(c[1])) {
      return clampView({ ...view, lon: c[0], lat: c[1] });
    }
  }
  // Globe / fallback: degrees per pixel at the centre of the view, respecting canvas rotation
  const r = proj.scale();
  const k = 57.2958 / r;
  const a = (-view.angle * Math.PI) / 180;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  return clampView({ ...view, lon: view.lon - rx * k, lat: view.lat + ry * k });
}

/** Adjust `next` so that whatever was under (px,py) in `prev` stays under (px,py). */
export function keepPointUnderCursor(
  prev: ViewState,
  next: ViewState,
  w: number,
  h: number,
  px: number,
  py: number,
): ViewState {
  const p1 = buildProjection(prev, w, h);
  const geo = p1.invert?.([px, py]);
  if (!geo || !isFinite(geo[0]) || !isFinite(geo[1])) return next;
  const p2 = buildProjection(next, w, h);
  const s = p2(geo);
  if (!s || !isFinite(s[0]) || !isFinite(s[1])) return next;
  return panView(next, w, h, px - s[0], py - s[1]);
}

export function zoomViewAt(view: ViewState, w: number, h: number, factor: number, px?: number, py?: number): ViewState {
  const next = clampView({ ...view, zoom: view.zoom * factor });
  if (px === undefined || py === undefined) return next;
  return keepPointUnderCursor(view, next, w, h, px, py);
}

export function rotateViewTo(view: ViewState, w: number, h: number, angle: number, px?: number, py?: number): ViewState {
  const next = clampView({ ...view, angle });
  if (px === undefined || py === undefined) return next;
  return keepPointUnderCursor(view, next, w, h, px, py);
}

export function centerOnPixel(view: ViewState, w: number, h: number, px: number, py: number): ViewState {
  const proj = buildProjection(view, w, h);
  const geo = proj.invert?.([px, py]);
  if (!geo || !isFinite(geo[0]) || !isFinite(geo[1])) return view;
  return clampView({ ...view, lon: geo[0], lat: geo[1] });
}
