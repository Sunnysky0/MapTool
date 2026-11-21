import { geoPath } from 'd3-geo';
import type { GeoJSON } from 'geojson';
import type { AtlasLayer, MapConfig, ScenarioData, HistoricalLabel, ReferenceLabel } from '../types';
import { ATLAS_STYLES } from '../lib/presets';
import { buildProjection, textureProjection, type TextureArea } from '../lib/projections';
import { tileCanvas, MapPath, type MapContext } from '../lib/canvas';
import { territoryColor } from './colors';
import {
  VIC3_FONT_STACK,
  circlesCollide,
  estimateProjectedAreaPx,
  isCJKDominant,
  isContainerUnit,
  isMergedChildHidden,
  layoutCurvedCountryLabel,
  measureGlyphAdvances,
  scaleLayout,
  shouldMergeDomestic,
  type CollisionCircle,
  type PlacedGlyph,
  type Pt,
} from './countryLabels';

const W = 1920;
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));

interface ProjectedPath {
  svg: () => string;
  canvas: () => Path2D;
}

type LabelPoint = {
  label: HistoricalLabel;
  x: number;
  y: number;
  reference?: ReferenceLabel;
  leader?: string;
};

function once<T>(build: () => T) {
  let value: T | undefined;
  return () => (value ??= build());
}

function sheetMargin(config: MapConfig) {
  return config.atlasSheet === 'europe' ? (W * 7.2) / 583.56 : config.atlasSheet === 'africa' ? W * 0.008 : 0;
}

function project(atlas: ScenarioData, config: MapConfig, preview: boolean, texture?: TextureArea, margin = 0) {
  const h = (W * config.height) / config.width;
  const baseInset = sheetMargin(config);
  const inset = margin ? -margin : baseInset;
  const proj = texture
    ? textureProjection(texture, W, h)
    : buildProjection(config.view, W, h).clipExtent([
        [inset, inset],
        [W - inset, h - inset],
      ]);
  if (preview) proj.precision(2);
  const path = geoPath(proj);

  function shape(geometry?: GeoJSON): ProjectedPath {
    const svg = once(() => (geometry ? path(geometry) ?? '' : ''));
    return {
      svg,
      canvas: once(() => {
        if (!preview) return new Path2D(svg());
        const native = new MapPath();
        if (geometry) geoPath(proj, native)(geometry);
        return native;
      }),
    };
  }

  let point: [number, number] | undefined;
  const sink = proj.stream({
    point(x, y) {
      point = [x, y];
    },
    lineStart() {},
    lineEnd() {},
    polygonStart() {},
    polygonEnd() {},
    sphere() {},
  });
  function projectPoint(lon: number, lat: number): [number, number] | undefined {
    point = undefined;
    sink.point(lon, lat);
    return point;
  }

  const tiers = config.view.zoom < 1.9 ? 1 : config.view.zoom < 2.4 ? 2 : 3;
  const clippedCache = new Map();

  return {
    proj,
    projectPoint,
    h,
    inset,
    baseInset,
    preview,
    clippedCache,
    faces: once(() => atlas.faces.map((f) => ({ unit: f.properties.unit, d: shape(f) }))),
    sovereignBorders: shape(atlas.sovereignBorders),
    adminBorders: shape(atlas.adminBorders),
    coastline: shape(atlas.coastline),
    claims: shape(atlas.claims),
    cityRivers: config.view.zoom >= 80 ? shape(atlas.cityRivers) : undefined,
    rivers: once(() => atlas.geography?.rivers.slice(0, tiers).map(shape) ?? []),
    lakes: once(() => atlas.geography?.lakes.slice(0, tiers).map(shape) ?? []),
    rails: atlas.geography && config.view.zoom >= 2.4 ? shape(atlas.geography.rails) : undefined,
    points: once(() => {
      const points: LabelPoint[] = [];
      const european = config.atlasSheet === 'europe' && config.view.zoom >= 2.4;
      for (const label of atlas.labels) {
        const reference = european && label.kind === 'name' ? atlas.europeanNames?.[label.unit] : undefined;
        const capitalSymbol = atlas.geography && label.kind === 'capital' && config.view.zoom >= 1.9;
        if (!reference && !capitalSymbol && label.zoom > config.view.zoom) continue;
        const at = projectPoint(...(reference?.at ?? label.at));
        if (at) {
          points.push({
            label,
            x: at[0],
            y: at[1],
            reference,
            leader: reference?.leader ? path({ type: 'LineString', coordinates: reference.leader }) ?? undefined : undefined,
          });
        }
      }
      return points;
    }),
    towns: once(() =>
      (atlas.geography?.towns ?? []).flatMap(([lon, lat, rank]) => {
        const at = projectPoint(lon, lat);
        return at ? [{ x: at[0], y: at[1], rank }] : [];
      }),
    ),
    islandLocators: once(() => {
      if (config.atlasSheet !== 'africa' || config.view.zoom >= 12) return [];
      return (atlas.geography?.africanIslands ?? []).flatMap(([lon, lat, owner]) => {
        const at = projectPoint(lon, lat);
        return at ? [{ x: at[0], y: at[1], owner }] : [];
      });
    }),
  };
}

const projections = new WeakMap<ScenarioData, { key: string; result: ReturnType<typeof project> }>();
function projected(atlas: ScenarioData, config: MapConfig, preview: boolean, texture?: TextureArea, margin = 0) {
  const key = JSON.stringify([config.view, config.height / config.width, config.atlasSheet, preview, texture, margin]);
  const last = projections.get(atlas);
  if (last?.key === key) return last.result;
  const result = project(atlas, config, preview, texture, margin);
  projections.set(atlas, { key, result });
  return result;
}

type Mark =
  | { type: 'fill'; d: ProjectedPath; color: string; id?: string; hatch?: boolean; alpha?: number }
  | { type: 'line'; d: ProjectedPath; color: string; width: number; dash: number[]; alpha?: number }
  | { type: 'symbol'; x: number; y: number; r: number; color: string; outline: string; star?: boolean }
  | {
      type: 'text';
      id: string;
      x: number;
      y: number;
      size: number;
      weight: 400 | 500;
      text: string;
      color: string;
      inkAlpha: number;
      haloAlpha: number;
      haloWidth: number;
      tracking?: number;
      glyphs?: PlacedGlyph[];
      leader?: [number, number];
      leaderPath?: string;
    };

function star(x: number, y: number, r: number) {
  const points = Array.from({ length: 10 }, (_, i) => {
    const a = (i * 0.2 - 0.5) * Math.PI;
    const distance = i % 2 === 0 ? r : r * 0.43;
    return [x + Math.cos(a) * distance, y + Math.sin(a) * distance].join(',');
  });
  return 'M' + points.join('L') + 'Z';
}

function haloMetrics(size: number, paper: boolean) {
  const haloWidth = paper
    ? Math.min(3.0, Math.max(0.8, size * 0.068))
    : Math.min(3.2, Math.max(0.85, size * 0.072));
  const haloAlpha = paper ? 0.46 : 0.62;
  return { haloWidth, haloAlpha };
}

function boxToCircles(cx: number, cy: number, w: number, h: number): CollisionCircle[] {
  const r = Math.max(4, h * 0.48);
  const count = Math.min(4, Math.max(1, Math.ceil(w / Math.max(8, r * 1.6))));
  if (count === 1) return [{ x: cx, y: cy, r: Math.max(r, w * 0.5) }];
  const span = Math.max(0, w - r * 1.4);
  const out: CollisionCircle[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1) - 0.5;
    out.push({ x: cx + t * span, y: cy, r });
  }
  return out;
}

function labelMarks(config: MapConfig, atlas: ScenarioData, geo: ReturnType<typeof project>, margin: number): Mark[] {
  const style = config.layers.historicalLabels;
  const modern = config.scenario?.revision === 2;
  const paper = modern ? config.atlasTheme === 'paper' : config.atlasTheme !== 'reference';
  const scaleFactor = (style.labelSize ?? 13) / 13;
  const minRequired = (isHeadline: boolean) => (isHeadline ? 5.1 : 6.4) * scaleFactor;
  const h = geo.h;
  const viewBounds: [number, number, number, number] = margin
    ? [geo.baseInset, geo.baseInset, W - geo.baseInset, h - geo.baseInset]
    : [geo.inset, geo.inset, W - geo.inset, h - geo.inset];

  const symbols: Mark[] = [];
  const words: Mark[] = [];
  const placedCircles: CollisionCircle[] = [];

  // Map visible capital star/symbol positions so curved country names avoid overlapping them
  const capitalStars = new Map<string, Pt>();
  if (config.layers.cities.visible && atlas.geography && config.view.zoom >= 1.9) {
    for (const p of geo.points()) {
      const unit = atlas.units[p.label.unit];
      if (
        p.label.kind === 'capital' &&
        (!unit.parent || ['BOH', 'IND', 'BAA', 'GEO', 'ARM', 'AZE'].includes(unit.id))
      ) {
        capitalStars.set(p.label.unit, { x: p.x, y: p.y });
      }
    }
  }

  // Count how many direct children of each container unit are eligible at this zoom
  const visibleChildrenCount = new Map<string, number>();
  if (config.view.zoom >= 3) {
    for (const l of atlas.labels) {
      if (l.kind !== 'name' || l.zoom > config.view.zoom) continue;
      const pId = atlas.units[l.unit]?.parent;
      if (pId) visibleChildrenCount.set(pId, (visibleChildrenCount.get(pId) ?? 0) + 1);
    }
  }

  const nameLabels: { label: HistoricalLabel; areaPx: number; isManual: boolean; isSovereign: boolean; merged: boolean }[] = [];
  const otherLabels: HistoricalLabel[] = [];

  for (const label of atlas.labels) {
    const edit = config.labelEdits[label.id];
    if (edit?.hidden) continue;
    if (label.kind === 'name') {
      const unit = atlas.units[label.unit];
      if (!unit) continue;
      const isManual = !!edit;
      const isSovereign = !unit.parent;
      const isDepth1 = !!unit.parent && !atlas.units[unit.parent]?.parent;
      const europeanRef = config.atlasSheet === 'europe' && config.view.zoom >= 2.4 ? atlas.europeanNames?.[label.unit] : undefined;

      if (!isManual) {
        if (isMergedChildHidden(atlas, label.unit, config.view.zoom)) continue;
        // Let colonial sub-umbrellas (e.g. FWA, DEI, NWD) yield to constituent colonies once zoomed in
        const isContainer = isContainerUnit(atlas, unit.id);
        if (!isSovereign && isContainer && (visibleChildrenCount.get(unit.id) ?? 0) >= 2 && config.view.zoom >= 3) {
          continue;
        }
        if (config.atlasSheet === 'europe' && config.view.zoom < 6 && !isSovereign && !europeanRef && label.zoom > 2) {
          continue;
        }
        if (!isSovereign && !isDepth1 && !europeanRef && label.zoom > config.view.zoom) continue;
      }

      const merged = shouldMergeDomestic(atlas, label.unit, config.view.zoom);
      const areaPx = estimateProjectedAreaPx(atlas, label.unit, merged, geo.proj);
      nameLabels.push({ label, areaPx, isManual, isSovereign, merged });
    } else {
      otherLabels.push(label);
    }
  }

  // Place edited labels first, then sovereign/headline territories ordered by screen area
  nameLabels.sort(
    (a, b) =>
      Number(b.isManual) - Number(a.isManual) ||
      Number(b.isSovereign) - Number(a.isSovereign) ||
      Number(b.label.zoom <= 1) - Number(a.label.zoom <= 1) ||
      b.areaPx - a.areaPx ||
      a.label.priority - b.label.priority,
  );

  for (const { label, areaPx, isManual, isSovereign, merged } of nameLabels) {
    const edit = config.labelEdits[label.id] ?? {};
    const unit = atlas.units[label.unit];
    const text = edit.text ?? label.text;
    if (!text) continue;

    const europeanRef = config.atlasSheet === 'europe' && config.view.zoom >= 2.4 ? atlas.europeanNames?.[label.unit] : undefined;
    const seaCallout =
      label.unit === 'HAW' ||
      (config.atlasSheet === 'europe' && config.view.zoom >= 2.4 && ['MLT', 'PAL', 'SAG'].includes(label.unit));
    const micro = seaCallout || (config.atlasSheet === 'europe' && config.view.zoom >= 2.4 && !!europeanRef);
    if (!isManual && !micro && areaPx < 90 * scaleFactor * scaleFactor) continue;
    const minRequiredSize = seaCallout ? 12.0 * scaleFactor : minRequired(label.zoom <= 1);

    let layout = layoutCurvedCountryLabel({
      atlas,
      unitId: label.unit,
      text,
      merged,
      proj: geo.proj,
      projectPoint: geo.projectPoint,
      viewBounds,
      scaleFactor,
      preview: geo.preview,
      capitalStar: capitalStars.get(label.unit),
      clippedCache: geo.clippedCache,
    });

    if (layout && layout.size >= minRequiredSize) {
      const dx = edit.dx ?? 0;
      const dy = edit.dy ?? 0;
      let finalLayout = layout;
      let collides = !isManual && circlesCollide(layout.circles, placedCircles);

      if (collides && layout.size * 0.85 >= minRequiredSize) {
        const shrunk = scaleLayout(layout, 0.85);
        if (!circlesCollide(shrunk.circles, placedCircles)) {
          finalLayout = shrunk;
          collides = false;
        }
      }

      if (!collides || isManual) {
        const glyphs = dx || dy ? finalLayout.glyphs.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })) : finalLayout.glyphs;
        const circles = dx || dy ? finalLayout.circles.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy })) : finalLayout.circles;
        placedCircles.push(...circles);
        const primary = isSovereign || label.zoom <= 1;
        const inkAlpha = paper ? (primary ? 0.84 : 0.76) : primary ? 0.92 : 0.85;
        const { haloWidth, haloAlpha } = haloMetrics(finalLayout.size, paper);
        const avgX = glyphs.reduce((s, g) => s + g.x, 0) / Math.max(1, glyphs.length);
        const avgY = glyphs.reduce((s, g) => s + g.y, 0) / Math.max(1, glyphs.length);
        words.push({
          type: 'text',
          id: label.id,
          x: avgX,
          y: avgY,
          size: finalLayout.size,
          weight: finalLayout.weight,
          text,
          color: style.color,
          inkAlpha,
          haloAlpha,
          haloWidth,
          glyphs,
        });
        continue;
      }
      // If a micro callout unit collided inside, fall through to callout attempt if applicable
      if (!micro) continue;
    }

    // Callout fallback only for explicitly designated micro-units or manual user edits
    if (!isManual && !micro) continue;
    const anchorGeo = europeanRef?.at ?? label.at;
    const pt = geo.projectPoint(...anchorGeo);
    const pinPt = geo.projectPoint(...label.at);
    if (!pt && !pinPt) continue;

    const size = Math.max(8.5, 10.5 * scaleFactor);
    const weight: 400 | 500 = 400;
    const chars = Array.from(text);
    const advSum = measureGlyphAdvances(chars, weight).reduce((s, a) => s + a, 0);
    const tracking = isCJKDominant(text) ? 0.08 : 0.03;
    const width = (advSum + Math.max(0, chars.length - 1) * tracking) * size;
    const manualOffset = edit.dx !== undefined || edit.dy !== undefined;
    const basePt = pinPt ?? pt!;
    const refLeaderPath =
      !manualOffset && europeanRef?.leader
        ? geoPath(geo.proj)({ type: 'LineString', coordinates: europeanRef.leader }) ?? undefined
        : undefined;

    if (refLeaderPath && pt) {
      const boxCircles = boxToCircles(pt[0], pt[1], width, size);
      if (isManual || !circlesCollide(boxCircles, placedCircles)) {
        placedCircles.push(...boxCircles);
        const { haloWidth, haloAlpha } = haloMetrics(size, paper);
        words.push({
          type: 'text',
          id: label.id,
          x: pt[0],
          y: pt[1],
          size,
          weight,
          text,
          color: style.color,
          inkAlpha: paper ? 0.84 : 0.86,
          haloAlpha,
          haloWidth,
          tracking,
          leaderPath: refLeaderPath,
        });
        continue;
      }
    }

    const offsets: [number, number][] = manualOffset
      ? [[edit.dx ?? 0, edit.dy ?? 0]]
      : [
          [width / 2 + 10, 0],
          [-width / 2 - 10, 0],
          [0, -size - 6],
          [0, size + 6],
        ];
    for (const [dx, dy] of offsets) {
      const tx = basePt[0] + dx;
      const ty = basePt[1] + dy;
      if (tx - width / 2 < -margin || ty - size * 0.6 < -margin || tx + width / 2 > W + margin || ty + size * 0.6 > h + margin) {
        continue;
      }
      const boxCircles = boxToCircles(tx, ty, width, size);
      if (!manualOffset && circlesCollide(boxCircles, placedCircles)) continue;
      placedCircles.push(...boxCircles);
      symbols.push({
        type: 'symbol',
        x: basePt[0],
        y: basePt[1],
        r: 2.6,
        color: territoryColor(unit.id, config, atlas.units),
        outline: style.color,
      });
      const { haloWidth, haloAlpha } = haloMetrics(size, paper);
      words.push({
        type: 'text',
        id: label.id,
        x: tx,
        y: ty,
        size,
        weight,
        text,
        color: style.color,
        inkAlpha: paper ? 0.84 : 0.86,
        haloAlpha,
        haloWidth,
        tracking,
        leader: [basePt[0], basePt[1]],
      });
      break;
    }
  }

  // Non-country annotations (capitals, islands, sites, claims)
  otherLabels.sort((a, b) => Number(!!config.labelEdits[b.id]) - Number(!!config.labelEdits[a.id]) || a.priority - b.priority);
  for (const label of otherLabels) {
    const edit = config.labelEdits[label.id] ?? {};
    const unit = atlas.units[label.unit];
    if (!unit) continue;
    if (label.kind === 'capital') {
      if (modern && (!config.layers.cities.labels || label.zoom > config.view.zoom)) continue;
      if (!modern && label.zoom > config.view.zoom) continue;
    } else {
      if (label.zoom > config.view.zoom) continue;
      if (modern && config.atlasSheet === 'europe' && !config.labelEdits[label.id] && config.view.zoom < 6) continue;
    }

    const pt = geo.projectPoint(...label.at);
    if (!pt) continue;
    const text = edit.text ?? label.text;
    const size = (style.labelSize ?? 13) * (label.kind === 'capital' ? 0.80 : 0.86);
    const weight: 400 | 500 = 400;

    if (!modern || label.kind !== 'capital') {
      symbols.push({
        type: 'symbol',
        x: pt[0],
        y: pt[1],
        r: label.kind === 'capital' ? 2.1 : label.kind === 'island' ? 2.7 : 2.5,
        color: label.kind === 'capital' ? style.color : territoryColor(unit.id, config, atlas.units),
        outline: style.color,
      });
    }
    if (!text) continue;

    const chars = Array.from(text);
    const advSum = measureGlyphAdvances(chars, weight).reduce((s, a) => s + a, 0);
    const tracking = isCJKDominant(text) ? 0.05 : 0.02;
    const width = (advSum + Math.max(0, chars.length - 1) * tracking) * size;
    const manual = edit.dx !== undefined || edit.dy !== undefined;
    const offsets: [number, number][] = manual
      ? [[edit.dx ?? 0, edit.dy ?? 0]]
      : [
          [width / 2 + 8, 0],
          [-width / 2 - 8, 0],
          [0, -size - 5],
          [0, size + 5],
        ];
    for (const [dx, dy] of offsets) {
      const tx = pt[0] + dx;
      const ty = pt[1] + dy;
      if (tx - width / 2 < -margin || ty - size * 0.6 < -margin || tx + width / 2 > W + margin || ty + size * 0.6 > h + margin) {
        continue;
      }
      const boxCircles = boxToCircles(tx, ty, width, size);
      if (!manual && circlesCollide(boxCircles, placedCircles)) continue;
      placedCircles.push(...boxCircles);
      const { haloWidth, haloAlpha } = haloMetrics(size, paper);
      words.push({
        type: 'text',
        id: label.id,
        x: tx,
        y: ty,
        size,
        weight,
        text,
        color: style.color,
        inkAlpha: 0.84,
        haloAlpha,
        haloWidth,
        tracking,
        leader: manual ? [pt[0], pt[1]] : [pt[0], pt[1]],
      });
      break;
    }
  }

  return symbols.concat(words);
}

function marks(layer: AtlasLayer, config: MapConfig, atlas: ScenarioData, preview = false, texture?: TextureArea, margin = 0): Mark[] {
  const geo = projected(atlas, config, preview, texture, margin);
  const style = config.layers[layer];
  const theme = ATLAS_STYLES[config.atlasTheme ?? 'reference'];
  const line = (d: ProjectedPath, color: string, width: number, alpha = 1, dash: number[] = []): Mark => ({
    type: 'line',
    d,
    color,
    width,
    dash,
    alpha,
  });

  if (layer === 'lakes') {
    return geo.lakes().flatMap((d) => [
      ...(style.fill ? [{ type: 'fill' as const, d, color: style.fillColor, alpha: style.fillOpacity }] : []),
      line(d, style.color, style.width, 0.74),
    ]);
  }
  if (layer === 'rivers') {
    const widths =
      config.atlasSheet === 'europe' ? [2.95, 1.98, 1.25] : config.atlasSheet === 'africa' ? [1.74, 1.15, 0.72] : [1.55, 1.02, 0.65];
    return geo.rivers().map((d, i) =>
      line(
        d,
        i === 0 && style.color === theme.river && config.atlasTheme !== 'paper' ? '#557793' : style.color,
        style.width * widths[i] * (config.view.zoom < 1.9 ? 0.63 : 1),
      ),
    );
  }
  if (layer === 'railways') return geo.rails ? [line(geo.rails, style.color, style.width)] : [];
  if (layer === 'cities') {
    const markers: Mark[] = [];
    const seen = new Set<string>();
    const r = (style.dotSize ?? 2.1) * (config.atlasSheet === 'europe' ? 1.55 : config.atlasSheet === 'africa' ? 1.12 : 1);
    const maxRank = Math.min(style.minRank ?? 5, config.view.zoom < 1.9 ? 1 : 8);
    const occupied: { x: number; y: number }[] = [];
    for (const { label, x, y } of geo.points()) {
      const unit = atlas.units[label.unit];
      if (label.kind !== 'capital' || (unit.parent && !['BOH', 'IND', 'BAA', 'GEO', 'ARM', 'AZE'].includes(unit.id)) || config.view.zoom < 1.9) continue;
      const key = Math.round(x) + ',' + Math.round(y);
      if (seen.has(key)) continue;
      seen.add(key);
      const useStar = config.atlasSheet !== 'africa';
      markers.push({
        type: 'symbol',
        x,
        y,
        r: useStar ? r * 2.45 : r * 1.1,
        star: useStar,
        color: useStar ? (config.atlasTheme === 'paper' ? theme.ink : '#ffd9f4') : style.color,
        outline: useStar ? theme.ocean : 'none',
      });
      occupied.push({ x, y });
    }
    for (const town of geo.towns()) {
      if (town.rank > maxRank || occupied.some((p) => Math.hypot(p.x - town.x, p.y - town.y) < 8)) continue;
      markers.push({ type: 'symbol', x: town.x, y: town.y, r, color: style.color, outline: 'none' });
    }
    return markers;
  }
  if (layer === 'historicalLabels') return labelMarks(config, atlas, geo, margin);
  if (layer === 'territories') {
    const fills: Mark[] = geo.faces().map(({ unit: id, d }) => ({
      type: 'fill',
      id,
      d,
      color: territoryColor(id, config, atlas.units),
      hatch: !!atlas.units[id].claims?.length,
    }));
    for (const { x, y, owner } of geo.islandLocators()) {
      fills.push(
        { type: 'symbol', x, y, r: 3.7, color: 'none', outline: config.layers.sovereignBorders.color },
        { type: 'symbol', x, y, r: 2.1, color: territoryColor(owner, config, atlas.units), outline: theme.ink },
      );
    }
    if (geo.claims) fills.push({ type: 'line', d: geo.claims, color: '#80888e', width: 0.6, dash: [3, 4] });
    if (geo.cityRivers) {
      fills.push({
        type: 'line',
        d: geo.cityRivers,
        color: config.scenario?.revision === 2 ? theme.river : '#aac6d3',
        width: Math.max(0.75, config.view.zoom * 0.0014),
        dash: [],
      });
    }
    return fills;
  }

  const width = style.width;
  const dash = style.dash === 'dashed' ? [4 * width, 3 * width] : style.dash === 'dotted' ? [0.1 * width, 3 * width] : [];
  if (config.scenario?.revision === 2) {
    const thin = width * (config.view.zoom < 1.9 ? 0.56 : 1);
    const strokes = (d: ProjectedPath, coast: boolean): Mark[] => [
      ...(config.atlasTheme !== 'paper'
        ? [
            line(d, theme.glow, thin * (coast ? 5.2 : 3.6), coast ? 0.1 : 0.14, dash),
            line(d, theme.glow, thin * (coast ? 2.8 : 1.8), coast ? 0.22 : 0.28, dash),
          ]
        : []),
      line(d, style.color, thin, 1, dash),
    ];
    return layer === 'sovereignBorders'
      ? [...strokes(geo.coastline, true), ...strokes(geo.sovereignBorders, false)]
      : strokes(geo.adminBorders, false);
  }
  return [{ type: 'line', d: geo[layer], color: style.color, width, dash }];
}

let tile: HTMLCanvasElement | OffscreenCanvas | undefined;
function hatch(ctx: MapContext) {
  if (!tile) {
    tile = tileCanvas(24, 24);
    const g = tile.getContext('2d')!;
    g.strokeStyle = '#695747';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-1, 1);
    g.lineTo(1, -1);
    g.moveTo(0, 24);
    g.lineTo(24, 0);
    g.moveTo(23, 25);
    g.lineTo(25, 23);
    g.stroke();
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  pattern?.setTransform(new DOMMatrix().scale(0.25));
  return pattern;
}

function leader(mark: Extract<Mark, { type: 'text' }>) {
  if (mark.leaderPath) return mark.leaderPath;
  if (!mark.leader) return;
  const [x, y] = mark.leader;
  const dx = mark.x - x, dy = mark.y - y;
  if (Math.hypot(dx, dy) < 5) return;
  const halfWidth = Array.from(mark.text).reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 1 : 0.64), 0) * mark.size / 2;
  const edge = Math.min(Math.abs(halfWidth / (dx || 0.001)), Math.abs((mark.size * 0.55) / (dy || 0.001)), 1);
  return `M${x},${y}L${mark.x - dx * edge},${mark.y - dy * edge}`;
}

const GLYPH_BUCKETS = [8, 12, 16, 24, 34, 48];
const ATLAS_SIZE = 1024;
let glyphAtlasCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let glyphAtlasCtx: MapContext | null = null;
let glyphAtlasX = 0;
let glyphAtlasY = 0;
let glyphAtlasRowH = 0;
const glyphSpriteMap = new Map<string, { sx: number; sy: number; size: number; bucket: number }>();

function getGlyphSprite(
  letter: string,
  size: number,
  weight: number,
  color: string,
  inkAlpha: number,
  halo: string,
  haloAlpha: number,
  haloWidth: number,
) {
  let bucket = GLYPH_BUCKETS[GLYPH_BUCKETS.length - 1];
  for (const b of GLYPH_BUCKETS) {
    if (size <= b) {
      bucket = b;
      break;
    }
  }
  const key = `${letter}|${bucket}|${weight}|${color}|${inkAlpha.toFixed(2)}|${halo}|${haloAlpha.toFixed(2)}`;
  const cached = glyphSpriteMap.get(key);
  if (cached) return { canvas: glyphAtlasCanvas!, ...cached };

  if (!glyphAtlasCanvas || !glyphAtlasCtx) {
    glyphAtlasCanvas = tileCanvas(ATLAS_SIZE, ATLAS_SIZE);
    glyphAtlasCtx = glyphAtlasCanvas.getContext('2d') as MapContext;
  }

  const cellSize = Math.ceil(bucket * 1.65);
  if (glyphAtlasX + cellSize > ATLAS_SIZE) {
    glyphAtlasX = 0;
    glyphAtlasY += glyphAtlasRowH + 2;
    glyphAtlasRowH = 0;
  }
  if (glyphAtlasY + cellSize > ATLAS_SIZE) {
    glyphAtlasCtx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    glyphSpriteMap.clear();
    glyphAtlasX = 0;
    glyphAtlasY = 0;
    glyphAtlasRowH = 0;
  }

  const sx = glyphAtlasX;
  const sy = glyphAtlasY;
  glyphAtlasX += cellSize + 2;
  if (cellSize > glyphAtlasRowH) glyphAtlasRowH = cellSize;

  const cx = sx + cellSize / 2;
  const cy = sy + cellSize / 2;
  const gctx = glyphAtlasCtx;
  gctx.save();
  gctx.font = `${weight} ${bucket}px ${VIC3_FONT_STACK}`;
  gctx.textAlign = 'center';
  gctx.textBaseline = 'middle';
  gctx.lineJoin = 'round';
  gctx.miterLimit = 2;

  gctx.globalAlpha = haloAlpha;
  gctx.strokeStyle = halo;
  gctx.lineWidth = haloWidth * (bucket / Math.max(1, size));
  gctx.strokeText(letter, cx, cy);

  gctx.globalAlpha = inkAlpha;
  gctx.fillStyle = color;
  gctx.fillText(letter, cx, cy);
  gctx.restore();

  const entry = { sx, sy, size: cellSize, bucket };
  glyphSpriteMap.set(key, entry);
  return { canvas: glyphAtlasCanvas, ...entry };
}

export function paintScenario(
  ctx: MapContext,
  layer: AtlasLayer,
  config: MapConfig,
  atlas: ScenarioData,
  width: number,
  preview = false,
  texture?: TextureArea,
  margin = 0,
) {
  ctx.save();
  ctx.scale(width / W, width / W);
  const modern = config.scenario?.revision === 2;
  const halo = modern
    ? ATLAS_STYLES[config.atlasTheme ?? 'reference'].halo
    : config.atlasTheme === 'reference'
      ? ATLAS_STYLES.reference.halo
      : '#f4f0e6';
  const layerOpacity = config.layers[layer].opacity;

  for (const m of marks(layer, config, atlas, preview, texture, (margin * W) / width)) {
    ctx.globalAlpha = layerOpacity * ('alpha' in m ? m.alpha ?? 1 : 1);
    if (m.type === 'fill') {
      const p = m.d.canvas();
      ctx.fillStyle = m.color;
      ctx.fill(p);
      if (m.hatch) {
        const pattern = hatch(ctx);
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fill(p);
        }
      }
    } else if (m.type === 'line') {
      if (!m.width) continue;
      ctx.strokeStyle = m.color;
      ctx.lineWidth = m.width;
      ctx.setLineDash(m.dash);
      ctx.stroke(m.d.canvas());
    } else if (m.type === 'symbol') {
      ctx.fillStyle = m.color;
      ctx.lineWidth = m.star ? 1.05 : 0.7;
      const p = m.star ? new Path2D(star(m.x, m.y, m.r)) : new Path2D();
      if (!m.star) p.arc(m.x, m.y, m.r, 0, 2 * Math.PI);
      if (m.color !== 'none') ctx.fill(p);
      if (m.outline !== 'none') {
        ctx.strokeStyle = m.outline;
        ctx.stroke(p);
      }
    } else {
      const d = leader(m);
      if (d) {
        ctx.save();
        ctx.globalAlpha = layerOpacity * 0.45;
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 0.55;
        ctx.setLineDash([]);
        ctx.stroke(new Path2D(d));
        ctx.restore();
      }

      if (m.glyphs && preview && !margin) {
        ctx.save();
        ctx.globalAlpha = layerOpacity;
        for (const g of m.glyphs) {
          const sp = getGlyphSprite(g.letter, m.size, m.weight, m.color, m.inkAlpha, halo, m.haloAlpha, m.haloWidth);
          const drawSize = sp.size * (m.size / sp.bucket);
          ctx.save();
          ctx.translate(g.x, g.y);
          ctx.rotate((g.angle * Math.PI) / 180);
          ctx.drawImage(sp.canvas, sp.sx, sp.sy, sp.size, sp.size, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
          ctx.restore();
        }
        ctx.restore();
        continue;
      }

      ctx.font = `${m.weight} ${m.size}px ${VIC3_FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      if ('letterSpacing' in ctx) {
        (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
          !m.glyphs && m.tracking ? `${m.tracking * m.size}px` : '0px';
      }

      if (m.glyphs) {
        if (!preview && width <= 2200) {
          for (const g of m.glyphs) {
            getGlyphSprite(g.letter, m.size, m.weight, m.color, m.inkAlpha, halo, m.haloAlpha, m.haloWidth);
          }
        }
        // Two-pass draw so adjacent characters' halos never overwrite neighboring ink
        ctx.save();
        ctx.globalAlpha = layerOpacity * m.haloAlpha;
        ctx.strokeStyle = halo;
        ctx.lineWidth = m.haloWidth;
        for (const g of m.glyphs) {
          ctx.save();
          ctx.translate(g.x, g.y);
          ctx.rotate((g.angle * Math.PI) / 180);
          ctx.strokeText(g.letter, 0, 0);
          ctx.restore();
        }
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = layerOpacity * m.inkAlpha;
        ctx.fillStyle = m.color;
        for (const g of m.glyphs) {
          ctx.save();
          ctx.translate(g.x, g.y);
          ctx.rotate((g.angle * Math.PI) / 180);
          ctx.fillText(g.letter, 0, 0);
          ctx.restore();
        }
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = layerOpacity * m.haloAlpha;
        ctx.strokeStyle = halo;
        ctx.lineWidth = m.haloWidth;
        ctx.strokeText(m.text, m.x, m.y);
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = layerOpacity * m.inkAlpha;
        ctx.fillStyle = m.color;
        ctx.fillText(m.text, m.x, m.y);
        ctx.restore();
      }
    }
  }
  ctx.restore();
}

export function scenarioSVG(layer: AtlasLayer, config: MapConfig, atlas: ScenarioData, width: number) {
  const out = [`<g id="${layer}" transform="scale(${width / W})">`];
  const paths = new Map<string, string>();
  const modern = config.scenario?.revision === 2;
  const halo = modern
    ? ATLAS_STYLES[config.atlasTheme ?? 'reference'].halo
    : config.atlasTheme === 'reference'
      ? ATLAS_STYLES.reference.halo
      : '#f4f0e6';
  const layerOpacity = config.layers[layer].opacity;

  if (layer === 'territories') {
    out.push(
      '<defs><pattern id="claim-hatch" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" stroke="#695747" stroke-width=".5"/></pattern></defs>',
    );
  }

  for (const m of marks(layer, config, atlas)) {
    const opacity = layerOpacity * ('alpha' in m ? m.alpha ?? 1 : 1);
    if (m.type === 'fill') {
      const d = m.d.svg();
      if (m.id && !d) continue;
      out.push(`<path${m.id ? ` data-unit="${m.id}"` : ''} fill="${m.color}" opacity="${opacity}" d="${d}"/>`);
      if (m.hatch) out.push(`<path fill="url(#claim-hatch)" d="${d}"/>`);
    } else if (m.type === 'line') {
      const d = m.d.svg();
      if (!d || !m.width) continue;
      let id = paths.get(d);
      if (!id) {
        id = layer + '-path-' + paths.size;
        paths.set(d, id);
        out.push(`<defs><path id="${id}" d="${d}"/></defs>`);
      }
      out.push(
        `<use href="#${id}" fill="none" stroke="${m.color}" opacity="${opacity}" stroke-width="${m.width}" stroke-dasharray="${m.dash.join(' ') || 'none'}"/>`,
      );
    } else if (m.type === 'symbol') {
      const attrs = `fill="${m.color}" stroke="${m.outline}" opacity="${opacity}" stroke-width="${m.star ? 1.05 : 0.7}"`;
      out.push(m.star ? `<path d="${star(m.x, m.y, m.r)}" ${attrs}/>` : `<circle cx="${m.x}" cy="${m.y}" r="${m.r}" ${attrs}/>`);
    } else {
      const d = leader(m);
      if (d) out.push(`<path d="${d}" stroke="${m.color}" stroke-width="0.55" opacity="${(layerOpacity * 0.45).toFixed(3)}"/>`);
      const spacing = !m.glyphs && m.tracking ? ` letter-spacing="${(m.tracking * m.size).toFixed(3)}"` : '';
      const attrs =
        `data-label="${m.id}" font-family="${escape(VIC3_FONT_STACK)}" font-size="${m.size.toFixed(2)}" font-weight="${m.weight}"` +
        ` text-anchor="middle" dominant-baseline="central" fill="${m.color}" fill-opacity="${m.inkAlpha}"` +
        ` stroke="${halo}" stroke-opacity="${m.haloAlpha}" stroke-width="${m.haloWidth.toFixed(2)}"` +
        ` stroke-linejoin="round" stroke-miterlimit="2" paint-order="stroke" opacity="${layerOpacity}"${spacing}`;
      if (m.glyphs) {
        out.push(
          `<g ${attrs} aria-label="${escape(m.text)}">${m.glyphs
            .map((g) => `<text transform="translate(${g.x.toFixed(2)} ${g.y.toFixed(2)}) rotate(${g.angle.toFixed(2)})" paint-order="stroke">${escape(g.letter)}</text>`)
            .join('')}</g>`,
        );
      } else {
        out.push(`<text ${attrs} x="${m.x.toFixed(2)}" y="${m.y.toFixed(2)}">${escape(m.text)}</text>`);
      }
    }
  }
  out.push('</g>');
  return out.join('\n');
}
