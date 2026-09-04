import type { LayerId, LayerStyle, MapConfig, ViewState } from '../types';

export const CONFIG_VERSION = 4;

const base = (over: Partial<LayerStyle> = {}): LayerStyle => ({
  visible: false,
  color: '#ffffff',
  width: 1,
  opacity: 1,
  dash: 'solid',
  fill: false,
  fillColor: '#ffffff',
  fillOpacity: 0.08,
  ...over,
});

export function defaultLayers(): Record<LayerId, LayerStyle> {
  return {
    coast: base({ visible: true, width: 1.1 }),
    outline: base({ width: 1, opacity: 0.6, fillColor: '#000000', fillOpacity: 1 }),
    graticule: base({ width: 0.5, opacity: 0.35, step: 10, dash: 'solid' }),
    countries: base({ width: 0.8, opacity: 0.7, dash: 'solid' }),
    provinces: base({ width: 0.5, opacity: 0.45, dash: 'dotted' }),
    histA: base({ width: 0.9, opacity: 0.85, color: '#f5b642', year: 1914, dash: 'solid' }),
    histB: base({ width: 0.9, opacity: 0.85, color: '#5ad1e6', year: 1938, dash: 'dashed' }),
    lakes: base({ width: 0.7, opacity: 0.9, fill: false, fillColor: '#ffffff', fillOpacity: 0.12 }),
    rivers: base({ width: 0.6, opacity: 0.6 }),
    roads: base({ width: 0.5, opacity: 0.55, roadClass: 'major' }),
    railways: base({ width: 0.6, opacity: 0.7, dash: 'rail' }),
    cities: base({ width: 1, opacity: 0.9, minRank: 1, labels: true, labelSize: 11, dotSize: 2 }),
  };
}

export const DEFAULT_VIEW: ViewState = { lon: -22, lat: 24, zoom: 3.4, angle: 0, projection: 'mercator' };

export function defaultConfig(): MapConfig {
  return {
    version: CONFIG_VERSION,
    view: { ...DEFAULT_VIEW },
    detail: '50m',
    width: 3840,
    height: 2160,
    background: '#000000',
    transparentBackground: false,
    bgGradient: false,
    bgGradientColor: '#101418',
    vignette: 0,
    grain: 0,
    lineCap: 'round',
    layers: defaultLayers(),
    title: {
      text: '',
      subtitle: '',
      font: 'Cormorant Garamond',
      size: 64,
      color: '#ffffff',
      position: 'bottom-left',
      letterSpacing: 0.25,
      uppercase: true,
    },
  };
}

export interface Theme {
  id: string;
  name: string;
  background: string;
  gradient?: string;
  line: string;
  accent: string;
  accent2: string;
  water: string;
  landFill?: string;
  landFillOpacity?: number;
  vignette?: number;
  grain?: number;
}

export const THEMES: Theme[] = [
  { id: 'noir', name: 'Noir', background: '#000000', line: '#ffffff', accent: '#f5b642', accent2: '#5ad1e6', water: '#ffffff' },
  { id: 'paper', name: 'Paper', background: '#f4efe6', line: '#1f1a17', accent: '#b4432f', accent2: '#2f5f8f', water: '#2f5f8f', vignette: 0.25, grain: 0.12 },
  { id: 'blueprint', name: 'Blueprint', background: '#0b2a5b', gradient: '#061a3a', line: '#dbe9ff', accent: '#ffd166', accent2: '#8ef0ff', water: '#8ec5ff', vignette: 0.3 },
  { id: 'midnight', name: 'Midnight', background: '#0a0f1e', gradient: '#141c33', line: '#c9d4ff', accent: '#ffb347', accent2: '#7bf1a8', water: '#7fb2ff', vignette: 0.4 },
  { id: 'neon', name: 'Neon', background: '#0d0219', gradient: '#1c0533', line: '#ff4fd8', accent: '#39ff14', accent2: '#00e5ff', water: '#00e5ff', vignette: 0.35 },
  { id: 'sepia', name: 'Sepia', background: '#2b1d12', gradient: '#3d2a1a', line: '#e8c99b', accent: '#ff9e5e', accent2: '#9fd3c7', water: '#c9a56d', vignette: 0.45, grain: 0.18 },
  { id: 'forest', name: 'Forest', background: '#0c1a12', gradient: '#14291c', line: '#b8e0c2', accent: '#ffcc66', accent2: '#8bd3dd', water: '#8bd3dd', vignette: 0.3 },
  { id: 'inverse', name: 'Ink on white', background: '#ffffff', line: '#000000', accent: '#d62828', accent2: '#1d4ed8', water: '#1d4ed8' },
  { id: 'crimson', name: 'Crimson', background: '#1a0508', gradient: '#2a0a10', line: '#ff8a80', accent: '#ffd180', accent2: '#80d8ff', water: '#ff8a80', vignette: 0.35 },
  { id: 'gold', name: 'Gold leaf', background: '#0e0c08', gradient: '#1a160d', line: '#e6c36b', accent: '#ffffff', accent2: '#b5e0c0', water: '#e6c36b', vignette: 0.4, grain: 0.1 },
  { id: 'arctic', name: 'Arctic', background: '#e9f1f7', gradient: '#d5e3ee', line: '#0f2a44', accent: '#c1121f', accent2: '#3a86ff', water: '#3a86ff', vignette: 0.15 },
  { id: 'terminal', name: 'Terminal', background: '#020a05', line: '#39ff14', accent: '#c8ff00', accent2: '#00ffd0', water: '#00ffd0', vignette: 0.3, grain: 0.15 },
];

export function applyTheme(config: MapConfig, theme: Theme): MapConfig {
  const layers = { ...config.layers };
  const setColor = (id: LayerId, color: string, fillColor?: string) => {
    layers[id] = { ...layers[id], color, fillColor: fillColor ?? color };
  };
  setColor('coast', theme.line, theme.landFill ?? theme.line);
  setColor('outline', theme.line, theme.background);
  setColor('graticule', theme.line);
  setColor('countries', theme.line);
  setColor('provinces', theme.line);
  setColor('histA', theme.accent);
  setColor('histB', theme.accent2);
  setColor('lakes', theme.water);
  setColor('rivers', theme.water);
  setColor('roads', theme.line);
  setColor('railways', theme.line);
  setColor('cities', theme.accent);
  return {
    ...config,
    background: theme.background,
    bgGradient: !!theme.gradient,
    bgGradientColor: theme.gradient ?? config.bgGradientColor,
    vignette: theme.vignette ?? 0,
    grain: theme.grain ?? 0,
    layers,
    title: { ...config.title, color: theme.line },
  };
}

export interface LocationPreset {
  id: string;
  name: string;
  view: Partial<ViewState>;
}

export const LOCATIONS: LocationPreset[] = [
  { id: 'atlantic', name: 'Atlantic', view: { lon: -22, lat: 24, zoom: 3.4, angle: 0, projection: 'mercator' } },
  { id: 'world', name: 'World', view: { lon: 10, lat: 0, zoom: 1, angle: 0, projection: 'naturalEarth' } },
  { id: 'europe', name: 'Europe', view: { lon: 12, lat: 52, zoom: 9, angle: 0, projection: 'albers' } },
  { id: 'med', name: 'Mediterranean', view: { lon: 18, lat: 38, zoom: 10, angle: 0, projection: 'mercator' } },
  { id: 'britain', name: 'British Isles', view: { lon: -4, lat: 54.5, zoom: 26, angle: 0, projection: 'mercator' } },
  { id: 'scandinavia', name: 'Scandinavia', view: { lon: 17, lat: 63, zoom: 12, angle: 0, projection: 'albers' } },
  { id: 'namerica', name: 'North America', view: { lon: -98, lat: 42, zoom: 4.5, angle: 0, projection: 'albers' } },
  { id: 'usa', name: 'United States', view: { lon: -97, lat: 38.5, zoom: 7, angle: 0, projection: 'albers' } },
  { id: 'caribbean', name: 'Caribbean', view: { lon: -72, lat: 18, zoom: 12, angle: 0, projection: 'mercator' } },
  { id: 'samerica', name: 'South America', view: { lon: -60, lat: -20, zoom: 4, angle: 0, projection: 'mercator' } },
  { id: 'africa', name: 'Africa', view: { lon: 20, lat: 3, zoom: 3.6, angle: 0, projection: 'equalEarth' } },
  { id: 'mideast', name: 'Middle East', view: { lon: 45, lat: 30, zoom: 9, angle: 0, projection: 'albers' } },
  { id: 'india', name: 'Indian subcontinent', view: { lon: 80, lat: 22, zoom: 9, angle: 0, projection: 'mercator' } },
  { id: 'eastasia', name: 'East Asia', view: { lon: 118, lat: 33, zoom: 6, angle: 0, projection: 'albers' } },
  { id: 'japan', name: 'Japan', view: { lon: 138, lat: 37, zoom: 18, angle: 0, projection: 'mercator' } },
  { id: 'seasia', name: 'Southeast Asia', view: { lon: 112, lat: 6, zoom: 7, angle: 0, projection: 'mercator' } },
  { id: 'oceania', name: 'Australia & NZ', view: { lon: 150, lat: -30, zoom: 5.5, angle: 0, projection: 'mercator' } },
  { id: 'pacific', name: 'Pacific', view: { lon: -170, lat: 5, zoom: 1.8, angle: 0, projection: 'orthographic' } },
  { id: 'arctic', name: 'Arctic', view: { lon: 0, lat: 90, zoom: 2.2, angle: 0, projection: 'stereographic' } },
  { id: 'antarctic', name: 'Antarctica', view: { lon: 0, lat: -90, zoom: 2.4, angle: 0, projection: 'stereographic' } },
  { id: 'globe-eu', name: 'Globe · Afro-Eurasia', view: { lon: 30, lat: 25, zoom: 1.9, angle: 0, projection: 'orthographic' } },
  { id: 'globe-am', name: 'Globe · Americas', view: { lon: -80, lat: 15, zoom: 1.9, angle: 0, projection: 'orthographic' } },
];

export const SIZE_PRESETS: { name: string; width: number; height: number }[] = [
  { name: '4K landscape · 3840×2160', width: 3840, height: 2160 },
  { name: 'Full HD · 1920×1080', width: 1920, height: 1080 },
  { name: 'Ultrawide · 3440×1440', width: 3440, height: 1440 },
  { name: 'Square · 3000×3000', width: 3000, height: 3000 },
  { name: 'Portrait 4:5 · 2400×3000', width: 2400, height: 3000 },
  { name: 'Story 9:16 · 1080×1920', width: 1080, height: 1920 },
  { name: 'A4 portrait · 2480×3508', width: 2480, height: 3508 },
  { name: 'A3 landscape · 4961×3508', width: 4961, height: 3508 },
  { name: 'Poster 2:3 · 4000×6000', width: 4000, height: 6000 },
  { name: 'Phone wallpaper · 1290×2796', width: 1290, height: 2796 },
];

export const FONTS = ['Cormorant Garamond', 'Playfair Display', 'Montserrat', 'Space Mono', 'Georgia', 'Helvetica Neue', 'Courier New'];
