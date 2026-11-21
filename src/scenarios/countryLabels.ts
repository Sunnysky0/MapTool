import { geoArea, geoBounds, geoPath, type GeoProjection } from 'd3-geo';
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';
import type { PoliticalUnit, ScenarioData } from '../types';

export const VIC3_FONT_STACK =
  '"Noto Serif","Cormorant Garamond","Baskerville Old Face","Garamond","Georgia","Noto Serif SC","Source Han Serif SC","Noto Serif CJK SC","Noto Serif TC","Source Han Serif TC","Songti SC","STSong","STZhongsong","SimSun",serif';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const COLONIAL_STATUS = new Set([
  '殖民地', '保护国', '保护区', '保护领', '自治殖民地',
  '共管领', '代管领', '国际托管领', '中立托管领', '殖民行政区',
]);
const CONCESSION_STATUS = new Set(['租界', '国际自由港', '非军事区', '特别港区', '港口']);

export interface Pt { x: number; y: number }
export interface PlacedGlyph { letter: string; x: number; y: number; angle: number }
export interface CollisionCircle { x: number; y: number; r: number }
export interface CurvedLabelLayout {
  glyphs: PlacedGlyph[];
  circles: CollisionCircle[];
  size: number;
  weight: 400 | 500;
  areaPx: number;
}

export interface GeoSpine {
  points: [number, number][]; // 9 geographic [lon, lat] samples along the fitted Bezier
  halfWidthRad: number;       // minimum interior clearance radius in sphere radians
  areaSr: number;             // combined steradian area of included faces
  center: [number, number];   // [lon, lat] midpoint of the spine
  bounds: [[number, number], [number, number]];
  merged: boolean;
}

interface ScreenSpine {
  points: Pt[];
  halfWidthPx: number;
  areaPx: number;
}

type FaceFeature = Feature<Polygon | MultiPolygon, { unit: string; manager: string; groups: string[] }>;

interface UnitHierarchy {
  facesByUnit: Map<string, FaceFeature[]>;
  childrenByUnit: Map<string, PoliticalUnit[]>;
  ownArea: Map<string, number>;
  polygonsByUnit: Map<string, Position[][][]>;
  polyAreasByUnit: Map<string, number[]>;
  faceBbox: Map<string, [[number, number], [number, number]]>;
  mergedChildren: Map<string, string[]>;
  mergedSubUnits: Map<string, Set<string>>;
  nameZoom: Map<string, number>;
  mergeState: { zoom: number; merged: Map<string, boolean>; hidden: Set<string> } | null;
}

/* ------------------------------------------------------------------ */
/* Typography & text measurement                                      */
/* ------------------------------------------------------------------ */

let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
const advanceCache = new Map<string, number>();

function getMeasureCtx() {
  if (measureCtx !== undefined) return measureCtx;
  try {
    if (typeof document !== 'undefined') {
      measureCtx = document.createElement('canvas').getContext('2d');
    } else if (typeof OffscreenCanvas !== 'undefined') {
      measureCtx = new OffscreenCanvas(64, 64).getContext('2d');
    } else {
      measureCtx = null;
    }
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

function fallbackAdvance(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code > 255) return 1.0;
  if (ch === ' ') return 0.28;
  if (/[MW]/.test(ch)) return 0.92;
  if (/[A-Z]/.test(ch)) return 0.70;
  if (/[mw]/.test(ch)) return 0.80;
  if (/[iltjfI.,;:'"!]/.test(ch)) return 0.34;
  return 0.56;
}

export function measureGlyphAdvances(chars: string[], weight: 400 | 500): number[] {
  const ctx = getMeasureCtx();
  let fontSet = false;
  return chars.map((ch) => {
    const key = `${weight}:${ch}`;
    const cached = advanceCache.get(key);
    if (cached !== undefined) return cached;
    let adv = fallbackAdvance(ch);
    if (ctx) {
      if (!fontSet) {
        ctx.font = `${weight} 100px ${VIC3_FONT_STACK}`;
        fontSet = true;
      }
      const w = ctx.measureText(ch).width / 100;
      if (w > 0 && isFinite(w)) adv = w;
    }
    advanceCache.set(key, adv);
    return adv;
  });
}

export function isCJKDominant(text: string): boolean {
  const chars = Array.from(text);
  if (!chars.length) return false;
  let cjk = 0;
  for (const c of chars) {
    const code = c.codePointAt(0) ?? 0;
    if ((code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)) cjk++;
  }
  return cjk >= Math.max(1, chars.length * 0.4);
}

const CJK_SUFFIX_RE = /(自治共和国|联合大公国|联合王国|王公联盟|自治领|保护国|保护区|保护领|托管领|苏丹国|酋长国|共和国|总督府|开发区|联合领|王国|帝国|联邦)$/;
const CJK_PREFIX_RE = /^(英属|法属|德属|意属|荷属|俄属|葡属|美属|西属|西班牙|奥属|日属)/;

/** Split a long country/polity name at natural semantic or word boundaries. */
export function splitTwoLines(text: string): [string, string] | null {
  const trimmed = text.trim();
  const paren = trimmed.match(/^(.+?)([（(].+[）)])$/);
  if (paren && Array.from(paren[1]).length >= 2 && Array.from(paren[2]).length >= 2) {
    return [paren[1].trim(), paren[2].trim()];
  }
  const dash = trimmed.indexOf('—');
  if (dash >= 2 && dash <= trimmed.length - 3) {
    return [trimmed.slice(0, dash), trimmed.slice(dash + 1)];
  }
  if (trimmed.includes(' ')) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      let bestIdx = 1, bestDiff = Infinity;
      const total = trimmed.length;
      let acc = 0;
      for (let i = 0; i < words.length - 1; i++) {
        acc += words[i].length + (i > 0 ? 1 : 0);
        const diff = Math.abs(acc - (total - acc - 1));
        if (diff < bestDiff) { bestDiff = diff; bestIdx = i + 1; }
      }
      return [words.slice(0, bestIdx).join(' '), words.slice(bestIdx).join(' ')];
    }
  }
  const chars = Array.from(trimmed);
  const n = chars.length;
  if (n < 6) return null;
  // Prefer semantic boundary on Chinese compound names
  const conj = chars.findIndex((c, i) => (c === '和' || c === '与') && i >= 2 && i <= n - 3);
  if (conj >= 0) return [chars.slice(0, conj + 1).join(''), chars.slice(conj + 1).join('')];

  const suf = trimmed.match(CJK_SUFFIX_RE);
  if (suf) {
    const splitAt = n - Array.from(suf[1]).length;
    if (splitAt >= 2 && n - splitAt >= 2 && Math.abs(splitAt - (n - splitAt)) <= 3) {
      return [chars.slice(0, splitAt).join(''), chars.slice(splitAt).join('')];
    }
  }
  const pre = trimmed.match(CJK_PREFIX_RE);
  if (pre) {
    const splitAt = Array.from(pre[1]).length;
    if (splitAt >= 2 && n - splitAt >= 2 && Math.abs(splitAt - (n - splitAt)) <= 3) {
      return [chars.slice(0, splitAt).join(''), chars.slice(splitAt).join('')];
    }
  }
  const mid = Math.ceil(n / 2);
  return [chars.slice(0, mid).join(''), chars.slice(mid).join('')];
}

/* ------------------------------------------------------------------ */
/* Scenario hierarchy & contiguous domestic grouping                  */
/* ------------------------------------------------------------------ */

const hierarchyCache = new WeakMap<ScenarioData, UnitHierarchy>();

function bboxClose(a: [[number, number], [number, number]], b: [[number, number], [number, number]], pad: number): boolean {
  const lonOverlap =
    (a[0][0] - pad <= b[1][0] && b[0][0] - pad <= a[1][0]) ||
    (a[0][0] - pad + 360 <= b[1][0] && b[0][0] - pad <= a[1][0] + 360);
  return lonOverlap && a[0][1] - pad <= b[1][1] && b[0][1] - pad <= a[1][1];
}

function polygonsTouch(polysA: Position[][][], polysB: Position[][][], tolDeg: number): boolean {
  const tol2 = tolDeg * tolDeg;
  const ptsA: Position[] = [];
  for (const poly of polysA) {
    const outer = poly[0];
    if (!outer) continue;
    const step = Math.max(1, Math.floor(outer.length / 80));
    for (let i = 0; i < outer.length; i += step) ptsA.push(outer[i]);
  }
  for (const poly of polysB) {
    const outer = poly[0];
    if (!outer) continue;
    const step = Math.max(1, Math.floor(outer.length / 80));
    for (let j = 0; j < outer.length; j += step) {
      const q = outer[j];
      for (let i = 0; i < ptsA.length; i++) {
        const p = ptsA[i];
        let dx = Math.abs(p[0] - q[0]);
        if (dx > 180) dx = 360 - dx;
        const dy = p[1] - q[1];
        if (dx * dx + dy * dy <= tol2) return true;
      }
    }
  }
  return false;
}

function buildHierarchy(atlas: ScenarioData): UnitHierarchy {
  const cached = hierarchyCache.get(atlas);
  if (cached) return cached;

  const facesByUnit = new Map<string, FaceFeature[]>();
  const childrenByUnit = new Map<string, PoliticalUnit[]>();
  const ownArea = new Map<string, number>();
  const polygonsByUnit = new Map<string, Position[][][]>();
  const polyAreasByUnit = new Map<string, number[]>();
  const faceBbox = new Map<string, [[number, number], [number, number]]>();

  for (const u of Object.values(atlas.units)) {
    if (u.parent) {
      let arr = childrenByUnit.get(u.parent);
      if (!arr) { arr = []; childrenByUnit.set(u.parent, arr); }
      arr.push(u);
    }
  }
  for (const f of atlas.faces) {
    const uid = f.properties.unit;
    let arr = facesByUnit.get(uid);
    if (!arr) { arr = []; facesByUnit.set(uid, arr); }
    arr.push(f);
    ownArea.set(uid, (ownArea.get(uid) ?? 0) + geoArea(f));
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let pArr = polygonsByUnit.get(uid);
    if (!pArr) { pArr = []; polygonsByUnit.set(uid, pArr); }
    pArr.push(...polys);
    let aArr = polyAreasByUnit.get(uid);
    if (!aArr) { aArr = []; polyAreasByUnit.set(uid, aArr); }
    for (const p of polys) aArr.push(geoArea({ type: 'Polygon', coordinates: p }));
  }
  for (const [uid, faces] of facesByUnit) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of faces) {
      const b = geoBounds(f);
      if (b[0][0] < minX) minX = b[0][0];
      if (b[0][1] < minY) minY = b[0][1];
      if (b[1][0] > maxX) maxX = b[1][0];
      if (b[1][1] > maxY) maxY = b[1][1];
    }
    faceBbox.set(uid, [[minX, minY], [maxX, maxY]]);
  }

  // Precompute contiguous domestic descendants that merge into a parent at overview zoom
  const mergedChildren = new Map<string, string[]>();
  const mergedSubUnits = new Map<string, Set<string>>();
  const labelZoomByUnit = new Map<string, number>();
  for (const l of atlas.labels) {
    if (l.kind === 'name' && !labelZoomByUnit.has(l.unit)) labelZoomByUnit.set(l.unit, l.zoom);
  }

  const recordAncestry = (rootId: string, included: string[]) => {
    if (!included.length) return;
    mergedChildren.set(rootId, included);
    const set = new Set<string>();
    for (const cid of included) {
      let cur: string | null = cid;
      while (cur && cur !== rootId) {
        set.add(cur);
        cur = atlas.units[cur]?.parent ?? null;
      }
    }
    mergedSubUnits.set(rootId, set);
  };

  for (const u of Object.values(atlas.units)) {
    const area = ownArea.get(u.id) ?? 0;
    if (area < 1e-5) {
      // Container unit: collect all descendant units except independent headline subtrees
      const included: string[] = [];
      const stack = [...(childrenByUnit.get(u.id) ?? [])];
      while (stack.length) {
        const child = stack.pop()!;
        const cZoom = labelZoomByUnit.get(child.id) ?? 99;
        if (cZoom <= 1) continue; // independent headline subtree (e.g. OM inside QING, NWD inside USA)
        if ((ownArea.get(child.id) ?? 0) >= 1e-5) included.push(child.id);
        for (const gc of childrenByUnit.get(child.id) ?? []) stack.push(gc);
      }
      recordAncestry(u.id, included);
    } else if (u.id !== 'RUS') {
      // Homeland unit: BFS contiguous domestic subdivisions within 0.25 deg of largest face
      const ownPolys = polygonsByUnit.get(u.id);
      const ownBox = faceBbox.get(u.id);
      if (!ownPolys || !ownBox) continue;
      // Use largest own polygon as seed so overseas specks don't bridge colonies
      let bestPoly = ownPolys[0], bestA = 0;
      const ownAreas = polyAreasByUnit.get(u.id) ?? [];
      for (let i = 0; i < ownPolys.length; i++) {
        const a = ownAreas[i] ?? 0;
        if (a > bestA) { bestA = a; bestPoly = ownPolys[i]; }
      }
      const seedBox = geoBounds({ type: 'Polygon', coordinates: bestPoly });
      const frontierPolys: Position[][][] = [bestPoly];
      const frontierBoxes: [[number, number], [number, number]][] = [seedBox];
      const included: string[] = [];
      const visited = new Set<string>([u.id]);

      // Collect non-colonial descendant faces (stopping at independent headline subtrees)
      const candidates: PoliticalUnit[] = [];
      const queue = [...(childrenByUnit.get(u.id) ?? [])];
      while (queue.length) {
        const c = queue.pop()!;
        const cZoom = labelZoomByUnit.get(c.id) ?? 99;
        if (cZoom <= 1 || COLONIAL_STATUS.has(c.status)) continue;
        if ((ownArea.get(c.id) ?? 0) >= 1e-5) candidates.push(c);
        for (const gc of childrenByUnit.get(c.id) ?? []) queue.push(gc);
      }
      let added = true;
      while (added) {
        added = false;
        for (const c of candidates) {
          if (visited.has(c.id)) continue;
          const cPolys = polygonsByUnit.get(c.id);
          const cBox = faceBbox.get(c.id);
          if (!cPolys || !cBox) continue;
          const nearBox = frontierBoxes.some((fb) => bboxClose(fb, cBox, 0.4));
          if (nearBox && polygonsTouch(frontierPolys, cPolys, 0.25)) {
            visited.add(c.id);
            included.push(c.id);
            frontierPolys.push(...cPolys);
            frontierBoxes.push(cBox);
            added = true;
          }
        }
      }
      recordAncestry(u.id, included);
    }
  }

  const res: UnitHierarchy = {
    facesByUnit,
    childrenByUnit,
    ownArea,
    polygonsByUnit,
    polyAreasByUnit,
    faceBbox,
    mergedChildren,
    mergedSubUnits,
    nameZoom: labelZoomByUnit,
    mergeState: null,
  };
  hierarchyCache.set(atlas, res);
  return res;
}

function getMergeState(atlas: ScenarioData, zoom: number) {
  const h = buildHierarchy(atlas);
  if (h.mergeState && h.mergeState.zoom === zoom) return h.mergeState;

  const merged = new Map<string, boolean>();
  const hidden = new Set<string>();
  for (const [uid, children] of h.mergedChildren) {
    let doMerge = true;
    if ((h.ownArea.get(uid) ?? 0) >= 1e-5) {
      for (const cid of children) {
        let cur: string | null = cid;
        while (cur && cur !== uid) {
          const z = h.nameZoom.get(cur);
          if (z !== undefined && z <= zoom && !CONCESSION_STATUS.has(atlas.units[cur]?.status ?? '')) {
            doMerge = false;
            break;
          }
          cur = atlas.units[cur]?.parent ?? null;
        }
        if (!doMerge) break;
      }
    }
    merged.set(uid, doMerge);
    if (doMerge) {
      for (const sub of h.mergedSubUnits.get(uid) ?? []) hidden.add(sub);
    }
  }
  h.mergeState = { zoom, merged, hidden };
  return h.mergeState;
}

export function shouldMergeDomestic(atlas: ScenarioData, unitId: string, zoom: number): boolean {
  const h = buildHierarchy(atlas);
  if ((h.ownArea.get(unitId) ?? 0) < 1e-5) return true;
  return getMergeState(atlas, zoom).merged.get(unitId) ?? false;
}

export function isMergedChildHidden(atlas: ScenarioData, unitId: string, zoom: number): boolean {
  return getMergeState(atlas, zoom).hidden.has(unitId);
}

export function isContainerUnit(atlas: ScenarioData, unitId: string): boolean {
  return (buildHierarchy(atlas).ownArea.get(unitId) ?? 0) < 1e-5;
}

function unitPolygons(
  atlas: ScenarioData,
  unitId: string,
  merged: boolean,
): { polygons: Position[][][]; polyAreas: number[]; ownCount: number; areaSr: number } {
  const h = buildHierarchy(atlas);
  const polygons: Position[][][] = [];
  const polyAreas: number[] = [];
  let areaSr = 0;
  const isContainer = (h.ownArea.get(unitId) ?? 0) < 1e-5;
  if (!isContainer) {
    polygons.push(...(h.polygonsByUnit.get(unitId) ?? []));
    polyAreas.push(...(h.polyAreasByUnit.get(unitId) ?? []));
    areaSr += h.ownArea.get(unitId) ?? 0;
  }
  const ownCount = polygons.length;
  if (merged || isContainer) {
    for (const cid of h.mergedChildren.get(unitId) ?? []) {
      polygons.push(...(h.polygonsByUnit.get(cid) ?? []));
      polyAreas.push(...(h.polyAreasByUnit.get(cid) ?? []));
      areaSr += h.ownArea.get(cid) ?? 0;
    }
  }
  return { polygons, polyAreas, ownCount, areaSr };
}

/* ------------------------------------------------------------------ */
/* Local Spherical Azimuthal Equidistant Projection                   */
/* ------------------------------------------------------------------ */

function sphericalMean(poly: Position[][]): [number, number] {
  const outer = poly[0];
  let sx = 0, sy = 0, sz = 0;
  const step = Math.max(1, Math.floor(outer.length / 240));
  for (let i = 0; i < outer.length; i += step) {
    const lon = outer[i][0] * RAD;
    const lat = outer[i][1] * RAD;
    const cl = Math.cos(lat);
    sx += cl * Math.cos(lon);
    sy += cl * Math.sin(lon);
    sz += Math.sin(lat);
  }
  const len = Math.hypot(sx, sy, sz) || 1;
  return [Math.atan2(sy, sx) * DEG, Math.asin(Math.max(-1, Math.min(1, sz / len))) * DEG];
}

function azimuthalForward(lon0Deg: number, lat0Deg: number, lonDeg: number, latDeg: number): Pt {
  const lon0 = lon0Deg * RAD, lat0 = lat0Deg * RAD;
  const lon = lonDeg * RAD, lat = latDeg * RAD;
  const dLon = lon - lon0;
  const sin0 = Math.sin(lat0), cos0 = Math.cos(lat0);
  const sin1 = Math.sin(lat), cos1 = Math.cos(lat);
  const cosD = Math.cos(dLon);
  const cosC = Math.max(-1, Math.min(1, sin0 * sin1 + cos0 * cos1 * cosD));
  const c = Math.acos(cosC);
  if (c < 1e-9) return { x: 0, y: 0 };
  const sinC = Math.sin(c);
  const k = sinC > 1e-9 ? c / sinC : 1;
  return {
    x: k * cos1 * Math.sin(dLon),
    y: -k * (cos0 * sin1 - sin0 * cos1 * cosD),
  };
}

function azimuthalInverse(lon0Deg: number, lat0Deg: number, x: number, y: number): [number, number] {
  const c = Math.hypot(x, y);
  if (c < 1e-9) return [lon0Deg, lat0Deg];
  const lon0 = lon0Deg * RAD, lat0 = lat0Deg * RAD;
  const sin0 = Math.sin(lat0), cos0 = Math.cos(lat0);
  const sinC = Math.sin(c), cosC = Math.cos(c);
  const north = -y;
  const lat = Math.asin(Math.max(-1, Math.min(1, cosC * sin0 + (north * sinC * cos0) / c)));
  const lon = lon0 + Math.atan2(x * sinC, c * cos0 * cosC - north * sin0 * sinC);
  let lonDeg = lon * DEG;
  while (lonDeg > 180) lonDeg -= 360;
  while (lonDeg < -180) lonDeg += 360;
  return [lonDeg, lat * DEG];
}

/* ------------------------------------------------------------------ */
/* Grid rasterization, connected components & 2-pass EDT              */
/* ------------------------------------------------------------------ */

function rasterizePolygons(
  ringsList: Pt[][][],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  cols: number,
  rows: number,
): Uint8Array {
  const grid = new Uint8Array(cols * rows);
  const spanX = maxX - minX, spanY = maxY - minY;
  if (!(spanX > 0 && spanY > 0)) return grid;
  const polyGrid = new Uint8Array(cols * rows);
  const xs: number[] = [];

  for (const poly of ringsList) {
    polyGrid.fill(0);
    // Compute local y range to avoid scanning empty rows
    let pMinY = rows - 1, pMaxY = 0;
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const gy = ((ring[i].y - minY) / spanY) * rows - 0.5;
        if (gy < pMinY) pMinY = Math.floor(gy);
        if (gy > pMaxY) pMaxY = Math.ceil(gy);
      }
    }
    const y0 = Math.max(0, pMinY), y1 = Math.min(rows - 1, pMaxY);
    for (let r = y0; r <= y1; r++) {
      const sy = minY + ((r + 0.5) / rows) * spanY;
      xs.length = 0;
      for (const ring of poly) {
        const n = ring.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const a = ring[j], b = ring[i];
          if ((a.y <= sy && b.y > sy) || (b.y <= sy && a.y > sy)) {
            xs.push(a.x + ((sy - a.y) * (b.x - a.x)) / (b.y - a.y));
          }
        }
      }
      if (xs.length < 2) continue;
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const cStart = Math.max(0, Math.ceil(((xs[k] - minX) / spanX) * cols - 0.5));
        const cEnd = Math.min(cols - 1, Math.floor(((xs[k + 1] - minX) / spanX) * cols - 0.5));
        const off = r * cols;
        for (let c = cStart; c <= cEnd; c++) polyGrid[off + c] ^= 1;
      }
    }
    for (let i = 0; i < grid.length; i++) if (polyGrid[i]) grid[i] = 1;
  }
  return grid;
}

function keepLargestComponent(grid: Uint8Array, cols: number, rows: number): Uint8Array {
  const n = cols * rows;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  let bestCells: number[] = [];

  for (let i = 0; i < n; i++) {
    if (!grid[i] || seen[i]) continue;
    let head = 0, tail = 0;
    queue[tail++] = i;
    seen[i] = 1;
    const comp: number[] = [];
    while (head < tail) {
      const cur = queue[head++];
      comp.push(cur);
      const cx = cur % cols, cy = (cur / cols) | 0;
      if (cx > 0 && grid[cur - 1] && !seen[cur - 1]) { seen[cur - 1] = 1; queue[tail++] = cur - 1; }
      if (cx + 1 < cols && grid[cur + 1] && !seen[cur + 1]) { seen[cur + 1] = 1; queue[tail++] = cur + 1; }
      if (cy > 0 && grid[cur - cols] && !seen[cur - cols]) { seen[cur - cols] = 1; queue[tail++] = cur - cols; }
      if (cy + 1 < rows && grid[cur + cols] && !seen[cur + cols]) { seen[cur + cols] = 1; queue[tail++] = cur + cols; }
    }
    if (comp.length > bestCells.length) bestCells = comp;
  }

  const out = new Uint8Array(n);
  for (let i = 0; i < bestCells.length; i++) out[bestCells[i]] = 1;
  return out;
}

function morphDisk(grid: Uint8Array, cols: number, rows: number, radius: number, dilate: boolean): Uint8Array {
  const out = new Uint8Array(cols * rows);
  const r2 = radius * radius;
  const offsets: [number, number][] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) offsets.push([dx, dy]);
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let match = !dilate;
      for (let k = 0; k < offsets.length; k++) {
        const nx = x + offsets[k][0], ny = y + offsets[k][1];
        const val = nx >= 0 && nx < cols && ny >= 0 && ny < rows ? grid[ny * cols + nx] : 0;
        if (dilate ? val === 1 : val === 0) { match = dilate; break; }
      }
      out[y * cols + x] = match ? 1 : 0;
    }
  }
  return out;
}

function edt1d(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e12;
  z[1] = 1e12;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e12;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const diff = q - v[k];
    d[q] = diff * diff + f[v[k]];
  }
}

/** Exact 2D Euclidean Distance Transform with 1-cell zero padding outside grid edges. */
function computeEDT(grid: Uint8Array, cols: number, rows: number): Float32Array {
  const pw = cols + 2, ph = rows + 2;
  const f = new Float32Array(pw * ph);
  const INF = 1e9;
  for (let y = 0; y < rows; y++) {
    const gOff = y * cols, fOff = (y + 1) * pw + 1;
    for (let x = 0; x < cols; x++) f[fOff + x] = grid[gOff + x] ? INF : 0;
  }
  const maxDim = Math.max(pw, ph);
  const colF = new Float32Array(maxDim), rowF = new Float32Array(maxDim);
  const d = new Float32Array(maxDim), v = new Int32Array(maxDim), z = new Float32Array(maxDim + 1);

  for (let x = 0; x < pw; x++) {
    for (let y = 0; y < ph; y++) colF[y] = f[y * pw + x];
    edt1d(colF, ph, d, v, z);
    for (let y = 0; y < ph; y++) f[y * pw + x] = d[y];
  }
  for (let y = 0; y < ph; y++) {
    const off = y * pw;
    for (let x = 0; x < pw; x++) rowF[x] = f[off + x];
    edt1d(rowF, pw, d, v, z);
    for (let x = 0; x < pw; x++) f[off + x] = d[x];
  }
  const dt = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const dOff = y * cols, fOff = (y + 1) * pw + 1;
    for (let x = 0; x < cols; x++) dt[dOff + x] = Math.sqrt(f[fOff + x]);
  }
  return dt;
}

function sampleDT(dt: Float32Array, cols: number, rows: number, gx: number, gy: number): number {
  if (gx < 0 || gy < 0 || gx > cols - 1 || gy > rows - 1) return 0;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
  const fx = gx - x0, fy = gy - y0;
  const a = dt[y0 * cols + x0], b = dt[y0 * cols + x1];
  const c = dt[y1 * cols + x0], d = dt[y1 * cols + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/* ------------------------------------------------------------------ */
/* Smooth single-arch Quadratic Bezier spine extractor                */
/* ------------------------------------------------------------------ */

interface RidgeNode { x: number; y: number; d: number }

function fitQuadraticBezier(pts: RidgeNode[]): [Pt, Pt, Pt] {
  const p0: Pt = { x: pts[0].x, y: pts[0].y };
  const p2: Pt = { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
  const mid: Pt = { x: (p0.x + p2.x) * 0.5, y: (p0.y + p2.y) * 0.5 };
  if (pts.length < 3) return [p0, mid, p2];

  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1];
  if (total < 1e-6) return [p0, mid, p2];

  let denom = 0, numX = 0, numY = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const t = cum[i] / total, mt = 1 - t;
    const w = 2 * t * mt;
    const rx = pts[i].x - mt * mt * p0.x - t * t * p2.x;
    const ry = pts[i].y - mt * mt * p0.y - t * t * p2.y;
    numX += w * rx;
    numY += w * ry;
    denom += w * w;
  }
  let p1 = denom > 1e-6 ? { x: numX / denom, y: numY / denom } : mid;

  const dx = p2.x - p0.x, dy = p2.y - p0.y;
  const chord = Math.hypot(dx, dy);
  if (chord > 1e-6) {
    const ex = dx / chord, ey = dy / chord;
    const nx = -ey, ny = ex;
    const ox = p1.x - mid.x, oy = p1.y - mid.y;
    const at = Math.max(-0.14 * chord, Math.min(0.14 * chord, ox * ex + oy * ey));
    const an = Math.max(-0.34 * chord, Math.min(0.34 * chord, ox * nx + oy * ny));
    p1 = { x: mid.x + at * ex + an * nx, y: mid.y + at * ey + an * ny };
  }
  return [p0, p1, p2];
}

function evalBezier(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

function extractSmoothBezierFromGrid(
  grid: Uint8Array,
  cols: number,
  rows: number,
  minX: number,
  minY: number,
  cell: number,
  preferHorizontal = false,
): { points: Pt[]; halfWidth: number } | null {
  const dt = computeEDT(grid, cols, rows);
  let px = cols * 0.5, py = rows * 0.5, rPeak = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const d = dt[y * cols + x];
      if (d > rPeak) { rPeak = d; px = x; py = y; }
    }
  }
  if (rPeak < 0.75) return null;

  const diag = Math.hypot(cols, rows);
  const maxSteps = Math.ceil(diag * 0.65);
  const maxStepT = Math.max(2.6, rPeak * 0.5);
  const minDStop = Math.max(0.85, rPeak * 0.22);

  let bestScore = -1;
  let bestNodes: RidgeNode[] | null = null;

  const march = (ux: number, uy: number, vx: number, vy: number, dir: 1 | -1): RidgeNode[] => {
    const nodes: RidgeNode[] = [];
    let tCur = 0;
    for (let step = 1; step <= maxSteps; step++) {
      const s = dir * step;
      const sx = px + s * ux, sy = py + s * uy;
      let peakD = 0, peakT = tCur;
      const tSpan = Math.max(maxStepT, rPeak * 0.8);
      for (let t = tCur - tSpan; t <= tCur + tSpan; t += 0.7) {
        const d = sampleDT(dt, cols, rows, sx + t * vx, sy + t * vy);
        if (d > peakD) { peakD = d; peakT = t; }
      }
      if (peakD < minDStop) break;
      // Smooth dt^2 centroid around the local peak
      let wSum = 0, tSum = 0;
      const band = Math.max(1.5, peakD * 0.55);
      for (let t = peakT - band; t <= peakT + band; t += 0.5) {
        const d = sampleDT(dt, cols, rows, sx + t * vx, sy + t * vy);
        if (d > peakD * 0.5) {
          const w = d * d;
          wSum += w;
          tSum += w * t;
        }
      }
      tCur = wSum > 0 ? tSum / wSum : peakT;
      nodes.push({
        x: sx + tCur * vx,
        y: sy + tCur * vy,
        d: sampleDT(dt, cols, rows, sx + tCur * vx, sy + tCur * vy),
      });
    }
    return nodes;
  };

  for (let m = 0; m < 12; m++) {
    const theta = (m * Math.PI) / 12;
    const ux = Math.cos(theta), uy = Math.sin(theta);
    if (preferHorizontal && Math.abs(ux) < 0.7) continue;
    const vx = -uy, vy = ux;
    const neg = march(ux, uy, vx, vy, -1).reverse();
    const pos = march(ux, uy, vx, vy, 1);
    const idx0 = neg.length;
    const ridge: RidgeNode[] = [...neg, { x: px, y: py, d: rPeak }, ...pos];
    if (ridge.length < 3) continue;

    // Prefix cumulative lengths & stride candidate endpoints for speed
    const cum = new Float32Array(ridge.length);
    for (let i = 1; i < ridge.length; i++) {
      cum[i] = cum[i - 1] + Math.hypot(ridge[i].x - ridge[i - 1].x, ridge[i].y - ridge[i - 1].y);
    }
    const aIndices: number[] = [];
    const bIndices: number[] = [];
    const stepA = Math.max(1, Math.floor((idx0 + 1) / 8));
    const stepB = Math.max(1, Math.floor((ridge.length - idx0) / 8));
    for (let a = 0; a <= idx0; a += stepA) aIndices.push(a);
    if (aIndices[aIndices.length - 1] !== idx0) aIndices.push(idx0);
    for (let b = idx0; b < ridge.length; b += stepB) bIndices.push(b);
    if (bIndices[bIndices.length - 1] !== ridge.length - 1) bIndices.push(ridge.length - 1);

    for (const a of aIndices) {
      for (const b of bIndices) {
        if (b - a < 2) continue;
        const arcLen = cum[b] - cum[a];
        if (arcLen < 2.2) continue;
        let minD = Infinity, sumD = 0;
        for (let k = a; k <= b; k++) {
          const d = ridge[k].d;
          if (d < minD) minD = d;
          sumD += d;
        }
        const avgD = sumD / (b - a + 1);
        const effD = 0.65 * minD + 0.35 * avgD;
        const fitH = Math.min(effD * 1.9, arcLen * 0.28);
        const spanBonus = Math.pow(arcLen, 0.38);
        const coreBonus = Math.min(1, effD / (rPeak * 0.55));
        const dx = ridge[b].x - ridge[a].x, dy = ridge[b].y - ridge[a].y;
        const chord = Math.hypot(dx, dy) || 1;
        const cosA = dx / chord;
        if (preferHorizontal && cosA * cosA < 0.5) continue;
        const orientBonus = preferHorizontal ? 0.22 + 0.78 * cosA * cosA : 0.56 + 0.44 * cosA * cosA;
        const score = fitH * spanBonus * coreBonus * orientBonus;
        if (score > bestScore) {
          bestScore = score;
          bestNodes = ridge.slice(a, b + 1);
        }
      }
    }
  }

  if (!bestNodes) {
    // Tiny compact fallback: horizontal bar through Pole of Inaccessibility
    const halfSpan = Math.max(1.2, rPeak * 0.9);
    bestNodes = [
      { x: Math.max(0, px - halfSpan), y: py, d: rPeak },
      { x: px, y: py, d: rPeak },
      { x: Math.min(cols - 1, px + halfSpan), y: py, d: rPeak },
    ];
  }

  const [p0, p1Raw, p2] = fitQuadraticBezier(bestNodes);
  // Ensure fitted Bezier stays strictly inside polygon by damping normal sagitta if needed
  let p1 = p1Raw;
  let bestMinD = 0;
  for (const damp of [1, 0.6, 0.25, 0]) {
    const candP1 = {
      x: (p0.x + p2.x) * 0.5 + (p1Raw.x - (p0.x + p2.x) * 0.5) * damp,
      y: (p0.y + p2.y) * 0.5 + (p1Raw.y - (p0.y + p2.y) * 0.5) * damp,
    };
    let mD = Infinity;
    for (let i = 0; i <= 8; i++) {
      const pt = evalBezier(p0, candP1, p2, i / 8);
      const d = sampleDT(dt, cols, rows, pt.x, pt.y);
      if (d < mD) mD = d;
    }
    if (mD >= bestMinD) {
      bestMinD = mD;
      p1 = candP1;
      if (mD >= rPeak * 0.32) break;
    }
  }

  // Measure actual corridor half-width across the active label span t ∈ [0.15, 0.85]
  const midDs: number[] = [];
  for (let k = 0; k < 7; k++) {
    const t = 0.15 + (0.70 * k) / 6;
    const pt = evalBezier(p0, p1, p2, t);
    midDs.push(sampleDT(dt, cols, rows, pt.x, pt.y));
  }
  midDs.sort((a, b) => a - b);
  const corridorD = 0.55 * midDs[0] + 0.45 * midDs[3];

  const points: Pt[] = [];
  for (let i = 0; i <= 8; i++) {
    const pt = evalBezier(p0, p1, p2, i / 8);
    points.push({ x: minX + (pt.x + 0.5) * cell, y: minY + (pt.y + 0.5) * cell });
  }
  return { points, halfWidth: Math.max(0.5 * cell, corridorD * cell) };
}

/* ------------------------------------------------------------------ */
/* Geographic spine cache (lazy per unit)                             */
/* ------------------------------------------------------------------ */

const geoSpineCache = new WeakMap<ScenarioData, Map<string, GeoSpine | null>>();

export function getGeoSpine(atlas: ScenarioData, unitId: string, merged: boolean): GeoSpine | null {
  let cache = geoSpineCache.get(atlas);
  if (!cache) { cache = new Map(); geoSpineCache.set(atlas, cache); }
  const key = `${unitId}:${merged ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const spine = buildGeoSpine(atlas, unitId, merged);
  cache.set(key, spine);
  return spine;
}

function sphericalDistanceRad(a: [number, number], b: [number, number]): number {
  const latA = a[1] * RAD, latB = b[1] * RAD, dLon = (b[0] - a[0]) * RAD;
  const c = Math.max(-1, Math.min(1, Math.sin(latA) * Math.sin(latB) + Math.cos(latA) * Math.cos(latB) * Math.cos(dLon)));
  return Math.acos(c);
}

function buildGeoSpine(atlas: ScenarioData, unitId: string, merged: boolean): GeoSpine | null {
  const { polygons, polyAreas, ownCount, areaSr } = unitPolygons(atlas, unitId, merged);
  if (!polygons.length || areaSr <= 0) return null;

  // Largest component (areas cached per polygon in the hierarchy)
  let maxPolyIdx = 0;
  for (let i = 1; i < polyAreas.length; i++) if (polyAreas[i] > polyAreas[maxPolyIdx]) maxPolyIdx = i;
  const area0 = polyAreas[maxPolyIdx];
  if (area0 <= 0) return null;

  // Polar-cap check (Antarctica spans >300° longitude south of -60°)
  const mainPoly = polygons[maxPolyIdx];
  const mainBox = geoBounds({ type: 'Polygon', coordinates: mainPoly });
  if (mainBox[1][1] < -55 && mainBox[1][0] - mainBox[0][0] > 300) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const lon = -15 + t * 110;
      const lat = -79.5 + 3.0 * 4 * t * (1 - t);
      pts.push([lon, lat]);
    }
    return {
      points: pts,
      halfWidthRad: 0.125,
      areaSr,
      center: pts[4],
      bounds: [[-180, -90], [180, -60]],
      merged,
    };
  }

  const isMainlandDominant = area0 / areaSr >= 0.48;
  let center = sphericalMean(mainPoly);
  const kept: Position[][][] = [];
  const keptAreas: number[] = [];

  if (isMainlandDominant) {
    // Keep mainPoly, all contiguous merged-child faces, and touching own faces (drop disconnected islands)
    for (let i = 0; i < polygons.length; i++) {
      if (i === maxPolyIdx) {
        kept.push(polygons[i]);
        keptAreas.push(polyAreas[i]);
        continue;
      }
      if (i >= ownCount) {
        if (polyAreas[i] >= area0 * 0.005) {
          kept.push(polygons[i]);
          keptAreas.push(polyAreas[i]);
        }
        continue;
      }
      if (polyAreas[i] < area0 * 0.05) continue;
      const pBox = geoBounds({ type: 'Polygon', coordinates: polygons[i] });
      if (bboxClose(mainBox, pBox, 0.2) && polygonsTouch([mainPoly], [polygons[i]], 0.08)) {
        kept.push(polygons[i]);
        keptAreas.push(polyAreas[i]);
      }
    }
  } else {
    const maxDist = Math.max(0.18, 3.2 * Math.sqrt(areaSr));
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < polygons.length; i++) {
      if (polyAreas[i] < area0 * 0.04) continue;
      const m = sphericalMean(polygons[i]);
      if (i !== maxPolyIdx && sphericalDistanceRad(center, m) > maxDist) continue;
      kept.push(polygons[i]);
      keptAreas.push(polyAreas[i]);
      const cl = Math.cos(m[1] * RAD);
      sx += polyAreas[i] * cl * Math.cos(m[0] * RAD);
      sy += polyAreas[i] * cl * Math.sin(m[0] * RAD);
      sz += polyAreas[i] * Math.sin(m[1] * RAD);
    }
    const len = Math.hypot(sx, sy, sz);
    if (len > 0) center = [Math.atan2(sy, sx) * DEG, Math.asin(Math.max(-1, Math.min(1, sz / len))) * DEG];
  }
  if (!kept.length) kept.push(mainPoly);

  const [lon0, lat0] = center;
  const localPolys: Pt[][][] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let geoMinLon = Infinity, geoMinLat = Infinity, geoMaxLon = -Infinity, geoMaxLat = -Infinity;

  for (const poly of kept) {
    const lp: Pt[][] = [];
    for (const ring of poly) {
      const stride = Math.max(1, Math.floor(ring.length / 260));
      const lr: Pt[] = [];
      for (let i = 0; i < ring.length; i += stride) {
        const [lon, lat] = ring[i];
        if (lon < geoMinLon) geoMinLon = lon;
        if (lon > geoMaxLon) geoMaxLon = lon;
        if (lat < geoMinLat) geoMinLat = lat;
        if (lat > geoMaxLat) geoMaxLat = lat;
        const p = azimuthalForward(lon0, lat0, lon, lat);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        lr.push(p);
      }
      if (lr.length >= 3) lp.push(lr);
    }
    if (lp.length) localPolys.push(lp);
  }
  if (!(maxX > minX && maxY > minY)) return null;

  const pad = Math.max(maxX - minX, maxY - minY) * 0.04;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const spanX = maxX - minX, spanY = maxY - minY;
  const cell = Math.max(spanX, spanY) / 56;
  const cols = Math.max(8, Math.ceil(spanX / cell));
  const rows = Math.max(8, Math.ceil(spanY / cell));
  const gridMaxX = minX + cols * cell, gridMaxY = minY + rows * cell;

  let grid = rasterizePolygons(localPolys, minX, minY, gridMaxX, gridMaxY, cols, rows);

  if (isMainlandDominant) {
    grid = keepLargestComponent(grid, cols, rows);
  } else {
    let totalCount = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i]) totalCount++;
    const light = keepLargestComponent(
      morphDisk(morphDisk(grid, cols, rows, 1, true), cols, rows, 1, false),
      cols,
      rows,
    );
    let lightCount = 0;
    for (let i = 0; i < light.length; i++) if (light[i]) lightCount++;
    if (totalCount > 0 && lightCount / totalCount >= 0.55) {
      grid = light;
    } else {
      const closed = morphDisk(morphDisk(grid, cols, rows, 3, true), cols, rows, 2, false);
      grid = keepLargestComponent(closed, cols, rows);
    }
  }

  const extracted = extractSmoothBezierFromGrid(grid, cols, rows, minX, minY, cell);
  if (!extracted) return null;

  const geoPoints = extracted.points.map((p) => azimuthalInverse(lon0, lat0, p.x, p.y));
  return {
    points: geoPoints,
    halfWidthRad: extracted.halfWidth,
    areaSr,
    center: geoPoints[4],
    bounds: [[geoMinLon, geoMinLat], [geoMaxLon, geoMaxLat]],
    merged,
  };
}

/* ------------------------------------------------------------------ */
/* Dynamic viewport-clipped screen spine                              */
/* ------------------------------------------------------------------ */

function strideRing(ring: Position[], maxPts: number): Position[] {
  if (ring.length <= maxPts) return ring;
  const step = Math.ceil(ring.length / maxPts);
  const out: Position[] = [];
  for (let i = 0; i < ring.length - 1; i += step) out.push(ring[i]);
  out.push(ring[ring.length - 1]);
  if (out.length < 4) return ring;
  if (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1]) {
    out.push(out[0]);
  }
  return out;
}

function computeClippedScreenSpine(
  atlas: ScenarioData,
  unitId: string,
  merged: boolean,
  proj: GeoProjection,
  viewBounds: [number, number, number, number], // [vx0, vy0, vx1, vy1]
  preview: boolean,
): ScreenSpine | null {
  const { polygons, polyAreas, areaSr } = unitPolygons(atlas, unitId, merged);
  if (!polygons.length || areaSr <= 0) return null;

  const [vx0, vy0, vx1, vy1] = viewBounds;
  if (!(vx1 - vx0 > 10 && vy1 - vy0 > 10)) return null;

  const maxA = Math.max(...polyAreas);
  const maxRingPts = preview ? 36 : 96;
  const screenPolys: Pt[][][] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  let curRings: Pt[][] = [];
  let curRing: Pt[] = [];
  const collector = {
    beginPath() {},
    moveTo(x: number, y: number) {
      if (curRing.length >= 3) curRings.push(curRing);
      curRing = [{ x, y }];
    },
    lineTo(x: number, y: number) {
      curRing.push({ x, y });
    },
    closePath() {
      if (curRing.length >= 3) curRings.push(curRing);
      curRing = [];
    },
  };
  const pathGen = geoPath(proj, collector as never);

  for (let pi = 0; pi < polygons.length; pi++) {
    if (polyAreas[pi] < maxA * 0.04) continue;
    const poly = polygons[pi];
    const strided: Position[][] = [];
    for (let ri = 0; ri < poly.length; ri++) {
      if (ri > 0 && poly[ri].length < 8) continue;
      strided.push(strideRing(poly[ri], maxRingPts));
    }
    curRings = [];
    curRing = [];
    pathGen({ type: 'Polygon', coordinates: strided });
    if (curRing.length >= 3) curRings.push(curRing);
    if (!curRings.length) continue;

    for (const r of curRings) {
      for (const p of r) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    screenPolys.push(curRings);
  }
  if (!screenPolys.length) return null;

  const cx0 = Math.max(vx0, minX), cy0 = Math.max(vy0, minY);
  const cx1 = Math.min(vx1, maxX), cy1 = Math.min(vy1, maxY);
  const spanX = cx1 - cx0, spanY = cy1 - cy0;
  if (!(spanX > 12 && spanY > 12)) return null;

  const N = preview ? 20 : 44;
  const cell = Math.max(spanX, spanY) / N;
  const cols = Math.max(6, Math.ceil(spanX / cell));
  const rows = Math.max(6, Math.ceil(spanY / cell));
  const gridCx1 = cx0 + cols * cell, gridCy1 = cy0 + rows * cell;
  let grid = rasterizePolygons(screenPolys, cx0, cy0, gridCx1, gridCy1, cols, rows);
  grid = keepLargestComponent(grid, cols, rows);

  let fillCount = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i]) fillCount++;
  const areaPx = fillCount * cell * cell;
  if (areaPx < 60) return null;

  const clippedByVerticalEdge = minX <= vx0 + 8 || maxX >= vx1 - 8;
  const extracted = extractSmoothBezierFromGrid(grid, cols, rows, cx0, cy0, cell, clippedByVerticalEdge);
  if (!extracted) return null;

  return { points: extracted.points, halfWidthPx: extracted.halfWidth, areaPx };
}

/* ------------------------------------------------------------------ */
/* Curved arc-length placement, adaptive sizing, wrap & avoidance     */
/* ------------------------------------------------------------------ */

function wrapAngleDelta(a: number, ref: number): number {
  let d = a - ref;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function normalizeSpineOrder(pts: Pt[]): Pt[] {
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const reverse = Math.abs(dx) >= Math.abs(dy) * 0.34 ? dx < 0 : dy < 0;
  return reverse ? [...pts].reverse() : pts;
}

function sampleBezierLUT(p0: Pt, p1: Pt, p2: Pt, steps = 32) {
  const pts: Pt[] = [];
  const cum = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const p = evalBezier(p0, p1, p2, i / steps);
    pts.push(p);
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
  }
  const total = cum[steps];
  function atArc(s: number): Pt {
    if (s <= 0) return pts[0];
    if (s >= total) return pts[steps];
    let lo = 0, hi = steps;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    const seg = cum[hi] - cum[lo];
    const f = seg > 1e-6 ? (s - cum[lo]) / seg : 0;
    return {
      x: pts[lo].x + (pts[hi].x - pts[lo].x) * f,
      y: pts[lo].y + (pts[hi].y - pts[lo].y) * f,
    };
  }
  return { total, atArc };
}

/** Trim longest contiguous run when projection wraps across ±180° or globe horizon. */
function projectSpineSegment(
  geoPts: [number, number][],
  projectPoint: (lon: number, lat: number) => [number, number] | undefined,
  maxJump: number,
): Pt[] | null {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  for (const [lon, lat] of geoPts) {
    const p = projectPoint(lon, lat);
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
      continue;
    }
    const pt = { x: p[0], y: p[1] };
    if (cur.length && Math.hypot(pt.x - cur[cur.length - 1].x, pt.y - cur[cur.length - 1].y) > maxJump) {
      if (cur.length >= 2) runs.push(cur);
      cur = [pt];
    } else {
      cur.push(pt);
    }
  }
  if (cur.length >= 2) runs.push(cur);
  if (!runs.length) return null;
  let best = runs[0];
  for (let i = 1; i < runs.length; i++) if (runs[i].length > best.length) best = runs[i];
  return best.length >= 2 ? best : null;
}

function fitRightSideUpBezier(rawPts: Pt[]): [Pt, Pt, Pt, number] {
  const ordered = normalizeSpineOrder(rawPts);
  const nodes: RidgeNode[] = ordered.map((p) => ({ x: p.x, y: p.y, d: 1 }));
  const [p0, p1Raw, p2] = fitQuadraticBezier(nodes);
  const mid = { x: (p0.x + p2.x) * 0.5, y: (p0.y + p2.y) * 0.5 };
  const chordAngle = Math.atan2(p2.y - p0.y, p2.x - p0.x) * DEG;
  let p1 = p1Raw;

  // Dampen curvature so every tangent remains smoothly aligned with chord reading order
  for (const damp of [1, 0.7, 0.4, 0.15, 0]) {
    p1 = { x: mid.x + (p1Raw.x - mid.x) * damp, y: mid.y + (p1Raw.y - mid.y) * damp };
    let ok = true;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const tx = 2 * (1 - t) * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
      const ty = 2 * (1 - t) * (p1.y - p0.y) + 2 * t * (p2.y - p1.y);
      const rawAng = Math.atan2(ty, tx) * DEG;
      const delta = wrapAngleDelta(rawAng, chordAngle);
      const unwrapped = chordAngle + delta;
      if (Math.abs(delta) > 35 || unwrapped < -86 || unwrapped > 102) {
        ok = false;
        break;
      }
    }
    if (ok) break;
  }
  return [p0, p1, p2, chordAngle];
}

function computeLineMetrics(text: string, cjk: boolean, L: number, R: number, areaPx: number) {
  const chars = Array.from(text);
  const prelimWeight: 400 | 500 = 400;
  const advances = measureGlyphAdvances(chars, prelimWeight);
  const rawAdvanceSum = advances.reduce((s, a) => s + a, 0);
  const n = chars.length;

  const minTrack = cjk ? 0.08 : 0.03;
  const maxTrack = cjk
    ? (n <= 2 ? 0.72 : n <= 3 ? 0.62 : n <= 4 ? 0.50 : n <= 6 ? 0.36 : 0.24)
    : 0.28;

  const minEmSpan = Math.max(0.6, rawAdvanceSum + Math.max(0, n - 1) * minTrack);
  const byLength = (L * 0.86) / minEmSpan;
  const sqrtArea = Math.sqrt(Math.max(1, areaPx));
  // Allow skinny island/peninsula powers on world overview to remain crisp inside their spine
  const byWidth = Math.max(R * 1.45, Math.min(8.5, sqrtArea * 0.24));
  const charScale = n <= 2 ? 0.86 : n <= 3 ? 0.94 : 1.0;
  const byBalance = 1.08 * Math.pow(sqrtArea, 0.68) * charScale;

  const size = Math.min(byLength, byWidth, byBalance, 45);
  return { chars, advances, rawAdvanceSum, minTrack, maxTrack, size };
}

function resolveLineTracking(
  rawAdvanceSum: number,
  n: number,
  size: number,
  L: number,
  minTrack: number,
  maxTrack: number,
): number {
  const targetSpan = L * 0.72;
  const rawTracking = n > 1 ? (targetSpan / Math.max(1, size) - rawAdvanceSum) / (n - 1) : 0;
  return Math.max(minTrack, Math.min(maxTrack, rawTracking));
}

function placeLineOnBezier(
  chars: string[],
  advances: number[],
  rawAdvanceSum: number,
  size: number,
  minTrack: number,
  maxTrack: number,
  lut: ReturnType<typeof sampleBezierLUT>,
  chordAngle: number,
  normalShift: number,
  forcedTracking?: number,
): { glyphs: PlacedGlyph[]; circles: CollisionCircle[] } {
  const n = chars.length;
  const tracking = forcedTracking ?? resolveLineTracking(rawAdvanceSum, n, size, lut.total, minTrack, maxTrack);
  const emTotal = rawAdvanceSum + Math.max(0, n - 1) * tracking;
  const startS = (lut.total - emTotal * size) * 0.5;

  const glyphs: PlacedGlyph[] = [];
  let cursor = startS;
  for (let i = 0; i < n; i++) {
    const ch = chars[i];
    const w = advances[i] * size;
    const sMid = cursor + w * 0.5;
    cursor += w + tracking * size;
    if (ch === ' ') continue;

    const spanTan = Math.max(1.2, w * 0.36);
    const pA = lut.atArc(Math.max(0, sMid - spanTan));
    const pB = lut.atArc(Math.min(lut.total, sMid + spanTan));
    const dx = pB.x - pA.x, dy = pB.y - pA.y;
    const segLen = Math.hypot(dx, dy) || 1;
    const angle = chordAngle + wrapAngleDelta(Math.atan2(dy, dx) * DEG, chordAngle);
    const nx = -dy / segLen, ny = dx / segLen;
    const pC = lut.atArc(sMid);
    glyphs.push({
      letter: ch,
      x: pC.x + nx * normalShift,
      y: pC.y + ny * normalShift,
      angle,
    });
  }

  // Sample 3-5 collision circles evenly across the placed glyphs
  const circles: CollisionCircle[] = [];
  if (glyphs.length) {
    const count = Math.min(5, Math.max(2, glyphs.length));
    for (let k = 0; k < count; k++) {
      const idx = count === 1 ? 0 : Math.round((k * (glyphs.length - 1)) / (count - 1));
      circles.push({ x: glyphs[idx].x, y: glyphs[idx].y, r: size * 0.46 });
    }
  }
  return { glyphs, circles };
}

export function estimateProjectedAreaPx(
  atlas: ScenarioData,
  unitId: string,
  merged: boolean,
  proj: GeoProjection,
): number {
  const spine = getGeoSpine(atlas, unitId, merged);
  if (!spine) return 0;
  const r = proj.scale();
  return spine.areaSr * r * r;
}

export interface CountryLayoutOptions {
  atlas: ScenarioData;
  unitId: string;
  text: string;
  merged: boolean;
  proj: GeoProjection;
  projectPoint: (lon: number, lat: number) => [number, number] | undefined;
  viewBounds: [number, number, number, number];
  scaleFactor: number;
  preview: boolean;
  capitalStar?: Pt;
  clippedCache: Map<string, ScreenSpine | null>;
}

export function layoutCurvedCountryLabel(opts: CountryLayoutOptions): CurvedLabelLayout | null {
  const { atlas, unitId, text, merged, proj, projectPoint, viewBounds, scaleFactor, preview, capitalStar, clippedCache } = opts;
  const geoSpine = getGeoSpine(atlas, unitId, merged);
  if (!geoSpine) return null;

  const [vx0, vy0, vx1, vy1] = viewBounds;
  const vw = vx1 - vx0;
  const insetPad = Math.max(10, vw * 0.01);
  const ivx0 = vx0 + insetPad, ivy0 = vy0 + insetPad, ivx1 = vx1 - insetPad, ivy1 = vy1 - insetPad;

  // Check how many geographic spine samples project inside the padded viewport
  let insideCount = 0;
  for (const [lon, lat] of geoSpine.points) {
    const p = projectPoint(lon, lat);
    if (p && p[0] >= ivx0 && p[0] <= ivx1 && p[1] >= ivy0 && p[1] <= ivy1) insideCount++;
  }
  if (insideCount === 0 && geoSpine.areaSr < 0.01) {
    // Quick check for smaller territories completely outside the viewport
    let hits = false;
    const [[b0x, b0y], [b1x, b1y]] = geoSpine.bounds;
    for (const [lon, lat] of [[b0x, b0y], [b1x, b0y], [b1x, b1y], [b0x, b1y], geoSpine.center]) {
      const p = projectPoint(lon, lat);
      if (p && p[0] >= vx0 - 40 && p[0] <= vx1 + 40 && p[1] >= vy0 - 40 && p[1] <= vy1 + 40) {
        hits = true;
        break;
      }
    }
    if (!hits) return null;
  }

  let screenPts: Pt[] | null = null;
  let R = 0;
  let areaPx = 0;

  const needsClip = preview
    ? insideCount < 4 && geoSpine.areaSr >= 0.015
    : insideCount / geoSpine.points.length < 0.72;

  if (needsClip) {
    const cacheKey = `${unitId}:${merged ? 1 : 0}`;
    let clipped = clippedCache.get(cacheKey);
    if (clipped === undefined) {
      clipped = computeClippedScreenSpine(atlas, unitId, merged, proj, [ivx0, ivy0, ivx1, ivy1], preview);
      clippedCache.set(cacheKey, clipped);
    }
    if (clipped) {
      const fullAreaPx = geoSpine.areaSr * proj.scale() * proj.scale();
      if (clipped.areaPx < fullAreaPx * 0.22 && clipped.areaPx < 16000) return null;
      screenPts = clipped.points;
      R = clipped.halfWidthPx;
      areaPx = clipped.areaPx;
    } else if (insideCount < 3) {
      return null;
    }
  } else if (preview && insideCount < 2) {
    return null;
  }

  if (!screenPts) {
    screenPts = projectSpineSegment(geoSpine.points, projectPoint, vw * 0.35);
    if (!screenPts) return null;
    const scaleR = proj.scale();
    R = geoSpine.halfWidthRad * scaleR;
    areaPx = geoSpine.areaSr * scaleR * scaleR;
  }

  const [p0, p1, p2, chordAngle] = fitRightSideUpBezier(screenPts);
  const lut = sampleBezierLUT(p0, p1, p2, 32);
  const L = lut.total;
  if (L < 6) return null;

  const cjk = isCJKDominant(text);
  const single = computeLineMetrics(text, cjk, L, R, areaPx);
  let size = single.size * scaleFactor;

  // Test smart 2-line concentric curved wrap on compact territories with long names
  let lines: [string, string] | null = null;
  const charCount = Array.from(text).length;
  const longName = (cjk && charCount >= 7) || (!cjk && charCount >= 11 && text.includes(' ')) || /[（(].+[）)]/.test(text);
  if (longName && L / Math.max(1, 2 * R) < 2.4) {
    const split = splitTwoLines(text);
    if (split) {
      const m1 = computeLineMetrics(split[0], cjk, L, R, areaPx);
      const m2 = computeLineMetrics(split[1], cjk, L, R, areaPx);
      const twoSize = Math.min(m1.size, m2.size);
      if (twoSize >= single.size * 1.25 && 2.35 * twoSize <= 2 * R * 0.88) {
        lines = split;
        size = twoSize * scaleFactor;
      }
    }
  }

  const weight: 400 | 500 = size >= 20 ? 400 : 500;
  let glyphs: PlacedGlyph[];
  let circles: CollisionCircle[];

  if (lines) {
    const gap = size * 0.60;
    const m1 = computeLineMetrics(lines[0], cjk, L, R, areaPx);
    const m2 = computeLineMetrics(lines[1], cjk, L, R, areaPx);
    const adv1 = weight === 400 ? m1.advances : measureGlyphAdvances(m1.chars, weight);
    const adv2 = weight === 400 ? m2.advances : measureGlyphAdvances(m2.chars, weight);
    const t1 = resolveLineTracking(m1.rawAdvanceSum, m1.chars.length, size, L, m1.minTrack, m1.maxTrack);
    const t2 = resolveLineTracking(m2.rawAdvanceSum, m2.chars.length, size, L, m2.minTrack, m2.maxTrack);
    const sharedTrack = Math.min(t1, t2, cjk ? 0.28 : 0.22);
    const top = placeLineOnBezier(m1.chars, adv1, m1.rawAdvanceSum, size, m1.minTrack, m1.maxTrack, lut, chordAngle, -gap, sharedTrack);
    const bot = placeLineOnBezier(m2.chars, adv2, m2.rawAdvanceSum, size, m2.minTrack, m2.maxTrack, lut, chordAngle, gap, sharedTrack);
    glyphs = [...top.glyphs, ...bot.glyphs];
    circles = [...top.circles, ...bot.circles];
  } else {
    const adv = weight === 400 ? single.advances : measureGlyphAdvances(single.chars, weight);
    const placed = placeLineOnBezier(single.chars, adv, single.rawAdvanceSum, size, single.minTrack, single.maxTrack, lut, chordAngle, 0);
    glyphs = placed.glyphs;
    circles = placed.circles;
  }

  // Gentle normal nudge to avoid colliding with the country's own capital star
  if (capitalStar && glyphs.length) {
    const clearR = size * 0.56 + 6;
    const hitsStar = (dx: number, dy: number) =>
      glyphs.some((g) => Math.hypot(g.x + dx - capitalStar.x, g.y + dy - capitalStar.y) < clearR);
    if (hitsStar(0, 0)) {
      const chX = p2.x - p0.x, chY = p2.y - p0.y;
      const chL = Math.hypot(chX, chY) || 1;
      const nx = -chY / chL, ny = chX / chL;
      const step = Math.min(size * 0.72, Math.max(4, R * 0.35));
      for (const dir of [-1, 1]) {
        const dx = nx * step * dir, dy = ny * step * dir;
        if (!hitsStar(dx, dy)) {
          for (const g of glyphs) { g.x += dx; g.y += dy; }
          for (const c of circles) { c.x += dx; c.y += dy; }
          break;
        }
      }
    }
  }

  return { glyphs, circles, size, weight, areaPx };
}

export function scaleLayout(layout: CurvedLabelLayout, factor: number): CurvedLabelLayout {
  const cx = layout.glyphs.reduce((s, g) => s + g.x, 0) / Math.max(1, layout.glyphs.length);
  const cy = layout.glyphs.reduce((s, g) => s + g.y, 0) / Math.max(1, layout.glyphs.length);
  return {
    ...layout,
    size: layout.size * factor,
    glyphs: layout.glyphs.map((g) => ({ ...g, x: cx + (g.x - cx) * factor, y: cy + (g.y - cy) * factor })),
    circles: layout.circles.map((c) => ({ x: cx + (c.x - cx) * factor, y: cy + (c.y - cy) * factor, r: c.r * factor })),
  };
}

export function circlesCollide(a: CollisionCircle[], b: CollisionCircle[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const ca = a[i];
    for (let j = 0; j < b.length; j++) {
      const cb = b[j];
      const dx = ca.x - cb.x, dy = ca.y - cb.y;
      const r = ca.r + cb.r;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}
