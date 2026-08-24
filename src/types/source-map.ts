export type SourceLayer = 'land' | 'lake';

export interface CalibrationSnapshot {
  version: 1;
  method: 'artistic-plate-carree';
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  longitudeRange: readonly [-180, 180];
  latitudeRange: readonly [-90, 90];
  yAxis: 'down';
}

export interface SourceMapSubpath {
  pointOffset: number;
  pointCount: number;
  closed: boolean;
}

export interface SourceMapFeature {
  index: number;
  layer: SourceLayer;
  countryCode: string | null;
  sourcePathId: string;
  pointOffset: number;
  pointCount: number;
  subpaths: SourceMapSubpath[];
}

export interface SourceMapManifest {
  formatVersion: 1;
  compilerVersion: string;
  source: {
    file: 'source_map.svg';
    sha256: string;
    license: 'Public Domain';
    title: string;
  };
  calibration: CalibrationSnapshot;
  stats: {
    sourcePathCount: number;
    geographicPathCount: number;
    decorativePathCount: number;
    rejectedPathCount: number;
    landPathCount: number;
    lakePathCount: number;
    globePointCount: number;
    detailPointCount: number;
    nonFinitePointCount: number;
  };
  lods: {
    globe: {
      file: string;
      pointCount: number;
      tolerance: number;
      features: SourceMapFeature[];
    };
    detail: {
      file: string;
      pointCount: number;
      tolerance: number;
      features: SourceMapFeature[];
    };
  };
  /** Detail-LOD feature table retained as the canonical authoring metadata. */
  features: SourceMapFeature[];
}

export interface LoadedSourceMap {
  manifest: SourceMapManifest;
  points: Float32Array;
}
