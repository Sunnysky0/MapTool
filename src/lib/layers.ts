import type { AtlasLayer, Detail, LayerId, LayerStyle, ScenarioLayer, ScenarioRef } from '../types';

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
