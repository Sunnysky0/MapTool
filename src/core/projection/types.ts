import type { GeoProjection } from 'd3-geo';
import type { GeographicExtent } from '../model/map-document';

export type ProjectionId =
  | 'plate-carree'
  | 'mercator'
  | 'equal-earth'
  | 'natural-earth-1'
  | 'winkel-tripel'
  | 'lambert-azimuthal-equal-area';

export type ProjectionCategory = '圆柱投影' | '伪圆柱投影' | '折衷投影' | '方位投影';

export type GeographicPosition = readonly [longitude: number, latitude: number];

export interface ProjectionMetadata {
  id: ProjectionId;
  name: string;
  category: ProjectionCategory;
  description: string;
  property: string;
  validation: string;
}

export interface ProjectionParameters {
  center?: GeographicPosition | 'auto';
  scale?: number;
  rotate?: readonly [number, number] | readonly [number, number, number];
  precision?: number;
}

export interface ProjectionViewport {
  width: number;
  height: number;
  padding?: number;
}

export interface ProjectionValidationIssue {
  code: string;
  message: string;
  position?: GeographicPosition;
}

export interface ProjectionValidationResult {
  valid: boolean;
  issues: ProjectionValidationIssue[];
}

export interface CreateProjectionOptions {
  id: ProjectionId;
  extent: GeographicExtent;
  viewport: ProjectionViewport;
  parameters?: ProjectionParameters;
  boundaryTolerance?: number;
  boundaryMaxDepth?: number;
  boundaryMaxPoints?: number;
}

export interface CreatedProjection {
  id: ProjectionId;
  metadata: ProjectionMetadata;
  projection: GeoProjection;
  extent: GeographicExtent;
  center: [number, number];
  boundaryGeographic: GeographicPosition[];
  boundary: [number, number][];
}
