import { geoArea } from 'd3-geo';
import simplify from 'simplify-js';
import type { Feature, GeoJSON, Geometry, Position } from 'geojson';
import type { LayerData } from '../types';
import { buildProjection } from './projections';
import type { RenderInput } from './render';

type Levels = readonly [LayerData, LayerData];
const levels = new WeakMap<LayerData, Levels>();

export function withPreviews(full: LayerData, overview: LayerData, regional: LayerData) {
  levels.set(full, [overview, regional]);
  return full;
}

// Tolerances in geographic degrees. Only disposable editing geometry uses these.
export const OVERVIEW = .45;
export const REGIONAL = .055;

export function geometrySimplifier(tolerance: number) {
  const cache = new WeakMap<GeoJSON, GeoJSON>();
  function line(coords: Position[]): Position[] {
    const points = coords.map(([x, y]) => ({x, y}));
    return simplify(points, tolerance).map(({x, y}) => [x, y]);
  }
  function polygon(rings: Position[][]) {
    const result: Position[][] = [];
    for (const ring of rings) {
      const reduced = line(ring);
      if (reduced.length >= 4) {
        const complement = (r: Position[]) => geoArea({type:'Polygon',coordinates:[r]}) > 2*Math.PI;
        result.push(complement(ring) === complement(reduced) ? reduced : ring);
      }
      else if (ring === rings[0]) return [];
    }
    return result;
  }
  function reduce(geo: GeoJSON): GeoJSON {
    switch (geo.type) {
      case 'FeatureCollection': return {...geo, features: geo.features.map(f => cached(f) as Feature)};
      case 'Feature': return geo.geometry ? {...geo, geometry: cached(geo.geometry) as Geometry} : geo;
      case 'GeometryCollection': return {...geo, geometries: geo.geometries.map(g => cached(g) as Geometry)};
      case 'LineString': return {...geo, coordinates: line(geo.coordinates)};
      case 'MultiLineString': return {...geo, coordinates: geo.coordinates.map(line)};
      case 'Polygon': return {...geo, coordinates: polygon(geo.coordinates)};
      case 'MultiPolygon': return {...geo, coordinates: geo.coordinates.map(polygon).filter(p => p.length)};
      default: return geo;
    }
  }
  function cached<T extends GeoJSON>(geo: T): T {
    let reduced = cache.get(geo);
    if (!reduced) { reduced = reduce(geo); cache.set(geo, reduced); }
    return reduced as T;
  }
  return cached;
}

export function prepareVectorLayer(full: LayerData) {
  if (!full.geo && !full.fillGeo) return full;
  function level(tolerance: number): LayerData {
    const reduce = geometrySimplifier(tolerance);
    return {
      geo: full.geo && reduce(full.geo),
      fillGeo: full.fillGeo && reduce(full.fillGeo),
      variants: full.variants && Object.fromEntries(Object.entries(full.variants).map(([k,g]) => [k, reduce(g)])),
    };
  }
  return withPreviews(full, level(OVERVIEW), level(REGIONAL));
}

export function interactiveInput(input: RenderInput, level = Number(buildProjection(input.config.view, input.width, input.height).scale() > 1400)): RenderInput {
  const data: RenderInput['data'] = {};
  for (const [key, full] of Object.entries(input.data)) {
    data[key] = full && (levels.get(full)?.[level] ?? full);
  }
  return {...input, data, preview: true};
}
