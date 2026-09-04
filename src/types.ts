import type { GeoJSON } from 'geojson';

export type ProjectionId =
  | 'mercator'
  | 'transverseMercator'
  | 'equirectangular'
  | 'naturalEarth'
  | 'equalEarth'
  | 'robinson'
  | 'winkel3'
  | 'mollweide'
  | 'bertin'
  | 'orthographic'
  | 'stereographic'
  | 'azimuthalEqualArea'
  | 'gnomonic'
  | 'albers';

export interface ViewState {
  lon: number;
  lat: number;
  zoom: number;
  angle: number;
  projection: ProjectionId;
}

export type Detail = '110m' | '50m' | '10m';

export type LayerId =
  | 'coast'
  | 'countries'
  | 'provinces'
  | 'lakes'
  | 'rivers'
  | 'roads'
  | 'railways'
  | 'histA'
  | 'histB'
  | 'graticule'
  | 'cities'
  | 'outline';

export type DashStyle = 'solid' | 'dashed' | 'dotted' | 'rail';

export interface LayerStyle {
  visible: boolean;
  color: string;
  width: number;
  opacity: number;
  dash: DashStyle;
  fill: boolean;
  fillColor: string;
  fillOpacity: number;
  /** Historical layers: which year to load */
  year?: number;
  /** Roads: which classes to draw */
  roadClass?: 'major' | 'secondary' | 'all';
  /** Graticule: step in degrees */
  step?: number;
  /** Cities: max scalerank to draw (lower = more important) */
  minRank?: number;
  labels?: boolean;
  labelSize?: number;
  dotSize?: number;
}

export type TitlePosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface TitleStyle {
  text: string;
  subtitle: string;
  font: string;
  size: number;
  color: string;
  position: TitlePosition;
  letterSpacing: number;
  uppercase: boolean;
}

export interface MapConfig {
  version: number;
  view: ViewState;
  detail: Detail;
  width: number;
  height: number;
  background: string;
  transparentBackground: boolean;
  bgGradient: boolean;
  bgGradientColor: string;
  vignette: number;
  grain: number;
  lineCap: 'round' | 'butt';
  layers: Record<LayerId, LayerStyle>;
  title: TitleStyle;
}

export interface LayerData {
  /** Geometry used for stroking */
  geo?: GeoJSON;
  /** Geometry used for filling (polygons) */
  fillGeo?: GeoJSON;
  /** Variants keyed by class (roads) */
  variants?: Record<string, GeoJSON>;
  /** Point features (cities) */
  points?: Array<{ lon: number; lat: number; name: string; rank: number; capital: boolean }>;
}
