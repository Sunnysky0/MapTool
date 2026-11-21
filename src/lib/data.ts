import { feature, mesh } from 'topojson-client';
import { topology } from 'topojson-server';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { FeatureCollection, Feature, Geometry, Point } from 'geojson';
import land50 from 'world-atlas/land-50m.json';
import countries50 from 'world-atlas/countries-50m.json';
import type { AtlasLayer, Detail, LayerData, LayerId, LayerStyle, ScenarioLayer, ScenarioRef } from '../types';
import { SCENARIO_1939 } from './presets';

export interface LayerDef {
  id: LayerId;
  name: string;
  description: string;
  group: 'Base' | 'Boundaries' | 'Water' | 'Transport' | 'Historical' | 'Extras' | 'Scenario';
  kind: 'line' | 'polygon' | 'point' | 'graticule' | 'outline';
  canFill: boolean;
  sizeHint?: string;
}

export const LAYER_DEFS: LayerDef[] = [
  { id: 'territories', name: '政区底色与争议纹理', description: '实际管理及领土主张', group: 'Scenario', kind: 'polygon', canFill: false },
  { id: 'sovereignBorders', name: '主权国界', description: '主权体系与海岸轮廓', group: 'Scenario', kind: 'line', canFill: false },
  { id: 'adminBorders', name: '属地与自治边界', description: '同一主权体系内的政区', group: 'Scenario', kind: 'line', canFill: false },
  { id: 'historicalLabels', name: '政区名称与地名', description: '政区、首府、租界与岛群', group: 'Scenario', kind: 'point', canFill: false },
  { id: 'coast', name: 'Coastlines', description: 'Land outlines (Natural Earth)', group: 'Base', kind: 'polygon', canFill: true },
  { id: 'outline', name: 'Map outline', description: 'Edge of the projected globe', group: 'Base', kind: 'outline', canFill: true },
  { id: 'graticule', name: 'Graticule', description: 'Latitude / longitude grid', group: 'Base', kind: 'graticule', canFill: false },
  { id: 'countries', name: 'Country borders', description: 'Present-day international borders', group: 'Boundaries', kind: 'line', canFill: false },
  { id: 'provinces', name: 'Provinces & states', description: 'First-level admin boundaries', group: 'Boundaries', kind: 'line', canFill: false, sizeHint: '~2–7 MB' },
  { id: 'histA', name: 'Historical borders', description: 'Political borders of a past year', group: 'Historical', kind: 'line', canFill: false, sizeHint: '~2 MB' },
  { id: 'histB', name: 'Historical borders (2nd)', description: 'Compare a second year', group: 'Historical', kind: 'line', canFill: false, sizeHint: '~2 MB' },
  { id: 'lakes', name: 'Lakes', description: 'Major lakes & reservoirs', group: 'Water', kind: 'polygon', canFill: true },
  { id: 'rivers', name: 'Rivers', description: 'Rivers & lake centerlines', group: 'Water', kind: 'line', canFill: false },
  { id: 'roads', name: 'Roads', description: 'Highways & major roads (10 m)', group: 'Transport', kind: 'line', canFill: false, sizeHint: '~9 MB' },
  { id: 'railways', name: 'Railways', description: 'Railroad network (10 m)', group: 'Transport', kind: 'line', canFill: false, sizeHint: '~6 MB' },
  { id: 'cities', name: 'Cities', description: 'Populated places with optional labels', group: 'Extras', kind: 'point', canFill: false },
];

export const LAYER_DEF_MAP = Object.fromEntries(LAYER_DEFS.map((d) => [d.id, d])) as Record<LayerId, LayerDef>;

export const HISTORICAL_YEARS = [1800, 1815, 1880, 1900, 1914, 1920, 1930, 1938, 1945, 1960, 1994, 2010];
export const HISTORICAL_LABELS: Record<number, string> = {
  1800: '1800 · Napoleonic era',
  1815: '1815 · Congress of Vienna',
  1880: '1880 · Scramble for Africa',
  1900: '1900 · Turn of the century',
  1914: '1914 · Pre-WWI',
  1920: '1920 · Post-Versailles',
  1930: '1930 · Interwar',
  1938: '1938 · Pre-WWII (≈1936)',
  1945: '1945 · End of WWII',
  1960: '1960 · Decolonisation',
  1994: '1994 · Post-Cold War',
  2010: '2010 · Recent',
};

const NE_BASES = [
  'https://cdn.jsdelivr.net/gh/martynafford/natural-earth-geojson@master/',
  'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/',
];
const HIST_BASES = [
  'https://cdn.jsdelivr.net/gh/aourednik/historical-basemaps@master/geojson/',
  'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/',
];
const ATLAS_BASES = ['https://cdn.jsdelivr.net/npm/world-atlas@2/', 'https://unpkg.com/world-atlas@2/'];

/** Return a cache key describing what data a layer needs, or null when no remote data is required. */
export function isScenarioLayer(id: LayerId): id is ScenarioLayer {
  return LAYER_DEF_MAP[id].group === 'Scenario';
}
export function scenarioKey(ref: ScenarioRef) { return `scenario:${ref.id}@${ref.revision}`; }
export function atlasLayerFor(id:LayerId,ref:ScenarioRef|null|undefined):AtlasLayer|null {
  if (isScenarioLayer(id)) return id;
  if (ref?.revision===2 && (id==='rivers'||id==='lakes'||id==='cities'||id==='railways')) return id;
  return null;
}

export function layerDataKey(id: LayerId, style: LayerStyle, coastDetail: Detail, waterDetail: Detail, scenario?: ScenarioRef | null): string | null {
  if (atlasLayerFor(id,scenario)) return scenario ? scenarioKey(scenario) : null;
  switch (id) {
    case 'coast':
    case 'countries':
      return `${id}:${coastDetail}`;
    case 'lakes':
    case 'rivers':
      return `${id}:${waterDetail}`;
    case 'provinces':
      return `provinces:${coastDetail === '10m' ? '10m' : '50m'}`;
    case 'roads':
      return 'roads';
    case 'railways':
      return 'railways';
    case 'histA':
    case 'histB':
      return `hist:${style.year ?? 1914}`;
    case 'cities':
      return 'cities';
    default:
      return null;
  }
}

export function describeKey(key: string): string {
  const [kind, arg] = key.split(':');
  const names: Record<string, string> = {
    coast: 'coastlines',
    countries: 'country borders',
    lakes: 'lakes',
    rivers: 'rivers',
    provinces: 'provinces',
    roads: 'roads',
    railways: 'railways',
    hist: 'historical borders',
    cities: 'cities',
    scenario: '1939 年政区',
  };
  return `${names[kind] ?? kind}${arg ? ` (${arg})` : ''}`;
}

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

async function loadAtlas(name: 'land' | 'countries', detail: Detail): Promise<AnyTopo> {
  if (detail === '50m') return (name === 'land' ? land50 : countries50) as unknown as AnyTopo;
  return fetchJSON<AnyTopo>(ATLAS_BASES.map((b) => `${b}${name}-${detail}.json`));
}

const cache = new Map<string, Promise<LayerData>>();

export function loadLayerData(key: string): Promise<LayerData> {
  const existing = cache.get(key);
  if (existing) return existing;
  const p = loadUncached(key).catch((e) => {
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
      return { scenario: await loadScenario(revision) };
    }
    case 'coast': {
      const topo = await loadAtlas('land', arg as Detail);
      return { geo: mesh(topo, topo.objects.land), fillGeo: feature(topo, topo.objects.land) as FeatureCollection };
    }
    case 'countries': {
      const topo = await loadAtlas('countries', arg as Detail);
      return { geo: mesh(topo, topo.objects.countries, (a, b) => a !== b) };
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
