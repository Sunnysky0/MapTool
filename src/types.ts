import type { Feature, GeoJSON, MultiLineString, MultiPolygon, Polygon } from 'geojson';

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
  | 'lambertEurope'
  | 'albers';

export interface ViewState {
  lon: number;
  lat: number;
  zoom: number;
  angle: number;
  projection: ProjectionId;
}

export type Detail = '110m' | '50m' | '10m';
export type ScenarioLayer = 'territories' | 'sovereignBorders' | 'adminBorders' | 'historicalLabels';
export type AtlasLayer = ScenarioLayer | 'rivers' | 'lakes' | 'railways' | 'cities';
export type AtlasSheet = 'world' | 'europe' | 'africa';
export type AtlasTheme = 'reference' | 'paper';
export interface ScenarioRef { id: string; revision: number }
export interface LabelEdit { text?: string; dx?: number; dy?: number; hidden?: boolean }
export interface PoliticalUnit {
  id: string; name: string; status: string; parent: string | null; sovereign: string; manager: string;
  capital: string | null; seat?: [number, number]; suzerain?: string; coSovereigns?:string[]; claims?: string[]; guarantors?: string[]; note?: string;
  color: string; basis: string[];
}
export interface HistoricalLabel {
  id: string; unit: string; text: string; at: [number, number]; zoom: number;
  kind: 'name' | 'capital' | 'island' | 'site' | 'claim'; priority: number;
}
export interface ReferenceLabel {
  text:string; at:[number,number]; size:number; angle:number; turn:number; tracking:number; leader?:[number,number][];
}
export interface AtlasGeography {
  rivers: MultiLineString[]; lakes:MultiPolygon[]; rails:MultiLineString;
  towns:[number,number,number,string,number][];
  africanIslands:[number,number,string][];
}
export interface ScenarioData {
  units: Record<string, PoliticalUnit>;
  faces: Feature<Polygon | MultiPolygon, {unit:string; manager:string; groups:string[]}>[];
  islandGroups: {id:string; unit:string; name:string; at?:[number,number]}[];
  sovereignBorders: MultiLineString; adminBorders: MultiLineString;
  claims: GeoJSON; cityRivers: MultiLineString; labels: HistoricalLabel[];
  managers: Record<string,string>;
  geography?:AtlasGeography;
  europeanNames?:Record<string,ReferenceLabel>;
  coastline?:MultiLineString;
}

export type LayerId =
  | ScenarioLayer
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
  scenario: ScenarioRef | null;
  atlasTheme?: AtlasTheme;
  atlasSheet?: AtlasSheet;
  territoryColors: Record<string,string>;
  labelEdits: Record<string,LabelEdit>;
  view: ViewState;
  coastDetail: Detail;
  waterDetail: Detail;
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
  scenario?: ScenarioData;
  /** Geometry used for stroking */
  geo?: GeoJSON;
  /** Geometry used for filling (polygons) */
  fillGeo?: GeoJSON;
  /** Variants keyed by class (roads) */
  variants?: Record<string, GeoJSON>;
  /** Point features (cities) */
  points?: Array<{ lon: number; lat: number; name: string; rank: number; capital: boolean }>;
}
