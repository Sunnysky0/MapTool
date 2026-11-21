import { feature, mesh } from 'topojson-client';
import { topology } from 'topojson-server';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Feature, Geometry, Point } from 'geojson';
import land110 from 'world-atlas/land-110m.json';
import countries110 from 'world-atlas/countries-110m.json';
import { withPreviews, prepareVectorLayer } from './previewData';
import land50 from 'world-atlas/land-50m.json';
import countries50 from 'world-atlas/countries-50m.json';
import type { LayerData } from '../types';
import { scenarioKey } from './layers';
export * from './layers';
import { SCENARIO_1939 } from './presets';

const NE_BASES = [
  'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/',
  'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/',
];
const HIST_BASES = [
  'https://cdn.jsdelivr.net/gh/aourednik/historical-basemaps@master/geojson/',
  'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/',
];
const ATLAS_BASES = ['https://cdn.jsdelivr.net/npm/world-atlas@2/', 'https://unpkg.com/world-atlas@2/'];

async function fetchJSON<T>(urls: string[]): Promise<T> {
  let lastErr: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Failed to fetch');
}

const ne = (path: string) => NE_BASES.map((b) => b + path);

type AnyTopo = Topology<{ [k: string]: GeometryCollection }>;

const localAtlas = { coast: { '110m': land110, '50m': land50 }, countries: { '110m': countries110, '50m': countries50 } };
const builtInLayers = new Map<string, LayerData>();

function atlasLayer(kind: 'coast' | 'countries', topo: AnyTopo): LayerData {
  if (kind === 'countries') return {geo: mesh(topo, topo.objects.countries, (a,b) => a !== b)};
  return {geo: mesh(topo, topo.objects.land), fillGeo: feature(topo, topo.objects.land) as FeatureCollection};
}

function builtIn(kind: 'coast' | 'countries', detail: '110m' | '50m') {
  const key = kind + detail;
  let data = builtInLayers.get(key);
  if (!data) {
    data = atlasLayer(kind, localAtlas[kind][detail] as unknown as AnyTopo);
    builtInLayers.set(key, data);
  }
  return data;
}

const cache = new Map<string, Promise<LayerData>>();

export function loadLayerData(key: string): Promise<LayerData> {
  const existing = cache.get(key);
  if (existing) return existing;
  const p = loadUncached(key).then(d => /^(coast:|countries:|scenario:)/.test(key) ? d : prepareVectorLayer(d)).catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, p);
  return p;
}

async function loadUncached(key: string): Promise<LayerData> {
  const [kind, arg] = key.split(':');
  switch (kind) {
    case 'scenario': {
      const revision=[1,SCENARIO_1939.revision].find(rev=>key===scenarioKey({...SCENARIO_1939,revision:rev}));
      if (!revision) throw new Error('Unknown scenario revision');
      const { loadScenario } = await import('../scenarios/load');
      return loadScenario(revision);
    }
    case 'coast':
    case 'countries': {
      const coarse = builtIn(kind, '110m');
      if (arg === '110m') return coarse;
      const medium = builtIn(kind, '50m');
      const name = kind === 'coast' ? 'land' : 'countries';
      const full = arg === '50m' ? medium : atlasLayer(kind, await fetchJSON<AnyTopo>(
        ATLAS_BASES.map(base => base + name + '-10m.json')));
      return withPreviews(full, coarse, medium);
    }
    case 'provinces': {
      const fc = await fetchJSON<FeatureCollection>(ne(`${arg}/cultural/ne_${arg}_admin_1_states_provinces_lines.json`));
      return { geo: fc };
    }
    case 'lakes': {
      const fc = await fetchJSON<FeatureCollection>(ne(`${arg}/physical/ne_${arg}_lakes.json`));
      return { geo: fc, fillGeo: fc };
    }
    case 'rivers': {
      const fc = await fetchJSON<FeatureCollection>(ne(`${arg}/physical/ne_${arg}_rivers_lake_centerlines.json`));
      return { geo: fc };
    }
    case 'roads': {
      const fc = await fetchJSON<FeatureCollection>(ne('10m/cultural/ne_10m_roads.json'));
      const isFerry = (f: Feature) => String(f.properties?.type ?? '').toLowerCase().includes('ferry');
      const type = (f: Feature) => String(f.properties?.type ?? '');
      const majorTypes = new Set(['Major Highway', 'Beltway', 'Bypass']);
      const all = fc.features.filter((f) => !isFerry(f));
      const rank = (f: Feature) => Number(f.properties?.scalerank ?? 10);
      let secondary = all.filter((f) => majorTypes.has(type(f)) || type(f) === 'Secondary Highway');
      let major = all.filter((f) => majorTypes.has(type(f)));
      // Fallback to scalerank-based classes if the attribute schema differs
      if (major.length === 0) major = all.filter((f) => rank(f) <= 5);
      if (secondary.length === 0) secondary = all.filter((f) => rank(f) <= 7);
      const fcOf = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
      return { variants: { all: fcOf(all), secondary: fcOf(secondary), major: fcOf(major) }, geo: fcOf(major) };
    }
    case 'railways': {
      const fc = await fetchJSON<FeatureCollection>(ne('10m/cultural/ne_10m_railroads.json'));
      return { geo: fc };
    }
    case 'hist': {
      const fc = await fetchJSON<FeatureCollection>(HIST_BASES.map((b) => `${b}world_${arg}.geojson`));
      // Build a topology so that shared borders become single arcs and coastlines are dropped.
      const cleaned: FeatureCollection = {
        type: 'FeatureCollection',
        features: fc.features.filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')),
      };
      const topo = topology({ c: cleaned as never }, 1e5) as unknown as AnyTopo;
      const borders = mesh(topo, topo.objects.c, (a, b) => a !== b);
      return { geo: borders, fillGeo: cleaned };
    }
    case 'cities': {
      const fc = await fetchJSON<FeatureCollection<Geometry>>(ne('50m/cultural/ne_50m_populated_places_simple.json'));
      const points = fc.features
        .filter((f) => f.geometry?.type === 'Point')
        .map((f) => {
          const [lon, lat] = (f.geometry as Point).coordinates;
          const p = f.properties ?? {};
          return {
            lon,
            lat,
            name: String(p.name ?? p.nameascii ?? ''),
            rank: Number(p.scalerank ?? 10),
            capital: String(p.featurecla ?? '').startsWith('Admin-0 capital'),
          };
        });
      return { points };
    }
    default:
      throw new Error(`Unknown layer data key: ${key}`);
  }
}
