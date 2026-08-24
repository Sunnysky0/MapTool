import type { CalibrationSnapshot } from '../../types/source-map';

export interface GeographicExtent {
  /** Longitude in degrees in the canonical [-180, 180] range. */
  west: number;
  /** Longitude in degrees in the canonical [-180, 180] range. */
  east: number;
  south: number;
  north: number;
  /** When true, the selected interval runs eastward across the antimeridian. */
  wrapsAntimeridian: boolean;
}

export interface SourceReference {
  file: string;
  sha256: string;
  calibration: CalibrationSnapshot;
}

export type ProjectionParameter = number | boolean | string;

export interface ProjectionSettings {
  id: string;
  parameters: Record<string, ProjectionParameter>;
}

export interface CanvasSettings {
  width: number;
  height: number;
  padding: number;
}

export interface LineworkStyle {
  color: string;
  width: number;
  opacity: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'bevel' | 'round' | 'miter';
}

export interface GraticuleStyle {
  visible: boolean;
  longitudeInterval: number;
  latitudeInterval: number;
  color: string;
  width: number;
  opacity: number;
}

export interface BackgroundStyle {
  color: string | null;
}

export interface ExtentFrameStyle {
  visible: boolean;
  color: string;
  width: number;
}

export interface MapStyle {
  linework: LineworkStyle;
  graticule: GraticuleStyle;
  background: BackgroundStyle;
  extentFrame: ExtentFrameStyle;
}

export type ExportQuality = 'preview' | 'standard' | 'high';

/** Serializable, renderer-independent state required to reproduce a map. */
export interface MapDocument {
  source: SourceReference;
  extent: GeographicExtent;
  projection: ProjectionSettings;
  canvas: CanvasSettings;
  style: MapStyle;
  exportQuality: ExportQuality;
}

export function createDefaultMapDocument(
  source: SourceReference,
  overrides: Partial<Omit<MapDocument, 'source'>> = {},
): MapDocument {
  return {
    source,
    extent: overrides.extent ?? {
      west: -180,
      east: 180,
      south: -90,
      north: 90,
      wrapsAntimeridian: false,
    },
    projection: overrides.projection ?? { id: 'plate-carree', parameters: {} },
    canvas: overrides.canvas ?? { width: 1600, height: 900, padding: 32 },
    style: overrides.style ?? {
      linework: {
        color: '#f5f5f5',
        width: 1,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      },
      graticule: {
        visible: true,
        longitudeInterval: 15,
        latitudeInterval: 15,
        color: '#8a8a8a',
        width: 0.5,
        opacity: 0.45,
      },
      background: { color: null },
      extentFrame: { visible: false, color: '#ffffff', width: 1 },
    },
    exportQuality: overrides.exportQuality ?? 'standard',
  };
}
